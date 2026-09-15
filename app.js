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

const VIEWS = { needs: "needs", board: "board", sup: "supervised" };

function show(which, opts = {}) {
  if (!VIEWS[which]) which = "needs";
  for (const [key, id] of Object.entries(VIEWS)) {
    const on = key === which;
    document.getElementById(id).hidden = !on;
    const tab = document.getElementById("tab-" + key);
    if (tab) { tab.classList.toggle("active", on); tab.setAttribute("aria-selected", on); }
  }
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
