# Share Price Implementation Brief

Adapted 7 November 2026 to the current `office-sim` implementation. This is a proposed feature plan, not a statement that share prices are already implemented. It does not change the LLM layer's existing assignment or file ownership.

## Purpose and scope

Add one company share price calculated entirely by deterministic rules. Public news changes the market's news valuation; workforce actions and vacancies change its output valuation. False news loses its market contribution when corrected. Optional price feedback changes workforce stress and management trust on the following tick.

The price module is separate from the bias engine. The existing bias brief's exclusion of share price remains valid for that module.

In scope: one price, an explainable decomposition, seeded noise, market corrections, logs, a chart, and feedback and gossip comparisons.

Out of scope: trading, real market data, multiple stocks, hiring, replacements, employee learning, LLM-selected prices, and changes to LLM prompts or contracts.

## Existing contracts to reuse

- Import `Action` and `EventType` from `shared/types.ts`; do not redeclare them. Engine actions are `work`, `overwork`, `slack_off`, `complain`, `gossip`, `verify`, `interview`, and `leak`.
- Read applied events from the current tick's event results: `{ type, is_true, claim }`. The claim id identifies the headline.
- Read successful leaks from action resolution: `{ agent, claim }`; retrieve truth from `world.claims[claim].is_true`.
- Read claim lineage from `EngineClaim.rootId` and `parentId`. Truth remains engine-side and is never added to `TurnContext` or prompts.
- Read agent state on its existing 0–100 scale. Normalize stress, burnout and trust to 0–1 only inside calculations that require it.
- Use `world.ids` as the fixed seat roster. A quit leaves a vacant seat indefinitely. There is no replacement lifecycle.
- Extend the existing `Params`, world, logs and SSE frame additively, through their respective owners.

## Tick placement and state snapshots

The current `runTick` order is: apply events → provider calls → bias decisions → resolve actions → passive updates → quit check → record.

With this feature:

1. Clone the world and increment the tick, as today.
2. If feedback is enabled, apply the previous tick's return to employees who are active at this point, **before events and provider calls**. This is a new explicit hook, not part of the later passive updates.
3. Apply events, call providers, sample actions and resolve them in the existing order.
4. Run existing passive updates and quit checks unchanged.
5. Calculate price once, before recording, from this tick's events, successful leaks, decisions and workforce snapshots.
6. Record the price and project it into the API frame.

For productivity, use each employee's burnout captured immediately before action resolution, and the action they actually sampled. Anyone active when decisions were made contributes their action's productivity even if they quit at the end of this tick. Employees already quit before decisions contribute zero. A new quit therefore affects output from the next tick. Report headcount and morale from the post-quit state.

The price calculation must not mutate agents, claims, decisions or its prior state. Feedback is a separate rule operation and reads only the previous price return.

## Workforce indices

Productivity per seat per tick, with burnout `b` clamped and divided by 100:

| Engine action | Productivity |
| --- | --- |
| `work` | 1.0 |
| `overwork` | 1.0 + 0.3 × (1 − b) |
| `verify` | 0.6 |
| `complain` | 0.5 |
| `gossip` | 0.5 |
| `slack_off` | 0.3 |
| `interview` | 0.2 |
| `leak` | 0.2 |
| Already vacant seat | 0 |

All productivity values are configurable starting assumptions. Burnout reduces the overwork bonus only; any additional output decline comes through the existing action selection and quitting rules. Do not claim the model directly reduces normal-work productivity with burnout.

Output `O` is total productivity divided by the fixed roster length, normally eight. Reject an empty roster at initialization.

Smooth output:

`oEma = alpha × O + (1 − alpha) × previous.oEma`

Morale is a reported metric only. For post-quit active employees, average:

`0.4 × (1 − stress/100) + 0.3 × (1 − burnout/100) + 0.3 × trust_mgmt/100`

Return `null` morale when no employees remain. Do not substitute zero, which would imply measured low morale rather than no population.

## News and market correction

Every applied event creates one headline item, regardless of whether the engine originally distributes the event as an official announcement or a private rumour. Treating every injected event as immediately market-visible is an explicit modeling assumption for this feature; employee distribution rules remain unchanged.

Every successful leak creates an additional negative item. Multiple employees leaking the same claim create separate shocks; include the agent and tick in each leak item id. Only resolved leaks count, not proposals.

Each item stores:

- unique item id;
- event kind or `leak`;
- actual claim id and root claim id;
- signed log-price impact;
- birth tick;
- actual claim truth;
- scheduled market correction tick for false items, otherwise `null`.

For an event headline, use its claim id as its item id. For a leak, use a stable id such as `leak:<tick>:<agent>:<claim>`.

For a false item, correction is scheduled at `world.claims[claimId].created_tick + refuteDelay`. This clock follows the actual leaked claim, including a distorted child claim, rather than inheriting the truth or creation time of its root. A false headline and leaks of that exact claim therefore correct together. A leak arriving on or after its claim's correction tick contributes zero immediately. Log such an item as born and corrected on arrival. True items have no correction tick.

At tick `t`, an item's contribution is zero if its correction tick is non-null and `t` is at or beyond it. Otherwise:

