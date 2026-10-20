# Blockers & Cross-Agent Dependencies

Running log of anything preventing forward progress. Every blocker has a clear owner and a clear unblocker. Close entries as they resolve — don't delete them (keeps audit trail).

## Format

| Date opened | Blocker | Blocked agent | Can unblock | Severity | Status | Resolution |
|---|---|---|---|---|---|---|

- **Severity:** P0 (shipping blocker) · P1 (next-phase blocker) · P2 (nice-to-resolve)
- **Status:** open · in-progress · resolved · wontfix

---

## Open

| Date opened | Blocker | Blocked agent | Can unblock | Severity | Status | Resolution |
|---|---|---|---|---|---|---|
| 2026-04-19 | Base infra Dockerfiles missing (api, manim-worker, tts-service, stt-service, frontend) — docker-compose.yml references them as placeholders | All runtime agents | Backend + Manim agents | P1 | open | — |
| 2026-04-19 | `QWEN_VL_API_URL` unset — homework mode will hit hosted API by default; needs decision on hosted vs self-host | Frontend (homework flow), Backend (vision.service) | Infra lead | P2 | open | — |
| 2026-04-19 | National curriculum PDFs not yet downloaded; only URLs in `data-pipeline/curriculum/SOURCES.md` | Data-pipeline agent | Cowork / user | P1 | open | — |

## Resolved

| Date opened | Date closed | Blocker | Resolution |
|---|---|---|---|

---

## How to add an entry

1. Append a row to the **Open** table with today's date, your agent name, and the severity you think is right.
2. Ping the "can unblock" agent in daily standup (`daily-standup.md`) so it's visible at handover.
3. When resolved: move the row to **Resolved**, fill in the close date and the one-line resolution.
