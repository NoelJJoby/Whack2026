# End-of-quarter report implementation plan

Status: implemented on 2026-11-08.

Implementation notes:

- Quarter facts come from committed journal snapshots, using the shared 240-tick calendar. Legacy archives without tick snapshots keep their existing detailed reports rather than inventing peak prices.
- Completion saves the factual report immediately, then runs a separately bounded AI recap when configured. Pending, successful, unavailable and manually retried versions are retained. Interrupted pending jobs recover once.
- The end screen opens after presentation finishes, defers while another panel is open, and does not reopen after dismissal. It includes evidence, quarter price charts, exports, full-report navigation and new-run controls.
- Editorial titles, the verdict and lessons are AI-generated. Highlight explanations must copy the supplied factual outcome excerpt exactly; this deliberately limits unsupported narrative claims. Autonomous CEO/Ops actions retain their actual actor.
- Verified: full automated suite (318 tests), production build, a 240-tick paced benchmark (96.81 seconds, zero AI calls), and desktop/narrow-screen browser checks for unavailable and ready states, evidence, dismissal, reload and Report-tab navigation. One approved real-provider smoke test returned a validated recap in 2.5 seconds with one request.

The sections below retain the implementation requirements and verification scenarios.

## Intended experience

When the quarter finishes, automatically open an **End of Quarter** screen. Show the company's results immediately and add a short AI recap as soon as it is ready. The headline cards are **Highest Stock Price**, **Best Move**, and **Biggest Blunder**. Keep the report concise, with the existing detailed business report available underneath or through **View full report**.

The recap must work after a two-minute fast-forward run as well as ordinary AI playback. Finishing the simulation never waits for an AI request.

## Existing implementation to reuse

- `office-sim/src/App.tsx` already distinguishes server completion from completion of the final presented dialogue. It currently adds a Business report button to the Office wire; it does not automatically open a dedicated end screen.
- `office-sim/src/BusinessReport.tsx` provides report cards, archives, evidence inspection, regeneration, version selection, and Markdown/JSON downloads.
- `office-sim/src/BusinessPage.tsx` has a Report tab. The current completion button opens Business, which defaults to Objective rather than Report; fix that navigation as part of this work.
- `office-sim/server/index.ts` commits the completed run and starts reporting. Fast-forward currently deliberately requests a factual-only report; the new recap must explicitly run AI analysis after that immediate factual result.
- `office-sim/server/reporting.ts`, `server/run-store.ts`, and `shared/reports.ts` provide frozen facts, durable evidence, report storage, and deduplicated generation.
- The current report prompt only permits copying evidence text and selecting preset recommendations. New editorial highlights need a dedicated structured recap contract rather than merely changing the prompt wording.

I did not find a standalone EndScreen component in this checkout. Extend the existing completion/report flow; if a separate end-screen component is brought in from another branch before implementation, put the same report content inside it.

## Report contents

| Item | What appears | How it is derived |
| --- | --- | --- |
| Quarter summary | A short AI-written assessment of how the quarter went | Frozen metrics and observed event outcomes |
| Highest Stock Price | Exact price, simulated date/time, and change from the quarter's opening price | Maximum of the committed opening price and every tick price in this quarter |
| Best Move | A punchy title, the action and actor, and one or two sentences about the observed benefit and trade-off | AI selects a supported decision/outcome candidate |
| Biggest Blunder | A punchy title, the action or documented missed response, and one or two sentences about the observed downside | AI selects a supported decision/failure candidate |
| Closing figures | Closing stock price and return, revenue against target, cash, retention, morale and trust changes | Existing report metrics extended where needed |
| Next quarter | Up to three short lessons | Recommendations tied to the selected highlights or unresolved issues |

Every highlight has a **View evidence** action opening its decision, event, task or ledger evidence. Clearly identify whether the action came from the player, the simulated CEO, Ops, or an employee. Do not credit the player for an autonomous management decision.