`contribution = impact × rho^(t − bornTick)`

News level `N` is the sum of contributions. Retain item history for replay; report newly corrected items once rather than on every later tick.

Market correction is a new price-only mechanism. It neither calls the employee `verify` action nor changes claim truth, employee beliefs, source trust or prompts. Employee verification remains local and fallible under existing rules.

Starting impacts:

| Event | Log-price impact |
| --- | --- |
| `merger` | −0.02 |
| `new_management` | −0.01 |
| `long_hours_policy` | +0.02 |
| `pr_scandal` | −0.08 |
| `layoffs_rumour` | −0.03 |
| `surprise_bonus` | −0.01 |
| `competitor_poaching` | −0.04 |
| successful leak | −0.03 |

These are log-price contributions, not exact percentage returns. For example, −0.08 alone implies about −7.7% price change.

## Price, initialization and numerical handling

Initialize at tick zero with price `P0`, `oEma = oRef`, no news, zero return and zero noise. This makes the initial price exactly `P0`.

For each later tick:

`effectiveOutput = max(outputFloor, oEma)`

`rawLogPrice = ln(P0) + ln(effectiveOutput / oRef) + N + epsilon`

Clamp `rawLogPrice` to `ln(minPrice)` through `ln(maxPrice)` before exponentiating. Then:

`price = exp(logPrice)`

`ret = logPrice − ln(previous.price)`

The output floor handles an entirely vacant office. The price bounds prevent numerical underflow and overflow. Log when either guard applies so the decomposition remains explainable. Reject invalid configuration and non-finite inputs rather than silently generating invalid prices.

Noise is a normal draw with standard deviation `sigma`, applied to the price level each tick, not cumulatively to returns. Consequently, a tick return contains the difference between consecutive noise draws. Implement a deterministic normal sampler using the existing `Rng.next()`, guarding against a zero argument to the logarithm.

Add `'price'` to `Purpose` in `server/rng.ts`; obtain its stream with `stream(seed, tick, '*', 'price')`. No existing random stream is reused or advanced.

## Optional feedback

Add `priceFeedback` to run configuration. Default it to `false` so existing runs preserve their workforce behavior. Tick one receives no feedback because tick zero has zero return.

At the start-of-tick hook, set `rPct = 100 × previous.ret`. For every active employee, call the existing `applyDelta` with:

- `trust_mgmt: clamp(0.25 × rPct, −2, +2)`;
- `stress: clamp(−0.3 × rPct, 0, 1.5)`.

These are requested deltas on the 0–100 state scale. Existing state clamps and positive-trust damping still apply. With the current recovery factor of 0.5, a requested +2 trust shift produces +1 actual point, while −2 remains −2. Record requested and actual deltas.

Keep both coefficients and all caps in price configuration. No price numbers, bands or extra sentences are added to prompts. Existing state wording naturally reflects the rule's effects.

## Configuration and module contract

Add a `price` section to `DEFAULT_PARAMS` in `server/params.ts`:

| Parameter | Starting value |
| --- | --- |
| `initialPrice` | 100 |
| `rho` | 0.95 |
| `sigma` | 0.005 |
| `oRef` | 0.85, provisional |
| `outputAlpha` | 0.3 |
| `outputFloor` | 0.001 |
| `minPrice` | 0.000001 |
| `maxPrice` | 1000000000 |
| `refuteDelay` | 6 ticks, fixed |
| trust coefficient / negative cap / positive cap | 0.25 / 2 / 2 |
| stress coefficient / cap | 0.3 / 1.5 |

Include action productivity values and news impacts in the same section. Validate positive reference/floors/bounds, ordered price bounds, nonnegative sigma, positive integer correction delay, `0 < rho <= 1`, and `0 < outputAlpha <= 1`. Log the complete parameter snapshot with each run, as existing runners do for engine params.

Implement a pure `updatePrice(previous, input, params, rng)` using the existing `Rng` type. Inputs contain the tick, applied event items, resolved leak items, fixed-seat action snapshots and post-quit state for reporting. Its result contains a new `PriceState` and `PriceRecord`. Define explicit types for both rather than leaving `PriceRecord` undeclared.

`PriceState` contains tick, price, return, smoothed output and news history. `PriceRecord` contains tick, price, return, raw and effective output, smoothed output, output log component, news level, per-item contributions, born/corrected ids, noise draw, post-quit headcount, morale, feedback setting, feedback deltas and numerical guard details.

Keep engine-only truth and claim lineage metadata out of client price DTOs and all LLM contexts.

## API and interface integration

Preserve the existing `StreamMessage` envelope (`history`, `tick`, `state`) and `TickFrame` fields. Add a price DTO to `TickFrame` in `shared/api.ts`; do not send a new incompatible top-level stream shape. The DTO must include price, return, output/news/noise decomposition, headcount, nullable morale and public event/correction markers. It must omit hidden truth tags and engine-only news metadata.

History includes these enriched frames automatically. Reset clears price history and restores tick-zero price. Expose an initial/current price snapshot additively in `SimResponse`, so clients can show `P0` before the first frame and after reset. Keep `shared/types.ts` unchanged if the additive API DTOs are sufficient.

