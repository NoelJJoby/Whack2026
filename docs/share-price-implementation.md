# Share price implementation and measured acceptance

Implemented 7 November 2026. The price is a synthetic deterministic valuation, with seeded Gaussian level noise. No market data, trading, prompt changes or live LLM calls are involved.

## Run and inspect

From `office-sim`:

```sh
node --import tsx server/scripts/run-sim.ts --seed 42 --ticks 30 --mode llm_bias --json
node --import tsx server/scripts/run-sim.ts --seed 42 --ticks 30 --mode llm_bias --price-feedback --json
node --import tsx server/scripts/ablate.ts --seeds 10 --ticks 30 --price-feedback --out /tmp/price-ablation
node --import tsx server/scripts/price-acceptance.ts --out ../docs/share-price-results.json
node --import tsx --test 'server/**/*.test.ts'
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/vite build
```

Feedback defaults off. `--price-feedback` enables it for a complete CLI run; `--no-gossip` selects the gossip ablation. The HTTP settings route accepts `{ "price_feedback": true }` before starting. Changing this option after start requires reset (409 `reset_required`); repeating the current value is allowed. Reset preserves settings, clears news and chart history, and restores exactly 100. Run-length settings retain their existing behavior. Stream envelopes remain `history`, `tick`, and `state`, with an added public price snapshot and an enriched frame.

The chart shows one price line from tick zero, headline/leak dots and correction diamonds. Hover, focus or tap a point to see its output/news/noise log-level decomposition, workforce report and numerical guards. No remaining employees displays “No employees remain” for morale. Returns are explicitly labeled log returns.

## Parameters and model boundaries

All parameters live in `server/params.ts`; complete snapshots accompany CLI run logs and API responses. Values from the brief are retained except `oRef`, calibrated once to **0.895633**, the rounded mean fixed-seat output of the 300 calm observations below (unrounded 0.895632537996569). That same reference is used for every workforce treatment. The isolated equation checks use `oRef = 1`, constant work, zero noise and no leaks by design.

Initial price 100; output EMA alpha 0.3; news persistence 0.95; noise sigma 0.005; output floor 0.001; bounds 0.000001–1000000000. Correction delay remains exactly six ticks. Productivity, news impacts and feedback coefficients/caps retain the brief's starting values. Normal-work output has no direct burnout penalty; burnout reduces only the overwork bonus. All injected events are immediately market-visible, including privately distributed employee rumours. Successful leaks each cause their own shock. Market correction changes price news only, leaving employee verification and beliefs unchanged.

Tick order is previous-return feedback → events → providers → decisions → action resolution → existing passive updates and quitting → price → record. Productivity uses pre-resolution burnout and sampled actions. An end-of-tick quitter contributes until the next tick; the fixed denominator never shrinks. Post-quit headcount and morale are reported separately. Truth, root lineage and scheduled corrections remain outside public price DTOs and LLM contexts.

## Declared experiments

Seeds **1–10**, 30 ticks, deterministic stub provider, `llm_bias`, fixture cast and seeded trait jitter from `server/scripts/fixture.ts`. Initial stress/workload/loyalty/trust/burnout:

| Seat | Stress | Workload | Loyalty | Trust | Burnout |
| --- | ---: | ---: | ---: | ---: | ---: |
| CEO | 35 | 55 | 80 | 80 | 20 |
| Ops manager | 45 | 55 | 65 | 60 | 35 |
| Gossip hub | 35 | 45 | 55 | 50 | 25 |
| Climber | 40 | 55 | 50 | 55 | 30 |
| Loyalist | 30 | 50 | 85 | 75 | 10 |
| Skeptic | 40 | 45 | 45 | 25 | 30 |
| Breadwinner | 45 | 55 | 60 | 50 | 35 |
| Flight risk | 50 | 50 | 35 | 40 | 50 |

Calm has no events. Workforce treatments inject one event at tick 5. Gossip is on except the paired gossip-off arm. Feedback is off except the paired feedback-on arm. Isolated equation checks inject the scandal at tick 1 for a constant-work seat and run through tick 8. Full results, parameter snapshot, event returns/decomposition, post-correction news, peaks, ending prices, headcount, morale and per-run association sample counts are in `share-price-results.json`.