Highest Stock Price is a computed statistic. AI may comment on it, but never calculates or supplies the displayed number. Do not imply that the best move necessarily caused the price peak.

For a quiet quarter, display **No clear standout move** or **No clear blunder recorded**. An external supplier outage alone is not a management blunder. An unresolved case is not automatically a failed response, and a signed contract is not earned revenue.

## 1. Build a quarter-scoped facts bundle

Add a pure summary builder, for example `office-sim/server/quarter-summary.ts`, using the durable journal rather than the visible Office wire or browser history.

1. Identify the quarter's opening snapshot, ticks and final committed cutoff using `TICKS_PER_QUARTER` and the shared workday/calendar helpers.
2. Compute opening, closing, highest and lowest prices; opening-to-closing return; and the exact peak tick. Include the opening price when it is the maximum, use the earliest occurrence for tied peaks, and label an opening peak as **Start of quarter**.
3. Calculate quarter-specific financial totals and start/end workforce metrics. Carry-forward obligations can contribute outcomes this quarter, but earlier-quarter revenue and decisions must not be counted as new activity.
4. Build a short price series for the report chart. Mark the peak and link selected highlights to the timeline without implying causation.
5. Create typed candidate stories linking actual management choices, directives, work, event milestones, outcomes and ledger entries. Include who acted, what was known then, observed benefits/costs, outstanding risks, and stable evidence IDs. An intended saving without an executed saving cannot be a measured success.
6. Rank a bounded shortlist deterministically by recorded outcome, severity, monetary impact where attributable, deadlines and people impact. Preserve the distinct measures instead of inventing a universal money-versus-wellbeing score. Include positive, negative and unresolved stories in the AI input.
7. Store the quarter number, tick range, cutoff sequence and facts hash with the summary.

Correct the existing hard-coded 150-tick quarter calculation in `reporting.ts` while adding these metrics: this simulation uses 240 ticks per quarter. Use the shared calendar mapping, including an explicit rule for opening/tick-zero entries.

For the initial release, automatically show the report at the end of the default one-quarter run. A shorter configured run is labelled **Run summary · partial quarter**. A two-quarter run gets separate Q1/Q2 summaries in its final report; each quarter uses its own frozen cutoff and facts. Do not interrupt an ongoing two-quarter run at Q1's boundary.

## 2. Add structured AI highlights

Extend `shared/reports.ts` with an optional versioned `quarterSummary` payload so existing saved reports remain readable. Keep exact metrics, candidate stories and the AI recap as distinct fields. Suggested recap fields:

```ts
interface QuarterRecap {
  status: 'pending' | 'ready' | 'unavailable';
  summary: string;
  bestMove: Highlight | null;
  biggestBlunder: Highlight | null;
  lessons: Array<{ text: string; evidenceIds: string[] }>;
}

interface Highlight {
  candidateId: string;
  title: string;
  explanation: string;
  evidenceIds: string[];
  metricIds: string[];
}
```

Add a dedicated recap prompt and schema alongside `server/llm/report-prompt.ts` and `server/llm/schemas.ts`:

- Give the model computed stats and compact candidate stories, not the entire growing transcript.
- Ask it to select the strongest supported move and blunder, explain the observed outcome, and write a short quarter verdict. “Best” and “biggest” are explicitly AI assessments.
- Require valid candidate/evidence/metric references and short text limits. Permit null selections when there is insufficient evidence.
- Render exact amounts, percentages, names and timestamps from canonical fields. Ask the model to avoid duplicating figures in prose.
- Treat event headlines, dialogue, custom inputs and objectives as untrusted data. Reject unknown references, out-of-quarter selections, unsupported outcome labels and malformed output. Do not describe an unchosen alternative as something that happened or blame someone using information unavailable at the time.
- Keep a factual evidence excerpt beside each assessment. Reference validation cannot itself prove arbitrary prose is accurate; restrict the prompt to supplied outcomes and fall back when an answer cannot be supported.