Extend server settings and CLI configuration to select feedback on/off, with a documented default of off. Treat feedback as a run-level option: changing it requires reset or a new run so ablations have an unambiguous configuration. Existing max-tick settings behavior remains unchanged.

The frontend uses the existing history to draw one price line, headline/leak markers and market-correction markers. Hover details show output, news and noise contributions, plus any numerical guard. Show nullable morale alongside the chart, using an empty-state label when no employees remain.

## Implementation sequence and ownership

This plan describes cross-lane work. Its existence does not grant the LLM lane permission to edit engine, API or frontend files.

1. **Engine owner:** add price parameters and types, the dedicated RNG purpose, the pure price module, and focused module tests. Likely files: `server/params.ts`, `server/engine-types.ts`, `server/rng.ts`, new `server/price.ts`, and new `server/test/price.test.ts`.
2. **Engine owner:** initialize price in `createWorld`; add the start-of-tick feedback hook and post-quit price update in `server/tick.ts`; extend `RunConfig`, `TickConfig`, `EngineTickLog`, run summaries and runner/ablation configuration. Update existing config fixtures to supply the feedback setting without changing their old behavior.
3. **Integration owner:** agree additive DTOs in `shared/api.ts`; populate current price, tick frames and history in `server/index.ts`; add validated run-level feedback configuration and reset handling. Keep existing clients and envelopes compatible.
4. **Frontend owner:** consume the agreed DTOs in `src/useSimulation.ts` and add chart, markers, hover details, morale and feedback controls in the relevant UI files.
5. **Engine and integration owners:** run controlled acceptance scenarios and paired ablations; report measured results and tune parameters. Update documentation with the final values and limitations.

Inspect the current files before each stage; this is a likely file map, not permission for unrelated edits. No LLM-layer implementation step is required.

## Verification and acceptance

### Focused deterministic checks

- Same input state, configuration and seed produce identical price records; prior inputs are not mutated.
- Adding draws to another RNG purpose leaves the price noise draw unchanged.
- Every existing action has an explicit productivity value, including `interview`.
- Same-tick quitters contribute their action this tick and become vacant next tick.
- False items contribute exactly zero from their scheduled correction tick; true items never correct.
- Headline/leak linkage, repeated leaks, late leaks and distorted claims follow the stated policy.
- Noise changes neither news level nor output indices.
- With sigma zero, no events, all seats choosing `work`, and `oRef = 1`, price remains exactly `P0` within floating-point tolerance.
- Zero active employees produces finite positive bounded price, zero headcount and `null` morale.
- Feedback uses the previous return, runs before provider context creation, respects trust damping and never affects quitters.
- With feedback disabled, workforce decisions and state match the pre-feature engine for the same deterministic provider and seed.

### Controlled model checks

Use ten declared seeds, a deterministic stub provider or rules mode, and documented initial states. Separate equation checks from full-workforce behavioral experiments.

- **Isolated false scandal:** with constant output, sigma zero and no leaks, its birth-tick price impact is `exp(-0.08) - 1`; its news contribution is zero on correction. The output component does not need to recover when news corrects.
- **Isolated true scandal:** after five ticks it retains `0.95^5`, about 77.4%, of its initial news contribution, exceeding the 70% target.
- **Long-hours scenario:** the news component gains +0.02 on injection. Measure total-price peak and price 15 ticks later. Treat a later decline in at least eight seeds as a behavioral target to test and tune, not a guaranteed consequence of the equation. A positive total birth-tick return is not required because workforce output can fall on the same tick.
- **Calm calibration:** run 30 ticks with no events under the actual calm action mix. Choose a single `oRef` from baseline output across the declared seeds; never retune it per treatment. Report price ranges and action mix. A ±5% band is a tuning target, not a deterministic guarantee with Gaussian noise and changing workforce output.
- **Feedback experiment:** compare identical-seed false-scandal runs with feedback on/off. Measure trust changes and price trajectories; report whether the predicted stronger trust decline occurs rather than assuming it.
- **Gossip experiment:** compare paired gossip on/off runs, keeping seed, mode, scenario, price params and feedback setting fixed.

Run TypeScript checking and the affected engine/API tests after integration. No live LLM calls are required to verify this feature. Same-seed live LLM runs alone are not a replay guarantee; use deterministic or recorded provider outputs for reproducible workforce comparisons.

## Reported metrics and remaining tuning

Report event-tick return and its decomposition, false versus true scandal news contribution, news-only reversal versus total-price recovery, long-hours peak and 15-tick change, ending prices for paired ablations, headcount and morale.

For morale lead analysis, define the forward five-tick log return as `ln(P[t+5] / P[t])`. Correlate it with morale at `t`, omit missing morale and incomplete windows, and report sample counts. Treat it as descriptive association, not causal evidence.

Remaining tuning decisions are the shared `oRef`, action productivity assumptions and feedback strengths. Correction delay is fixed at six ticks for this version. Hiring and prompt changes are excluded rather than left as implementation-time open decisions.
