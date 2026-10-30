"use strict";
const REPO = "TrueSightDAO/agentic_ai_context";
const REF = "main";
const SOURCES = [
  `https://cdn.jsdelivr.net/gh/${REPO}@${REF}/handoffs/index.json`,
  `https://raw.githubusercontent.com/${REPO}/${REF}/handoffs/index.json`,
];
const SPEC_SOURCES = (p) => [
  `https://cdn.jsdelivr.net/gh/${REPO}@${REF}/${p}`,
  `https://raw.githubusercontent.com/${REPO}/${REF}/${p}`,
];
const TG_CHAT = "3919341801";               // t.me/c/<chat>/<thread>
const DC_GUILD = "923008087315587072";      // discord.com/channels/<guild>/<channel>

// Sophia's public live-introspection endpoint. index.json above is a STATIC file built
// periodically, so it can show handoff states but never what a worker is doing right now --
// and its `supervised_by.stale` flag is frozen at build time. This endpoint reads shared
// Redis instead. Read-only and public by design: the payload is allowlist-projected
// server-side (no instruction text, no tool arguments, no session identities).
const LIVE_STATE_URL = "https://sophia.truesight.me/live-state";
const LIVE_POLL_MS = 5000;
let liveTimer = null;

// Column layout maps DIRECTLY onto SUPERVISOR_LOOP.md §2's state enum.
const COLUMNS = [
  { key: "awaiting_kickoff", label: "Awaiting kickoff", states: ["awaiting_kickoff"] },
  { key: "executing", label: "Executing", states: ["executing"] },
  { key: "paused", label: "Paused at gate", states: ["paused_at_gate"] },
  { key: "uat", label: "UAT (R1/R2)", states: ["sophia_uat", "envoy_uat"] },
  { key: "need", label: "Needs You", states: ["blocked_on_human", "human_uat_ready"], need: true },
];
const FOOTER_STATES = ["done", "stale", "failed"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const strip = (s) => String(s ?? "").replace(/^[`*_#\s]+|[`*_\s]+$/g, "").replace(/\*\*/g, "");

function planPath(h) {
  // plan_file arrives backtick-wrapped: `plans/FOO.md`
  return strip(h.plan_file || "");
}
function tgUrl(h) {
  if (h.telegram_topic_url) return h.telegram_topic_url;
  if (h.telegram_thread_id) return `https://t.me/c/${TG_CHAT}/${h.telegram_thread_id}`;
  return null;
}
function dcUrl(h) {
  if (h.discord_channel_id) {
    const c = h.discord_channel_id;
    const t = h.discord_thread_id;
    return `https://discord.com/channels/${DC_GUILD}/${c}${t ? "/" + t : ""}`;
  }
  return null;
}

function supBadge(h) {
  const s = h.supervised_by;
  if (!s) return "";
  const EYE = String.fromCodePoint(0x1F440);
  const who = s.supervisor ? String(s.supervisor).split("(")[0].trim() : "supervisor";
  const stale = s.stale === true;
  const age = Number.isFinite(s.age_minutes) ? ` (${s.age_minutes} min)` : "";
  const note = s.note ? ` title="${esc(s.note)}"` : "";
  return `<div class="sup${stale ? " stale" : ""}"${note}>${EYE} ${esc(who)} — ${stale ? "stale" : "active"}${esc(age)}</div>`;
}

function card(h) {
  const need = h.state === "blocked_on_human" || h.state === "human_uat_ready";
  const links = [];
  const pp = planPath(h);
  if (pp) links.push(`<a href="#" class="spec" data-spec="${esc(pp)}">Spec</a>`);
  const tg = tgUrl(h);
  if (tg) links.push(`<a href="${esc(tg)}" target="_blank" rel="noopener">Telegram ↗</a>`);
  const dc = dcUrl(h);
  if (dc) links.push(`<a href="${esc(dc)}" target="_blank" rel="noopener">Discord ↗</a>`);
  return `<article class="card${need ? " need" : ""}">
    <div class="state">${esc(h.state)}</div>
    ${supBadge(h)}
    <h3>${esc(strip(h.title))}</h3>
    <div class="why">${esc(strip(h.status_raw))}</div>
    <div class="links">${links.join("")}</div>
    <div class="date">Updated ${esc(h.last_updated || "—")}</div>
  </article>`;
}

function render(data) {
  const hs = data.handoffs || [];
  const byState = (s) => hs.filter((h) => h.state === s);
  const needCards = [...byState("blocked_on_human"), ...byState("human_uat_ready")];

  document.getElementById("meta").textContent =
    `${hs.length} handoffs · ${needCards.length} need you · ${hs.filter((h) => h.supervised_by).length} supervising · updated ${data.generated_at || "?"}`;

  const ac = document.getElementById("allclear");
  ac.hidden = needCards.length !== 0;

  document.getElementById("needs").innerHTML =
    needCards.map(card).join("");

  const board = document.getElementById("board");
  const lanes = COLUMNS.map((col) => {
    const cards = col.states.flatMap(byState);
    return `<section class="col${col.need ? " need" : ""}">
      <h2>${esc(col.label)} <span class="n">${cards.length}</span></h2>
      ${cards.map(card).join("") || '<div class="why">—</div>'}
    </section>`;
  });

  // PR4b (plan 2.6) - a cross-cutting "who is driving this right now" lane per
  // ACTIVE supervisor, appended after the state columns. These cards also appear
  // in their state column above: this is a lens, not a re-bucketing. Stale claims
  // are excluded so an abandoned claim is never read as live supervision.
  const EYE = String.fromCodePoint(0x1F440);
  const supName = (h) =>
    h.supervised_by ? String(h.supervised_by.supervisor || "").split("(")[0].trim() : "";
  const liveSup = hs.filter((h) => h.supervised_by && h.supervised_by.stale !== true);
  const supNames = [...new Set(liveSup.map(supName).filter(Boolean))];
  const supLanes = supNames.map((who) => {
    const cards = liveSup.filter((h) => supName(h) === who);
    return `<section class="col sup-lane">
      <h2>${EYE} ${esc(who)} supervised <span class="n">${cards.length}</span></h2>
      ${cards.map(card).join("")}
    </section>`;
  });
  board.innerHTML = lanes.concat(supLanes).join("");

  // Dedicated "Envoy supervised" tab: the same lanes, alone. Reset/absent render an
  // all-clear so the tab never looks broken when no supervisor is active.
  document.getElementById("supervised").innerHTML = supLanes.length
    ? supLanes.join("")
    : `<div class="allclear"><div class="check">\u2713</div>
        <h2>No active supervision</h2>
        <p>No handoff currently has a live supervisor claim.</p>
      </div>`;

  const foot = hs.filter((h) => FOOTER_STATES.includes(h.state));
  document.getElementById("done").innerHTML = foot.length
    ? `<details><summary>${foot.length} closed / stale (done · superseded · stale)</summary>
        <ul>${foot.map((h) => `<li>${esc(strip(h.title))} — <em>${esc(h.state)}</em></li>`).join("")}</ul>
       </details>`
    : "";
}

// --- Live worker state ---------------------------------------------------------
// Three conditions must never be conflated: switched off, unreachable, and genuinely
// idle. A live panel that renders a dead endpoint as an empty board is worse than none.
function fmtSpan(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s < 0) return "";
  if (s < 90) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtAgo(epochSec) {
  const t = Number(epochSec);
  if (!Number.isFinite(t)) return "";
  return fmtSpan(Math.max(0, Date.now() / 1000 - t));
}

function liveSessionCard(s, i) {
  const tool = s && s.current_tool ? String(s.current_tool) : "(idle)";
  const done = Array.isArray(s && s.done) ? s.done.filter(Boolean).slice(-6) : [];
  const chain = done.length
    ? `<div class="why">${done.map((d) => esc(strip(String(d)))).join(" \u2192 ")}</div>`
    : "";
  const bits = [];
  if (s && s.round != null) bits.push(`round ${esc(s.round)}`);
  const el = fmtSpan(s && s.elapsed);
  if (el) bits.push(`${esc(el)} elapsed`);
  const ago = fmtAgo(s && s.started_at);
  if (ago) bits.push(`started ${esc(ago)} ago`);
  return `<article class="card">
    <div class="state">working</div>
    <h3>Worker ${i + 1} \u2014 ${esc(tool)}</h3>
    ${chain}
    <div class="date">${bits.join(" \u00b7 ") || "\u2014"}</div>
  </article>`;
}

function liveClaimCard(c) {
  const plan = strip((c && c.plan_file) || "(no plan file)");
  const who = c && c.supervisor ? String(c.supervisor).split("(")[0].trim() : "unknown";
  const note = c && c.note ? ` title="${esc(c.note)}"` : "";
  const age = c && c.claimed_at ? fmtAgo(Date.parse(c.claimed_at) / 1000) : "";
  return `<article class="card">
    <div class="state">claimed</div>
    <h3>${esc(plan)}</h3>
    <div class="why"${note}>${esc(who)}${age ? ` \u00b7 ${esc(age)} ago` : ""}</div>
  </article>`;
}

function renderLive(d) {
  const meta = document.getElementById("live-meta");
  const body = document.getElementById("live-body");

  // Switched off: the endpoint answered correctly and said so. Say that, rather
  // than showing an empty board that reads as "nothing is running".
  if (!d || d.enabled !== true) {
    meta.textContent = "Live worker state \u2014 switched off";
    const why = (d && d.reason) || "LIVE_STATE_PUBLIC is off.";
    body.innerHTML = `<div class="allclear"><div class="check">\u25CB</div>
      <h2>Live state is switched off</h2>
      <p>${esc(why)}</p>
      <p>This is a configuration flag, not a fault \u2014 the endpoint answered correctly.</p>
    </div>`;
    return;
  }

  const sessions = Array.isArray(d.sessions) ? d.sessions : [];
  const claims = Array.isArray(d.active_claims) ? d.active_claims : [];
  const degraded = Array.isArray(d.degraded) ? d.degraded : [];

  meta.textContent =
    `${sessions.length} worker${sessions.length === 1 ? "" : "s"} in flight \u00b7 ` +
    `${claims.length} open claim${claims.length === 1 ? "" : "s"} \u00b7 ` +
    `${d.shared_state ? "shared Redis" : "per-process state"} \u00b7 ` +
    `as of ${d.generated_at || "?"}`;

  const warn = degraded.length
    ? `<div class="allclear"><div class="check">!</div>
        <h2>Partially degraded</h2>
        <p>Some sections could not be read: ${esc(degraded.join(", "))}.</p>
      </div>`
    : "";

  const sessLane = `<section class="col">
    <h2>Working right now <span class="n">${sessions.length}</span></h2>
    ${sessions.map(liveSessionCard).join("") ||
      '<div class="why">No worker is mid-task \u2014 nothing is in flight.</div>'}
  </section>`;

  const claimLane = `<section class="col">
    <h2>Open supervision claims <span class="n">${claims.length}</span></h2>
    ${claims.map(liveClaimCard).join("") || '<div class="why">No open claims.</div>'}
  </section>`;

  body.innerHTML = warn + sessLane + claimLane;
}

async function loadLive() {
  const meta = document.getElementById("live-meta");
  const body = document.getElementById("live-body");
  try {
    const r = await fetch(LIVE_STATE_URL, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    renderLive(await r.json());
  } catch (e) {
    // Unreachable says nothing about whether workers are busy -- only that the
    // board could not ask. Never render this as an empty board.
    meta.textContent = "Live worker state \u2014 unreachable";
    body.innerHTML = `<div class="allclear"><div class="check">\u26A0</div>
      <h2>Live state unreachable</h2>
      <p>Could not reach <code>${esc(LIVE_STATE_URL)}</code> \u2014 ${esc(e.message)}.</p>
      <p>This says nothing about whether work is happening; it only means the board
      could not ask. The other tabs read a cached file and still work.</p>
    </div>`;
  }
}

function stopLivePoll() {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
}

function startLivePoll() {
  stopLivePoll();
  liveTimer = setInterval(() => {
    if (!document.getElementById("live").hidden) loadLive();
  }, LIVE_POLL_MS);
}

const VIEWS = { needs: "needs", board: "board", sup: "supervised", live: "live" };

function show(which, opts = {}) {
  if (!VIEWS[which]) which = "needs";
  for (const [key, id] of Object.entries(VIEWS)) {
    const on = key === which;
    document.getElementById(id).hidden = !on;
    const tab = document.getElementById("tab-" + key);
    if (tab) { tab.classList.toggle("active", on); tab.setAttribute("aria-selected", on); }
  }
  // Poll only while the Live tab is actually visible: a background board left open
  // on another tab should not hammer the endpoint every 5s.
  if (which === "live") { loadLive(); startLivePoll(); } else { stopLivePoll(); }
  // The all-clear replaces the Needs-You list only when there is nothing to show.
  document.getElementById("allclear").hidden =
    which !== "needs" || !document.getElementById("allclear").dataset.empty;
  // Reflect the active view in the URL (needs = clean URL) so it survives refresh.
  const norm = which === "needs" ? "" : which;
  if (!opts.noHistory && viewFromUrl() !== norm) {
    history.pushState({ view: norm }, "", viewUrl(norm));
  }
}

async function fetchFirst(urls) {
  let lastErr;
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: "no-store" });
      if (r.ok) return await r.text();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all sources failed");
}

