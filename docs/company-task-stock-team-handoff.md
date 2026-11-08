# Company-task collaboration / main-branch stock integration

Updated 8 November 2026 against `main` / `origin/main` at `73aba3e`. The user explicitly selected main's implementation; the earlier local stock patch is not reapplied. This is a proposed integration boundary, not an assertion that another team has agreed to it.

## Active baseline

The previous supplied audit describes a different valuation implementation. Use the source now on main:

- Business output divides actual task/review progress by six fixed employee seats, including vacancies. All eight company characters remain, but CEO/Ops receive no additional productivity units.
- Each office tick replenishes routine tasks by active department headcount. Pending, active, paused, and blocked items count toward supply.
- `businessNews` prices explicit disclosures or verified case outcomes once, maps sign by valence/outcome, and deduplicates public/outcome IDs.
- Operating fundamentals remain cash-based. Preserve current weights, including `surprise_bonus: +0.01`.
- `AppliedEvent.custom` / `CustomPriceEffect` carries custom impact, productivity, and duration. Price-owned output shifts persist across ticks.
- Rules-mode `support_colleague` now settles valid task/target references.
- Ordered/deduplicated frame history and the presentation acknowledgement gate remain in place. The UI has sync diagnostics; this feature adds no new clock or scene work.

Do not restore the older local model's eight-seat business denominator, management stewardship bonuses, routine-output string credit, accrual/pipeline formula, alternate weights, or one-tick custom event adapter.

## Scope and ownership

Collaboration simulates CEO briefing, Ops delegation, direct engineer/Sales requests and replies, dependable simulated research, personality-dependent progress/deadlines, review, and outcomes. It produces tasks and company activity; stock remains governed by main's engine.

| Area | Proposed owner / rule |
| --- | --- |
| `server/price.ts`, shared `server/params.ts`, stock audit/acceptance files | Stock owner only |
| Valuation and operating-input calculation in `server/tick.ts` | Stock owner only |
| `server/tasks.ts`, `server/business.ts`, `server/bias.ts`, `server/rules.ts` | Business owner; no concurrent collaboration edits |
| New `server/company-tasks/`, `shared/companyTasks.ts`, dedicated prompts/tests/demo | Collaboration implementation |
| Narrow shared hooks, optional world/API fields, routes/prompt dispatch | One designated integrator against latest accepted main |

No separate price formula, price floor, action retuning, duplicate financial ledger, or second business task allocator. No global complaint/cause gating as part of this feature.

## Minimal adapter contract

1. **Prepare:** create company work using existing Task kinds/factory and canonical `Business.tasks`; keep extra findings/input/version metadata in a sidecar keyed by task ID.
2. **Schedule:** prioritize actionable objective work; retain Ops's authority over capacity, urgent incidents, and replacement after departures. Store displaced routine state rather than permanently locking brief tasks away from management.
3. **Communicate:** process a bounded same-tick request/reply sequence using only delivered agent knowledge and available attention. Record exchanges separately from work output.
4. **Execute:** reuse canonical work/review. A default-preserving remaining-attention argument may be added by the integrator. Keep one canonical WorkResult per employee/tick and do not rewrite persistent allocations just to charge messages.
5. **Observe:** reveal simulated findings from completed work; consume the delivered finding in dependent tasks; derive timing and company outcomes from canonical progress/review.
6. **Apply effects:** use existing accounting/contract/completion helpers and main's verified case/news path with stable IDs. Never write price directly or emit two announcements for the same outcome.

## Task supply and output compatibility

The most sensitive new integration point is routine replacement. Main counts paused/blocked work as open supply, so blanket pausing routine items while hiding them from Ops can suppress replenishment. Company dependencies can also fill that count despite providing no ready work.

Give objective work first priority. Retain binding obligations and urgent response work. Allocate independent ready objective work or existing operational tasks to otherwise available staff. Reuse ready displaced routine tasks; if the ready supply is insufficient, create only the bounded real fallback deficit with the existing factory. Do not build an unbounded paused backlog or fabricate work progress.

Preserve actual-progress semantics and the overwork increment. Management dialogue and individual messages do not create output records or earn synthetic productivity credit. Do not disguise questions as support/report actions, which have their own simulation side effects. Genuine disengagement and blocking remain capable of lowering output and prices.

Preserve canonical work IDs, existing action names, review/defect behavior, stock RNG, fixed employee denominator, current fundamentals, news timing/deduplication, custom effect duration, office-closed handling, and feedback configuration. Keep human-readable exchanges in separate activity fields.

## One brief implementation

The teammate's proposed `shared/brief.ts`, `server/brief.ts`, `server/triggers.ts`, and `/api/sim/brief` are not present at this revision. If their implementation arrives, adopt one shared state/route rather than implementing a competing company-task engine. Do not assign every staff member automatically or prevent deliberate Ops intervention. Department leads can route information without changing the reporting hierarchy.

Adding `cause` later requires the proposal schema, normalization adapter, engine types, selected-action resolution, and log projection to preserve it. Rules fallback is not guaranteed to mean normal work. Global complaint gating changes the stock baseline and must be validated as a separate change.

## Integration evidence

Capture the accepted revision, seed set, run length, business/feedback settings, fixed provider responses/cache, and canonical price/work/accounting series. Use `server/test/price-business.test.ts` and `server/scripts/price-audit.ts` from current main; do not assume the attached audit's old percentages apply.

Verify:

1. No submitted objective: no extra model calls, altered prompts/masks/RNG, changed costs/news, or price differences under the same fixed inputs.
2. Active objective: CEO/Ops delegation, direct research handoff, dependent progress, review, and outcome complete with finite attention and no duplicate work records.
3. Paused/blocked task counts do not accidentally starve ready staff. Early completion still results in real ready work where appropriate.
4. Lazy behavior, genuine blocking, vacancies, and negative shocks remain consequential.
5. Verified good/bad outcomes and disclosures retain valence and deduplication; custom impacts/durations, overwork, overtime, and feedback retain main's behavior.
6. Collaboration is committed to the matching tick frame with stable round order. Reconnect/history replacement cannot duplicate exchanges or financial effects. API/CLI demos use manual Step, or explicitly acknowledge frames when using Play.

Task-on price curves can legitimately differ from no-task runs. The stock owner decides acceptable healthy-run time above 100; collaboration must not retune weights to conceal workload problems.
