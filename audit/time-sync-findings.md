# Time and dialogue synchronization audit

## Scope and outcome

The clock arithmetic is already predominantly shared. The failure is instead
that the client has two independent notions of the current round: the newest
server snapshot drives the HUD and office scene, while an independent dialogue
player consumes (and discards) history frames at its own pace. The fix makes an
ordered presentation queue the screen's source of truth.

## Time calculations

`shared/workday.ts:1-47` is the canonical calendar definition: five ticks per
workday at 09:00, 11:00, 13:00, 15:00 and 17:00. `workdayTime(tick)` is used by
the HUD (`src/Workday.tsx:9`), feed labels (`src/hudModel.ts:17`), prompt clock
(`server/llm/prompt.ts:88`), relative-time prompt helpers
(`server/llm/clock.ts:10-24`), events/businesses, and run persistence. It
therefore gives the backend and frontend identical day/hour results.

The only independent client arithmetic is `src/Controls.tsx:15`, which embeds
`tick / 5` when reporting elapsed calendar days. That is removed in favour of
the shared `calendarDaysElapsed` helper. `server/tick.ts:357` has a `% 5`
recovery rule; it is a simulation rule, not a presentation clock, but is also
changed to use the shared constant so the day boundary has one definition.

`server/llm/prompt.ts:88` tells an agent `workdayTime(ctx.tick)` at the tick
being generated. The prompt never exposes a tick number. It called the helper
multiple times but did not derive time from a different value. The fix captures
that same shared result once per prompt for clarity.

## Tick ownership and ranked causes

1. **HUD/scene and dialogue use different ticks (root cause).**
   `src/App.tsx:57` assigns `hour = state?.tick`, and passes it to `Workday` at
   line 80. `state` is replaced on every SSE `tick` or `state` message by
   `src/useSimulation.ts:96-150`; it is always the newest server snapshot.
   Conversely `src/useDialogue.ts:51-65` starts dialogue only from appended
   history. A line can consequently be stamped tick 8 while the HUD is already
   showing tick 11. Agent visuals at `App.tsx:24-38` likewise read the newest
   state/record, not the line's frame.

2. **The dialogue player is lossy, not a round queue.**
   `src/dialogueQueue.ts:77-104` retains one `pending` round. Each incoming
   frame overwrites it (`case 'round'`), and Auto replaces the unfinished active
   round with it (`advance`). Slow typing, five displayed lines per round, and
   the reading delay can all take longer than the 800ms base tick interval.
   This loses intermediate rounds and separates dialogue further from the HUD.
   Skip has the same one-pending-round behaviour.

3. **Reconnect/history replacement is not a presentation resumption.**
   The server sends a full history on every connection (`server/index.ts:553-
   575`). The client replaces history (`src/useSimulation.ts:105-111`), but
   `useDialogue.ts:56-60` clears the player whenever the history is replaced.
   It has no presented-tick checkpoint or de-duplication by tick. An SSE
   ordering gap causes a history resync at `useSimulation.ts:139-142`; a browser
   refresh starts from all history again and currently clears the bar rather
   than explicitly resuming at its newest frame.

4. **Pause/speed and cosmetic clock animation have separate lifecycles.**
   Typing/auto timers only pause behind a modal (`useDialogue.ts:75-91`), not a
   simulation pause; they are not scaled by speed. `Workday.tsx:11-25` advances
   filler-day animation from its own timers even after a pause. These can make
   the impression of drift even when a completed frame is correct.

5. **LLM latency is not itself a wrong-tick source, but exposes the UI bug.**
   `server/index.ts:262-283` awaits `runTick` and permits only one in-flight
   tick. Lines are enriched into the matching `TickFrame` at lines 301-333.
   A slow model postpones the completed frame; it does not attach its lines to a
   later backend tick. The client then must retain that frame's tick through to
   display, which it did not consistently do.

## Other requested observations

Business cases are already displayed in the Business events area and their
headline is put into the frame at `server/index.ts:316-319`, but ordinary office
wire entries can make CEO/Ops decisions hard to distinguish. This is a separate
UI/product concern, not a time-sync cause. The current seeded scheduling aims
for 60% positive: `server/events/scheduler.ts:20-23`; the measured baseline is
60.3745% positive with common intervals of 10-20 ticks and rare intervals of
40-60 ticks (`docs/events-implementation-status.md:28`). Changing it to 80/20,
adding alert boxes, or requiring a daily-summary acknowledgement changes game
balance/progression and is intentionally not included in this synchronization
fix.

## Design implemented

The client keeps an ordered, tick-deduplicated presentation queue. A single
`presentedTick` selects the `TickFrame` used by the HUD, agent visuals, dialogue
and visible wire. The next frame becomes presented only after the current
round's dialogue completes or is skipped; empty rounds advance immediately.
When more than two future rounds wait, the oldest waiting rounds are skipped
from the bar but remain in the wire/history. On initial history/reconnect the
queue resumes at the latest completed frame without replaying old dialogue.

`TickRecord` is not changed: it already carries `tick`, and `DialogueLine`
already copies the frame tick. The change ensures that stamp is preserved and
that the corresponding frame is what the screen presents.