const SPEC_PARAM = "spec";
const VIEW_PARAM = "view";

// Mutate only the params we own, so ?spec and ?view coexist in one URL.
function pageUrl(mut) {
  const u = new URL(location.href);
  mut(u.searchParams);
  return u.pathname + u.search;
}

function specUrl(path) {
  return pageUrl((sp) => (path ? sp.set(SPEC_PARAM, path) : sp.delete(SPEC_PARAM)));
}

function specFromUrl() {
  return new URL(location.href).searchParams.get(SPEC_PARAM) || "";
}

function viewUrl(view) {
  return pageUrl((sp) => (view ? sp.set(VIEW_PARAM, view) : sp.delete(VIEW_PARAM)));
}

function viewFromUrl() {
  const v = new URL(location.href).searchParams.get(VIEW_PARAM) || "";
  return VIEWS[v] ? v : "";
}

async function openSpec(path, opts = {}) {
  const dlg = document.getElementById("spec");
  document.getElementById("spec-title").textContent = path;
  document.getElementById("spec-body").textContent = "Loading\u2026";
  if (!dlg.open) dlg.showModal();
  // Reflect the open spec in the URL so it is shareable and survives refresh.
  if (!opts.noHistory && specFromUrl() !== path) {
    history.pushState({ spec: path }, "", specUrl(path));
  }
  try {
    document.getElementById("spec-body").textContent = await fetchFirst(SPEC_SOURCES(path));
  } catch (e) {
    document.getElementById("spec-body").textContent = "Could not load spec: " + e.message;
  }
}