- **Isolated scandal:** false and true birth price changes both equal `exp(-0.08)-1`, **−7.6884%**. Five ticks later both retain **77.3781%** of the original news contribution. On tick 7 the false contribution is exactly zero and its price returns to 100 under constant output; the true contribution remains negative and never corrects. In workforce runs, other output changes and additional leak items can prevent total-price recovery after news correction.
- **Calm calibration:** observed price range **79.7381–112.4006**. **0/10** seeds stayed within ±5% for all 30 ticks. Action shares: work **51.42%**, overwork **24.50%**, slack off **4.90%**, complain **12.77%**, interview **6.41%**; gossip, verify and leak zero. The calm band remains an unmet tuning target, chiefly because sampled workforce output and vacancies vary; the mean reference calibrates scale, not volatility. Output assumptions and feedback strengths remain tuneable. No treatment-specific reference was fitted.
- **Long hours:** the news component gains exactly **+0.02** at tick 5. **9/10** prices are lower at tick 20 than at injection, meeting the eight-seed behavioral target. The peak window is ticks 5–20 inclusive; the saved report includes both log change from injection and from the peak. A positive total injection return is not assumed.
- **Feedback:** ending active-employee trust is lower with feedback in **10/10** paired false-scandal runs. This compares surviving active populations; it is descriptive and does not isolate a causal trust effect. Price trajectories differ, with feedback-on ending lower in **8/10** pairs.
- **Gossip:** gossip-on ends lower in **9/10** paired false-scandal runs. This is measured behavior of the deterministic stub and rules, not a guarantee about live LLM behavior.
- **Morale lead:** pooled false-scandal feedback-off association between morale at `t` and `ln(P[t+5]/P[t])` is **0.139774**, **250** valid windows. Missing morale and incomplete windows are omitted. This pooled association is descriptive, not causal evidence.

| Seed | Feedback off ending price | Feedback on ending price | Gossip off ending price |
| --- | ---: | ---: | ---: |
| 1 | 81.80 | 83.19 | 84.86 |
| 2 | 91.30 | 92.39 | 89.67 |
| 3 | 90.51 | 89.64 | 96.85 |
| 4 | 87.14 | 82.31 | 92.63 |
| 5 | 94.85 | 93.92 | 101.07 |
| 6 | 98.34 | 96.86 | 106.77 |
| 7 | 87.45 | 87.03 | 87.69 |
| 8 | 103.97 | 103.50 | 106.12 |
| 9 | 103.60 | 103.46 | 104.02 |
| 10 | 94.40 | 85.91 | 100.18 |

The feedback-off column is also the gossip-on baseline. Seed, mode, scenario, price parameters and feedback remain fixed within gossip pairs.

## Verification

All **127** engine/API/LLM tests pass. TypeScript checking and the production Vite build pass. The controlled acceptance report reproduces byte-for-byte on rerun.

Focused checks cover equation invariants, pure updates and input immutability, dedicated RNG independence, all eight actions, pre-resolution burnout, quit timing, exact corrections, distorted children, true claims, repeated and late leaks, noise levels, bounds/floors, empty population, invalid configuration and nonfinite inputs, feedback timing/damping/clamps, API/SSE/history/reset and public DTO metadata exclusion.

Before changing the engine, ten 30-tick shock runs were captured. The focused regression hashes the same workforce states, claims, records and decision logs after removing the added price record. All match exactly with feedback off (SHA-256 `bf2fc6d48ccc1c7719c164c626215de6a2f4ff883a1a4edffe051e14e1ed5470`). It guards behavior of deterministic provider runs; same-seed live LLM calls are not a replay guarantee.

Local browser checks verified initial 100, a streamed tick with headline marker and decomposition, feedback locked after start, and reset restoring 100, clearing the line and unlocking configuration. Existing shared simulation types and all LLM files remain unchanged.
