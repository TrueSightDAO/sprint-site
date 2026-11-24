> ## ⚠️ RETIRED 2026-11-25 — this board has moved to Jira
>
> `sprint.truesight.me` was **drained into the Jira KAN board and retired** at Gary's instruction.
> All **57** non-terminal handoffs from `handoffs/index.json` were migrated as KAN tickets
> (34 terminal ones — 33 `done`, 1 `stale` — were intentionally not migrated).
>
> **Live board:** https://truesightdao.atlassian.net/jira/software/projects/KAN/boards/2
> **Conventions:** `agentic_ai_context/JIRA_WORKFLOW_SOP.md` (§10 thread URLs, §11 identities, §12 retirement)
> **Tracking ticket:** KAN-79
>
> The site was retired because it had become a **second, competing status surface**: read-only,
> no write path, and unable to express per-ticket stage or ownership. Jira does both.
>
> **`agentic_ai_context/handoffs/index.json` is NOT deleted.** It is still written by the
> supervisor loop and read by other tooling — retiring the *view* is not deleting the *data*.
>
> **Do not resurrect this board.** If you reached this page via an old bookmark, the KAN link above is current.

### ⚠️ Deploy note — read before editing this repo

GitHub Pages serves this site from the **`gh-pages` branch**, not `main`. There is **no** GitHub
Action syncing the two — `gh-pages` is a **hand-maintained copy**. At retirement, `main` and
`gh-pages` `index.html` were byte-identical (md5 `33ec803`, 2530 bytes).

**Any change must be applied to BOTH branches or the live site will not change.** Editing `main`
alone is a silent no-op against https://sprint.truesight.me.

---

# sprint-site — `sprint.truesight.me`

*Original description below is superseded — kept for provenance.*

A public, **read-only** Kanban board over Sophia's handoff pipeline. Implements the board unit
(PR2) of `agentic_ai_context/plans/SPRINT_TRUESIGHT_ME_BOARD_PROPOSAL.md`.

- **No backend, no auth, no write path.** Pure static page; everything is fetched client-side.
- **Data source:** `agentic_ai_context/handoffs/index.json` (public repo), fetched via
  jsDelivr with a `raw.githubusercontent.com` fallback.
- **Columns are the state enum** from `sophia/SUPERVISOR_LOOP.md` §2 — not a new taxonomy.
- **Default landing view is "Needs You"** (`blocked_on_human` + `human_uat_ready`); the full
  Kanban is one click away. A zero-card state renders an explicit all-clear, not a blank page.
- Each card links to its plan-file spec (rendered inline) and its live Telegram/Discord thread —
  the click-through is also the prioritization mechanism (advisory only; a chat message, never an
  automatic override).

Deployed dark (GitHub Pages); DNS (`sprint.truesight.me` CNAME) is mapped in a later unit.