document.addEventListener("click", (ev) => {
  const a = ev.target.closest("[data-spec]");
  if (a) { ev.preventDefault(); openSpec(a.dataset.spec); }
});

// Closing the dialog (Esc / backdrop / close button) clears ?spec from the URL.
document.getElementById("spec").addEventListener("close", () => {
  if (specFromUrl()) history.replaceState({}, "", specUrl(""));
});

// Browser back/forward: reopen or close the dialog to match the URL.
window.addEventListener("popstate", () => {
  const p = specFromUrl();
  const dlg = document.getElementById("spec");
  if (p) openSpec(p, { noHistory: true });
  else if (dlg.open) dlg.close();
  show(viewFromUrl() || "needs", { noHistory: true });
});
// --- copy a link to the open spec (with a fallback for non-secure/http contexts) ---
async function copyText(txt) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(txt);
      return true;
    }
  } catch (e) { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = txt;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

function flashCopy(btn, ok) {
  const lbl = btn.querySelector(".lbl");
  if (lbl) {
    if (!btn.dataset.label) btn.dataset.label = lbl.textContent;
    lbl.textContent = ok ? "Copied" : "Copy failed";
  }
  btn.classList.toggle("ok", ok);
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    if (lbl && btn.dataset.label) lbl.textContent = btn.dataset.label;
    btn.classList.remove("ok");
  }, 1400);
}

