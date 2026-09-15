# sprint-site — `sprint.truesight.me`

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
