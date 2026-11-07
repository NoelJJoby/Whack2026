# Backend share price linked to main's stock UI

This revision is based on `origin/main` at `86fc2e6`. It restores the deterministic stock-price backend, retaining main's ticker/dialog, layout, styles, workday, speed controls, seed generation and LLM configuration. The previous standalone `PriceChart.tsx`, extra CSS and feedback UI are absent. The only presentation-file changes wire the existing `StockPrice` component to server snapshots/history and correct its description of the price model. There are no new visual elements.

## Data flow and API

`createWorld` initializes the share price at exactly 100. Each tick uses a dedicated `(seed, tick, '*', 'price')` random stream, applied event headlines, resolved leaks, fixed-seat actions/pre-resolution burnout, and post-quit workforce state. It calculates output EMA, news contributions/corrections and noise before recording. Same-tick quitters contribute their sampled action; their seats become vacant on the next tick. Market corrections affect price news without changing employee beliefs or verification.

`SimResponse.price` is the current public decomposition, `initial_price` is the opening price, and `price_feedback` is the run-level feedback setting. `TickFrame.price` holds the matching recorded snapshot. Existing `history`, `tick` and `state` SSE envelopes are preserved. Hidden claim truth, root lineage and future correction schedules remain outside the price DTO and LLM contexts. HTTP/history/reconnect/reset/new-seed paths all return the matching price state.

The existing `useSimulation` carries the server snapshot through to main's `StockPrice` ticker. Its `stockSeries` now projects `frame.price.price` instead of deriving a separate price from stress/trust. The existing dialog draws those same recorded prices. Its opening percentage uses `100 * (price / initial_price - 1)`. CSS, workday, controls and the rest of main's page layout are unchanged.

Feedback defaults off. Enable it through `POST /api/sim/settings` with `{ "price_feedback": true }` before starting, or CLI `--price-feedback`. Once a run has started, changing feedback returns 409 `reset_required`; reset/reseed preserve settings. No feedback UI is added. Start-of-tick feedback uses only the preceding return, before events/provider contexts, and logs requested and actual deltas with existing trust damping/state clamps.

## Configuration and checks

Price assumptions live in `server/params.ts` and complete parameter snapshots accompany runs. Defaults follow the brief except the shared output reference, recalibrated to **0.902724** for main's updated seeded cast. This is the rounded mean of 300 calm fixed-seat output observations, **0.9027236842661364** unrounded. It stays fixed for all treatments. Initial price 100; output alpha 0.3; news rho 0.95; sigma 0.005; output floor 0.001; price bounds 0.000001–1000000000; correction delay six ticks. Action productivity, news impacts and feedback coefficients/caps retain the brief's starting values.

From `office-sim`:

```sh
node --import tsx --test 'server/**/*.test.ts' src/hud.test.ts
npm run build
node --import tsx server/scripts/run-sim.ts --seed 42 --ticks 30 --mode llm_bias --price-feedback --json
node --import tsx server/scripts/ablate.ts --seeds 10 --ticks 30 --price-feedback --out /tmp/stock-ablation
node --import tsx server/scripts/price-acceptance.ts --out ../docs/share-price-results.json
```

The tests cover pure deterministic valuation, correction timing for false/true/distorted claims, repeated/late leaks, every action, noise isolation, bounds/floors, null morale, quitting snapshots, feedback timing/damping and API/SSE lifecycle. Main's existing speed/seed tests are preserved. Integration tests pass real API snapshots/history through the existing ticker and chart adapter, including reconnect history, false-headline correction, reset and new seed. A separate test changes workforce state while holding server prices fixed, proving the chart cannot recompute the old browser-only indicator.

Before restoring the backend, ten 30-tick shock runs were captured from this main version. Feedback-off reproduces their full agents, claims, records and pre-price logs exactly; SHA-256 **`60aa1c5165833ee271d7954f462b98787ff8d0d49c3899a7ebf98ec7625f569e`**. This checks deterministic stub-provider runs, not live LLM replay.

## Ten-seed measured experiments

Seeds 1–10, 30 ticks, `llm_bias` with deterministic stub provider; main's `fixtureCast(seed)` provides seeded traits, names and starting states. The report saves every initial cast and all parameters. Workforce treatments inject a single event at tick 5, with gossip on and feedback off except the named paired treatment. Isolated equation checks use one constant-work seat, `oRef=1`, sigma zero, no leaks, injection at tick 1.

- Isolated false/true scandal birth impact: `exp(-0.08)-1` = **−7.6884%**. After five ticks news retains **77.3781%**. False news is exactly zero at correction on tick 7; true news never corrects. News-only reversal does not imply full workforce-price recovery.
- Calm price range: **85.2559–111.0973**. **0/10** runs remain in ±5% throughout. This volatility tuning target remains unmet; the common reference calibrates scale, not the sampled action mix or vacancies. Productivity assumptions and feedback strengths remain tuneable.
- Long hours adds exactly +0.02 news at injection. **9/10** prices decline from tick 5 to tick 20. Peaks are measured over ticks 5–20 inclusive; the report saves change from injection and peak.
- Feedback-on ending active trust is lower in **10/10** false-scandal pairs. Different survivor populations can affect this comparison; it is descriptive.
- Pooled morale at `t` versus `ln(P[t+5]/P[t])`: correlation **0.218933**, **250** valid windows, excluding missing morale/incomplete windows. This is descriptive association, not causal evidence.

| Seed | Feedback off / gossip on ending price | Feedback on ending price | Gossip off ending price |
| --- | ---: | ---: | ---: |
| 1 | 80.98 | 79.47 | 89.59 |
| 2 | 82.00 | 82.40 | 89.03 |
| 3 | 90.99 | 91.83 | 92.55 |
| 4 | 96.43 | 96.71 | 99.50 |
| 5 | 97.29 | 95.71 | 100.34 |
| 6 | 100.06 | 100.96 | 105.40 |
| 7 | 88.85 | 88.61 | 94.22 |
| 8 | 103.57 | 105.02 | 105.08 |
| 9 | 103.12 | 99.90 | 102.55 |
| 10 | 96.57 | 94.25 | 99.11 |

`share-price-results.json` includes action mix, each event's return/decomposition, correction records, long-hours peaks/15-tick changes, ending prices, headcount, nullable morale and per-run association counts. No live LLM calls were used. The original brief's frontend additions are superseded by the user's backend-only scope for this revision.

## Final verification

All **135** engine/API/LLM/main-UI tests pass with `node --import tsx --test 'server/**/*.test.ts' src/hud.test.ts`. `npm run build` passes, including TypeScript project checking and production bundling. Main's CSS, Controls, Workday, fixture, LLM directory, package manifest and lockfile match `origin/main` exactly. The main branch is an ancestor of this revision.

A local rules-mode browser run verified the existing ticker at $100.00, then $86.18 after tick 1, the existing dialog showing the same price/history, and reset restoring $100.00. No additional price panel, markers, feedback checkbox or CSS was added.
