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
  for (const who of supNames) {
    const cards = liveSup.filter((h) => supName(h) === who);
    lanes.push(`<section class="col sup-lane">
      <h2>${EYE} ${esc(who)} supervised <span class="n">${cards.length}</span></h2>
      ${cards.map(card).join("")}
    </section>`);
  }
  board.innerHTML = lanes.join("");

  const foot = hs.filter((h) => FOOTER_STATES.includes(h.state));
  document.getElementById("done").innerHTML = foot.length
    ? `<details><summary>${foot.length} closed / stale (done · superseded · stale)</summary>
        <ul>${foot.map((h) => `<li>${esc(strip(h.title))} — <em>${esc(h.state)}</em></li>`).join("")}</ul>
       </details>`
    : "";
}

function show(which) {
  const needs = which === "needs";
  document.getElementById("needs").hidden = !needs;
  document.getElementById("board").hidden = needs;
  document.getElementById("allclear").hidden = !needs || !document.getElementById("allclear").dataset.empty;
  document.getElementById("tab-needs").classList.toggle("active", needs);
  document.getElementById("tab-board").classList.toggle("active", !needs);
  document.getElementById("tab-needs").setAttribute("aria-selected", needs);
  document.getElementById("tab-board").setAttribute("aria-selected", !needs);
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

function specUrl(path) {
  const u = new URL(location.href);
  if (path) u.searchParams.set(SPEC_PARAM, path);
  else u.searchParams.delete(SPEC_PARAM);
  return u.pathname + u.search;
}

function specFromUrl() {
  return new URL(location.href).searchParams.get(SPEC_PARAM) || "";
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
});
document.getElementById("tab-needs").addEventListener("click", () => show("needs"));
document.getElementById("tab-board").addEventListener("click", () => show("board"));

(async () => {
  try {
    const txt = await fetchFirst(SOURCES);
    const data = JSON.parse(txt);
    const empty = !(data.handoffs || []).some(
      (h) => h.state === "blocked_on_human" || h.state === "human_uat_ready");
    document.getElementById("allclear").dataset.empty = empty ? "1" : "";
    render(data);
    show("needs"); // default landing view is "Needs You"
    const deepSpec = specFromUrl();
    if (deepSpec) openSpec(deepSpec, { noHistory: true }); // deep link: ?spec=plans/FOO.md
  } catch (e) {
    document.getElementById("meta").textContent = "Failed to load index.json: " + e.message;
  }
})();