document.getElementById("copy-link").addEventListener("click", async (ev) => {
  ev.preventDefault();
  const btn = ev.currentTarget;
  const ok = await copyText(location.href);   // href already carries ?spec=... when open
  flashCopy(btn, ok);
  if (!ok) { try { window.prompt("Copy this link:", location.href); } catch (e) {} }
});

document.getElementById("tab-needs").addEventListener("click", () => show("needs"));
document.getElementById("tab-board").addEventListener("click", () => show("board"));
document.getElementById("tab-sup").addEventListener("click", () => show("sup"));
document.getElementById("tab-live").addEventListener("click", () => show("live"));

(async () => {
  try {
    const txt = await fetchFirst(SOURCES);
    const data = JSON.parse(txt);
    const empty = !(data.handoffs || []).some(
      (h) => h.state === "blocked_on_human" || h.state === "human_uat_ready");
    document.getElementById("allclear").dataset.empty = empty ? "1" : "";
    render(data);
    show(viewFromUrl() || "needs", { noHistory: true }); // ?view= deep link, else Needs You
    const deepSpec = specFromUrl();
    if (deepSpec) openSpec(deepSpec, { noHistory: true }); // deep link: ?spec=plans/FOO.md
  } catch (e) {
    document.getElementById("meta").textContent = "Failed to load index.json: " + e.message;
  }
})();
