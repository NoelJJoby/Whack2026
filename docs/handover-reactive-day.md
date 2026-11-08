# Handover: reactive agents, a full working day, dialogue-synced playback

**Branch:** `reactive-day` (from `main` at `4646c63`). Nothing is pushed or merged; ask the project owner before doing either.

**Current state (8 November, resumed on Theo's computer):** All six steps are implemented. The inherited five failures are fixed. Before the owner's request to stop testing: 217 server tests, 26 UI unit tests, type-check/build and Chromium playback acceptance passed. No push or merge was performed by the resuming agent. See `docs/reactive-day-status.md` for measured results and the final untested adjustments.

The remainder below preserves the original handover as historical implementation context.

## The goal

The project owner's feedback, after Theo's autonomous business events (PR #6) landed:

1. Agents talk about non-problems (pets, the gym, coffee) instead of what's happening, so only their thoughts tell the spectator anything. Make agents on topic and reactive to events and headlines.
2. Events happen too rarely.
3. Every day passing should get an announcement, including days with no events.
4. At the end of the day, people should be greyed out as "left the office", except heavy overworkers and people with a high workload.
5. Dialogue and progression are out of sync. Time, and everything else, mustn't pass until the dialogue has played through, by auto or manual skipping.

**Decisions the owner made** (don't re-ask):

| Topic | Decision |
|---|---|
| Business cases | One every workday. Keep Theo's positive/negative mix (about 60/40, already in `events/scheduler.ts`). |
| Billboard shocks (merger, layoffs, scandal…) | One at a random point in each **14-workday** period (about 2–3 per quarter). |
| Who hears what | Employees hear **only what management shares** (Theo's need-to-know design stays). The banner should show only what the office was actually told. |
| Day length | The working day runs to **23:00** for people staying late: **8 ticks a day (09:00 … 23:00, two hours apart), with Theo's durations rescaled to workdays**. At 23:00 everyone is sent home and the **daily report** is generated. Then every calendar day passing gets an announcement, including Theo's two "filler" days after each workday. |
| Staying late | Costs overtime: Theo's existing `params.rules.overtime` delta. |
| Lookahead | The server may compute **one hour ahead** while the current hour's dialogue plays. |

**Ground rules from the owner:**
- Small commits.
- All tunable numbers go in `office-sim/server/params.ts`.
- Seeded determinism, using the named RNG streams in `server/rng.ts`.
- No new dependencies, and no edits to `package.json`, lockfiles or config files without asking.
- Flag every shared-type change (`office-sim/shared/*`).
- No unrelated refactors.
- Don't push, merge or force-push without asking.

## Why the current behaviour happens (findings)

**A. Agents aren't told about business cases.**
- Case evidence goes only to the CEO and Ops (`events/lifecycle.ts` `openEvent` → `addEvidence(...[owners.ceo, owners.ops])`).
- Employees learn about a case only if management shares it: CEO `choice.communicate` in `management.ts` adds evidence for the listed recipients.
- They also learn of it by being assigned a task. The rules-mode CEO fallback shares nothing (`communicate: []`).
- `buildContext` (`tick.ts`) keeps only claims the agent holds in `ctx.events`, and cases don't create claims.
- **Result:** a case opens and the employees' prompts say "Nothing new has been announced". Meanwhile `index.ts` `advance()` pushes *every* opened case into `frame.events`, so the spectator's banner shows headlines the office never heard.

**B. Archetype and tick leaks in prompts.**
- `llm/prompt.ts` includes `JSON.stringify(ctx.work)`, which contains agent ids (`"supervisor":"ops"`, `"owner":"gossip"`) and tick numbers (`deadline`, `revision`).
- Agent ids **are** archetype labels (`ceo`, `ops`, `gossip`, `climber`, `loyalist`, `skeptic`, `breadwinner`, `flight`), and agents must never see those or tick numbers.
- The leak test `llm/tests/promptSafety.test.ts` runs without business mode, so it misses this.

**C. The voice system steers lines off topic.** That system is in `llm/voice.ts` and `speech.ts`, from an earlier task. On a real run, public lines touching a live event fell from 69% to 29%. The causes:
- Four manners point away from the news: `change_subject`, `deflect_joke` ("not the news itself"), `comment_on_other` and `personal_aside` ("without naming the news").
- The public-line rules in `prompt.ts` say "Don't repeat, quote or name the announcement" and "Your honest reaction goes in your thoughts".
- Comfort topics ("You like to talk about your cat…") appear in every brief.
- The example small talk is non-work by instruction.
- The echo check (`speech.ts` `checkLine`) flags any event key term in the first 5 words, and `thought:echo` flags thoughts that start with the event. Regeneration then pushes lines off topic.

**D. Events are rare.**
- Theo's scheduler opened a common case every 10–20 ticks (2–4 days at 5 ticks a day) and a rare one every 40–60 ticks.
- The billboard schedule was switched off (`index.ts` `tickConfig` `scenario: []`).
- Seed 42 gave 14 routine cases in 150 ticks and no shocks.

**E. The day ended at 17:00, and overtime couldn't happen.** The day was 5 ticks. `isOvertime` is `hour > 17` and the last hour was 17, so Theo's overtime penalty, the prompt clause and the clock label never fired. There was no presence model.

**F. Dialogue and progression are out of sync** (frontend, `office-sim/src/`).
- Only the dialogue bar waits. The clock, office sprites, wire, stock, charts, employee panel and banner all render the newest SSE frame on arrival (`useSimulation.ts` SSE handler, `App.tsx`).
- "Hold for dialogue" (`useDialogue.ts`) is off by default and pauses only after a frame arrives.
- The server's `pause()` (`index.ts`) can't stop a tick in flight, so one extra tick always slips through.
- `dialogueQueue.ts` keeps a single `pending` round: rounds in between are dropped, and with auto on a new round cuts off the current one.
- The cadences don't match: a round is about 40–75 seconds; the server ticks every 800 ms divided by speed.
- The banner (`announcement.ts`) runs on wall-clock timers.

## Done: Step 1 (commit `37de7c3`, all green)

**Workday** (`shared/workday.ts`):
- `TICKS_PER_DAY = 8`, `OFFICE_TICKS_PER_DAY = 5`, hours `[9,11,13,15,17,19,21,23]`. A quarter is 240 ticks.
- New helpers: `isOfficeHour`, `isOfficeClose` (17:00), `isDayStart`, `isDayEnd` (23:00), `dayIndexOf`, and `days(n)` (workdays → ticks).
- `fillerDays` now appear on the 23:00 tick.
- **Bug fixed:** `calendarSpan` rounded to fifths of a day; it now rounds to `TICKS_PER_DAY`.

**Presence** (new `server/presence.ts`):
- Everyone is in at 09:00.
- After 17:00, and again after 19:00 and 21:00, an agent stays only if they chose `overwork` or `workload >= params.rules.stayLate.workloadMin` (65).
- At 23:00 everyone goes home.
- The state lives on `EngineAgent.present`, appears in the shared state as `AgentRuntimeState.present?: boolean` (**shared-type change**), and is logged in `EngineTickLog.presence` (`{ stayed, left }`) on 17:00–23:00 ticks.

**Evening rules** (`tick.ts`):
- Only present agents take turns.
- Present agents get `params.rules.overtime` on overtime hours.
- New cases open and management meets only in office hours.
- Theo's off-shift recovery moved from `t % 5 === 0` to `isDayEnd(t)`, for everyone active.
- Business capacity (`business.ts` `openBusinessTick`) counts present employees only.
- Gossip, complaint and verify targets (`bias.ts` `activeColleagues`) and the prompt's colleague list are limited to people present.
- Price (`price.ts`): on overtime hours the smoothed output holds (`officeClosed`); otherwise empty desks crash the price every night.

**Theo's durations converted to workdays.** The full list is in the commit message of `37de7c3`; please ask Theo to review it. Incident detection deliberately stays "next hour" (+1 tick).

**Tests:**
- Business tests now advance in **office hours**: `advance(w, n)` in `test/business-events.test.ts`.
- The legacy price digest was re-pinned as v3 after checking that the first office day reproduces the old code exactly (method below).
- New `test/presence.test.ts`.
- Run lengths and Controls labels follow the shared constants.

## Step 2: what's left (WIP commit `c475dc3`)

**Done in code:**
- `params.cadence`: `commonEveryDays: 1`, `rareEveryDays: 10`, `shockPeriodDays: 14`.
- `events/lifecycle.ts` `arrival(seed, rarity, index, fromTick)` replaces `interval()`: a common case on a random office hour of the next workday, and a rare one in the next 10-day period.
- `scripts/fixture.ts` `buildScenario`: one shock per 14-workday period at a random workday and office hour.
- `index.ts` `tickConfig` uses `this.billboard()` again, and `run-sim` uses `buildScenario` again (`--calm` gives none).
- `scripts/event-acceptance.ts` was updated.

**Five failing tests, all from one cause.** Short runs (16 or 30 ticks) used to get a shock in the first few ticks from `buildScenario`; now the first shock can be anywhere in the first 112 ticks.

| Test | Fix |
|---|---|
| `test/tick.test.ts` "agents never see truth tags" (around line 144) | Build an explicit scenario with an early event, e.g. `[{ tick: 2, type: 'pr_scandal', isTrue: true }, …]`, instead of relying on `SHOCK_SCENARIO`. Don't weaken the assertion. |
| `test/tick.test.ts` "every tunable lives in params" (around line 202) | Same fix: an explicit early scenario. |
| `test/llm-e2e.test.ts`, both modes ("the scheduled event flow fired", around line 232) | `runWithFake` builds `buildScenario(seed, 16)`. Pass an explicit scenario with events inside 16 ticks. |
| `test/price.test.ts` "feedback off preserves the versioned legacy fixture" | See below. |

**Re-pinning the price digest:**
1. First prove the engine itself is unchanged: run the test's body with the **old** `buildScenario` output (copy it from commit `37de7c3`, or hard-code the old schedules for seeds 1–10 over 30 ticks). The digest must equal the current v3 value `5acc29e7…`.
2. Then re-pin to the new value as v4, with a comment saying only the schedule changed. Alternatively, give this test its own fixed scenario so schedule changes stop affecting it; that's probably better.

Then:
- Run `pnpm exec tsx server/scripts/event-acceptance.ts` (100 seeds, 12 months), and check that positive cases stay between 0.55 and 0.65 (the script sets a failing exit code otherwise).
- Check with stub runs: about 30 business cases per 240-tick quarter, 2–3 shocks, exactly one per 14-workday period.

**How the "first office day matches the old code" check was done:**
1. `git archive <old-commit> office-sim/server office-sim/shared office-sim/src | tar -x -C /tmp/old`.
2. Symlink `office-sim/node_modules` into it.
3. Run the same digest script against both trees, with `ticks: 5`. Drop fields that exist in only one version (`present`, `presence`, and the voice fields `voices`/`examples`/`speech`), and compare the hashes.

## Steps 3–6: not started

**Step 3. Plain-language work context; the banner shows only what was shared.** Files: `llm/prompt.ts`, `llm.ts`, `index.ts`.
- **Replace the `JSON.stringify(ctx.work)` dump** with plain sections that have no ids and no ticks:
  - "What management has told you": evidence delivered to this agent, as `"{text}" from {name}, {heardWhen}`, plus "(unconfirmed)" for rumour certainty.
  - "Your work": tasks as `{title} (key: t1), due {dueWhen}, priority {n}`, then review tasks and support options, by colleague name.
  - "Instructions from management": directive acceptance text with due times.
- **Add `dueWhen`** to `llm/clock.ts`: "by 15:00 today", "by tomorrow 13:00", "in three days".
- **Extend `restoreIds` in `llm/prompt.ts`** (it already maps names → ids and `c1` → claim ids). Add `t1` → `task_id` plus `assignment_version`, and `e1` → `evidence_id`, so Theo's `validEmployeeOutput` (`tasks.ts`) receives exactly what it does today. Reword his instruction line about task_id and assignment_version to use keys.
- **Banner:** in `index.ts` `advance()`, add a business case to `frame.events` only when management communicates it that tick (`communicate` non-empty, or `publicTick === tick`), labelled with who was told. Billboard shocks are unchanged. The Business events menu keeps showing all cases, since that's the spectator's full view.
- **Tests:** prompt and provider tests in business mode, and `promptSafety` extended to business mode, with no ids, archetype labels, the word "tick", or claim or task ids.

**Step 4. Agents react to the news.** Files: `llm/voice.ts`, `llm/prompt.ts`, `speech.ts`, `llm/similarity.ts`, `params.ts`, `scripts/voice-metrics.ts`.
- **Live news** means that within one workday (`params.voice.news.windowTicks`) the agent heard a claim, got management evidence, or got a new assignment or directive. It's computed in `speech.ts` `planRound` and logged as `TurnStyle.news`.
- **On a news hour:**
  - `change_subject` × 0 and `deflect_joke` × 0.5 (as params).
  - Every manner uses a news version of its text, in `describeManner`. For example, practical_question becomes "ask one concrete question about what the news means for your work"; comment_on_other becomes "remark on how {name} is taking the news"; minimal becomes "a one-to-four-word reaction to the news".
  - Comfort topics appear only with change_subject, so only on quiet hours.
- **Public-line rules** in `prompt.ts`:
  - With news: "React to the news in your own words: say what you make of it and what it means for you. Don't read the headline back, and don't open by repeating it as a question."
  - Quiet: "Nothing new: talk about your work, what you've heard, or what's on your mind."
  - Remove "don't name it" and "your honest reaction goes in your thoughts".
- **Thoughts rule:** "what you really make of the news: whether you believe it, what it means for you, what you'll do." Drop the "not with the announcement" clause.
- **Echo check:** redefine it as restating the headline: a first-sentence question containing a key term, or trigram similarity with the headline above `params.voice.speech.echoSimilarity` (0.35). Remove the first-5-words rule and `thought:echo`. Business headlines get key terms from their content words.
- **Example small talk:** ask for "ordinary remarks at work" (`voice.ts` `examplesPrompt`).
- **Metrics:** add a row for "public lines on news hours that touch the news" (target ≥ 70%) and update the echo row.
- **Verify** with a real run: `pnpm exec tsx server/scripts/run-sim.ts --llm --seed 42 --ticks 40 --out <file>` (needs `ANTHROPIC_API_KEY` in `office-sim/.env`, about 300 requests). Force at least one shock by injection or an explicit scenario. Then run `voice-metrics.ts --baseline <old> --new <file> --blind <tick>`.
  - Targets: on topic ≥ 70%; shared openers, banned phrases, and label and tick leaks all 0, business mode included; at least 4 manners per round.
  - The old baseline logs were on the previous developer's machine. To regenerate one, run `run-sim --llm` on commit `4646c63`.

**Step 5. Server gating and the daily report.** Files: `index.ts`, `shared/api.ts`.
- **`POST /api/sim/presented {tick}`** records the furthest tick a viewer has shown. The play loop starts the next tick only when `world.tick - presented < 1` (one hour of lookahead). An ack that opens the gate while running calls `schedule(0)`. Reset, new seed and recovery set the gate to the current tick. `step` ignores the gate.
- **`TickFrame.day_report?`** on 23:00 ticks: `{ day, lines, fillerDays }`, built from facts (no LLM). `lines` covers shared announcements, shocks, cases opened and resolved, quits and layoffs, and who stayed until when, or "No announcements today." Each filler day becomes "Day N: a routine day; nothing happened."
- **Shared-contract additions, flagged:** the endpoint and the field.
- **Tests** (`api.test.ts`): no second tick without an ack; an ack resumes; reset clears the gate; the report appears only on 23:00 frames, with the correct filler days.

**Step 6. The UI presents one hour at a time** (`office-sim/src/`).
- **New `presentation.ts`** (pure) plus `usePresentation`:
  - Frames queue in `history`. A `presented` cursor picks the frame shown, and it advances only when that frame's dialogue round has finished (auto, Next or Skip).
  - Empty frames dwell for `QUIET_DWELL_MS` (1200, scaled by speed). Each advance posts `/sim/presented`.
  - On reconnect or reset, jump to the latest frame without replaying.
- **Everything reads the presented frame:** the clock, office, stress, badges, panel, wire, stock, charts and banner. Only play, pause and speed read the live snapshot. The management "phase" status shows only while the UI waits on the server.
- **`dialogueQueue.ts`:** remove the single `pending` slot. The reducer plays only the presented frame's round, and Skip, or Next on the last line, ends it. Rewrite `dialogue.test.ts`.
- **Narrator lines:** `DialogueLine.kind: 'agent' | 'narrator'`, with no portrait or babble, styled in `DialogueBar.tsx`.
  - Shared announcements and shocks play first.
  - The 23:00 frame ends with the daily report, then one line per filler day. The clock (`Workday.tsx`) steps to each filler day as its line plays, replacing Theo's 250 ms timer.
- **Presence** (`three/Agent3D.tsx`, `three/office3d.css`):
  - During a frame's round, show presence as of the start of that hour.
  - When the round ends, leavers grey out ("Left for the day") and stayers show "Working late".
  - At 23:00 everyone greys out before the report lines.
  - Everyone is back at the next 09:00. Quit and laid-off agents keep their box.
- **Speed (0.5×–4×) scales typing, reading delay and dwell.** Remove the "Hold for dialogue" checkbox and logic.
- **Verify** with `pnpm dev` plus an extended `scripts/verify-ui.mts`:
  - the clock, office and wire don't change until the round ends;
  - Skip advances exactly one hour;
  - greying works at 17:00 and 23:00;
  - the report and filler-day lines appear;
  - an injected event appears at the expected hour.

## Things that will bite you

- **Hidden 5-tick-day assumptions.** Grep for `/ 5`, `% 5`, `* 5` and literal tick counts in business code before trusting a rate. Step 1 caught `calendarSpan` rounding, `scheduler.ts`'s per-day limit, payroll per tick in tests, and run lengths in `src/`.
- **Agent ids are archetype labels.** Never put an id in prompt text. Prompts use names and short keys, and `restoreIds` maps them back.
- **Prompts must never contain "tick" or tick numbers.** Use `llm/clock.ts` (`heardWhen`, and `dueWhen` to come) and Theo's "It is day N, HH:00" line.
- **Evening hours have mostly empty desks.** Anything that averages over the roster per tick (price, metrics) has to account for that.
- **Tests that count provider calls exactly** use `NO_REGEN_PARAMS` or `VOICE_OFF_PARAMS` from `test/helpers.ts`, because the speech post-check can regenerate lines.
- **Beliefs in the e2e test:** a claim heard during an hour is assessed only at the agent's next turn. Someone who goes home at 17:00 has no turn until 09:00, and `llm-e2e.test.ts` encodes this invariant.
- **Runs get long once playback is gated by dialogue:** 240 ticks, about 40–75 seconds per office-hour round at 1×. A shorter default run length is the owner's call.
- **Injected events and lookahead:** with lookahead, an event injected while hour N is on screen lands at hour N+2. The event composer's label should say so.

## Check commands

Run these from `office-sim/`:

```sh
pnpm test                                   # server tests (all should pass after Step 2's test fixes)
pnpm exec tsx --test src/*.test.ts          # UI unit tests
pnpm exec tsc -p tsconfig.json --noEmit     # type-check
pnpm exec tsx server/scripts/run-sim.ts --seed 42 --ticks 40              # stub run, no API calls
pnpm exec tsx server/scripts/event-acceptance.ts                          # business calendar and mix
```