## 3. Generate after completion, including fast-forward

1. Commit the last tick and completed-run marker as today.
2. Build and save the factual quarter summary immediately. Publish completion and make the report usable without AI.
3. Queue one automatic AI recap job when a key is configured, including after fast-forward. Keep deterministic rules for the fast simulation itself.
4. Use a single ten-second wall-clock budget for the recap job, with at most one recovery attempt if budget remains. This is separate from simulation tick timing and the longer detailed-report generation path.
5. Persist the validated recap as a report version linked to the same frozen facts. Publish a state update so the screen fills in without a refresh.
6. Deduplicate by run ID, quarter, cutoff, facts hash and recap prompt/schema version. Reconnects and repeated completion notifications must not issue duplicate calls. Manual retry creates a retained version.
7. If the user starts a new run while analysis is pending, finish saving the old run's report without opening it over the new run. Recover an interrupted pending job once after restart; retained successful jobs are not automatically regenerated.

With no key, a timeout, or invalid output, retain the computed metrics and factual outcome cards. Label the AI recap **Unavailable** and offer **Retry AI recap**. Avoid making a factual selection look AI-generated. Preserve the two-minute simulation target; AI loading is shown separately and never holds the completion screen closed.

## 4. Open and display the end screen

Add `office-sim/src/QuarterReport.tsx` and reuse the report card, stock chart and evidence views where practical.

- Open automatically once the final presented tick finishes. Do not wait for AI readiness. If another menu is open, defer auto-opening until it closes so it does not interrupt a form or discard input.
- Show **Quarter complete**, the company/run identity, summary stats, the three headline cards and the stock chart. Use loading placeholders only for the AI text.
- Offer **View full report**, **Back to office**, **Download report**, and **New run**. Viewing or dismissing the report never resets the company. The existing report entry reopens it.
- Open only once per run/quarter completion in the current session. On reload of a completed run, show the saved report again; after dismissal, subsequent report/SSE updates must not reopen it. Raising the run length or changing runs clears the completion transition appropriately.
- Pass an explicit initial Report tab when opening the existing Business panel from **View full report**. Follow the current run ID when the selected archived run changes, and use that run's cast/evidence.
- Use accessible dialog semantics, keyboard dismissal, focus restoration, scrollable content and a narrow-screen layout. Keep pending, ready and unavailable AI states legible without hiding the results.
- Include recap highlights and exact metrics in the existing Markdown/JSON exports. Older reports without a recap still render using the current report UI.

## 5. Verification and delivery order

1. **Facts first:** quarter summary builder and fixtures covering an opening peak, tied peaks, intra-quarter price spikes, early completion, the 240-tick boundary, and two quarters with different results.
2. **Evidence and AI:** candidate linkage, selection schema, request deduplication, persisted versions, ten-second deadline, invalid references, quiet quarters, no API key, factual fallback and retry. Verify an external adverse event alone cannot qualify as a blunder.
3. **End screen:** automatic opening after presentation completes, immediate facts while AI is pending, no reopening after dismissal, reload/reconnect, correct Report-tab navigation, starting a new run during generation, and archive inspection.
4. **Integration:** complete a 240-tick fast-forward run. Confirm facts appear immediately at completion, one AI recap request starts afterwards, the screen updates when it finishes, and the report survives restart with identical peak values and source links.
5. Run the full automated suite and production build. Re-run the paced quarter benchmark to ensure factual reporting still completes within two minutes, then verify both successful and unavailable AI states in the browser. Use mocked providers for deterministic failure cases and one bounded real-provider smoke test for narrative quality when credentials are available.

Acceptance: a completed quarter opens a usable report automatically, shows an exact highest stock price and its date, adds supported AI-generated Best Move and Biggest Blunder cards, exposes their evidence, and remains fully usable when AI is unavailable.
