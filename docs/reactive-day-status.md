# Reactive day status — 8 November 2026

All six handover steps are implemented on `reactive-day`. Work remains local; do not push or merge without the owner's instruction.

## Delivered

- Daily business cadence and one billboard shock per 14-workday period; short-run fixtures no longer depend on random arrival times. Frozen legacy price schedules preserve the existing v3 digest.
- Employee work prompts use names, task/evidence keys and readable deadlines. Provider replies restore task versions before existing strict validation. Business prompt safety now runs with business mode enabled.
- News-aware voice styles use claims and management evidence actually delivered to each employee, plus their own assignments/directives. Comfort topics stay out of news hours. Concrete questions about consequences are allowed; repeating a headline as a question remains an echo.
- Office banners show management's actual disclosure and recipients, rather than every private case opening. The business menu retains the spectator's case view.
- `POST /api/sim/presented` gates automatic computation to one hour ahead of the viewer. A run ID rejects stale acknowledgements. Manual Step bypasses the gate; reset, reseed and recovery initialize it again.
- Factual 23:00 daily reports include announcements, cases, departures and late workers, followed by each routine filler day.
- One frontend presentation cursor drives the clock, office, wire, price, charts and employee detail. Frames queue without dropping rounds. Skip completes one round; Next completes typing then advances a line. Empty rounds dwell at the selected speed.
- Narrator lines lead announcements and finish each day. Filler-day clock changes follow those lines. Evening departures grey out after the current round; everyone leaves before the 23:00 report and returns at the next 09:00. Hold for dialogue was removed.

## Shared-contract additions

`office-sim/shared/api.ts`: `DayReport`, optional `TickFrame.day_report`, and `PresentedRequest` (`tick`, optional `run_id`). The acknowledgement endpoint returns the existing simulation response. The earlier optional employee `present` field remains as introduced in step 1.

No dependency, package manifest, lockfile or configuration changes were made. Playback tuning is in `server/params.ts`.

## Verification completed before the owner stopped testing

- Complete server suite: **217 passed**, including localhost SSE and the new presentation API tests.
- UI unit suite: **26 passed**.
- TypeScript check and production build passed.
- Chromium acceptance passed across 1920×1080, 1440×900, 1366×768 and 1280×720. Covered buffered frame stability, Skip/Next, evening presence, narrator/report/filler days, reset/reconnect, speed-scaled quiet dwell and focus. No browser errors.
- Event acceptance: 100 seeds × 12 months, **12,356 roots**, **60.2622% positive**, within the 55–65% target. Quarterly arrival expectation remains about 30 business cases; shock-period invariants are covered by the scheduler tests.
- Approved live comparison used the existing Haiku 5.5 key with a shared conservative US$1 guard. Baseline plus two 40-hour candidate runs: **794 requests**, **1,486,746 input tokens**, **140,548 output tokens**, estimated token charge **US$0.21895**, below the approved cap. Output stays in `/tmp/reactive-baseline.json`, `/tmp/reactive-live.json` and `/tmp/reactive-live-refined.json` on this computer.
- Refined candidate, LLM lines only: **78.3% (65/83)** of lines on news hours touched heard news; **2.4%** headline restatements; **0** shared three-word openers; **0** banned phrases; at least **4** manners in rounds of six or more speakers. Baseline lacks per-agent news metadata, so its new relevance metric is unavailable. This is one seed, not a general quality guarantee.

## Final adjustments not retested

The owner explicitly requested no more tests or images. After that request, a final output guard was added: if the single regeneration still leaks internal labels, task/evidence/claim keys or the word “tick”, the offending spoken or inner field is omitted; decisions and beliefs remain unchanged. This addresses residual leaks observed in the refined live run (one public line, 24 thoughts, plus one counter reference). A presence-label CSS offset was also adjusted to avoid overlapping employee names. These final changes were saved without another test, live call or screenshot.

The real model still sometimes returns invalid employee proposals, which use the existing rules fallback. The 78.3% relevance figure excludes fallback template lines; including them the measured figure was 69.1%. Management's structured decision protocol remains separate from the employee plain-language prompt path. No claim is made that all model-quality targets pass across arbitrary seeds.
