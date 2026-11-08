# Company task and collaboration simulation — backend implementation plan

Updated 8 November 2026 against `main` at `73aba3e` (fast-forwarded from `dc8cffd`). Source under `office-sim/` matches `origin/main`; the old local stock patch has not been reapplied. This is the implementation plan, not a claim that the company-task feature is already implemented.


## Current main baseline — takes precedence over the earlier audit

The user requested the implementation from remote `main`, rather than the previous uncommitted local valuation variant. The earlier supplied audit is historical context and is not the active architecture or a performance guarantee for this revision.

| Present on main | Implementation consequence |
| --- | --- |
| Six fixed employee seats in business-mode `operating.seats`; CEO/Ops excluded from the productive denominator | Retain all eight company characters, but do not add manager stewardship units or revert to an eight-seat business denominator |
| Actual canonical work progress, including overwork, supplies `productiveUnits` | Company work must use real simulation task effort/review; a conversation alone does not receive synthetic output credit |
| Routine task supply replenishes each office tick to match active department headcount | Replace routine work carefully: paused and blocked tasks count as open supply, so blanket pausing can suppress replenishment and starve available staff |
| Verified positive outcomes, failed cases, and explicit public disclosures reach `businessNews` once | Preserve outcome timing, valence mapping, and deduplication; task creation or an internal reply is not automatically good market news |
| Custom effects use `AppliedEvent.custom` / `CustomPriceEffect`; productivity shifts persist for the configured duration | Preserve the new event shape, price-owned shifts, and replacement of the base impact; do not restore the old `event.impact` adapter |
| Cash-based operating fundamentals and `surprise_bonus: +0.01` | Keep current formulas and weights; do not import the local audit's accrual/backlog formula or different weights |
| Rules-mode support settles a legal colleague/task | Reuse this repair without inventing support actions for ordinary questions |
| `orderedFrames` deduplicates/orders history; the presentation cursor and acknowledgement gate remain authoritative | Append ordered collaboration activity to its committed frame; no new clock, mid-frame scene mutations, duplicate frames, or bypass of acknowledgement |
| Sync diagnostics and updated Three.js dependency/lockfile | Preserve these additions; no scene/dependency work is required for this backend feature |
| `server/test/price-business.test.ts` and `server/scripts/price-audit.ts` | Use these as current stock acceptance and baseline tools, with fixed providers for repeatable comparisons |

Not yet present in this main revision: `shared/brief.ts`, `server/brief.ts`, `server/triggers.ts`, `/api/sim/brief`, or the teammate's causal-proposal implementation. Their pasted plan must not be mistaken for landed code. If that implementation lands later, adopt its brief state/route rather than create a second engine, and reconcile it before shared-file edits.

## Coordination with the stock-price team

**Collaboration changes what the simulated company does; the main-branch stock engine retains ownership of what that activity is worth.** Do not implement a second output formula, price floor, or compensating calibration.

| Ownership | Files / responsibility |
| --- | --- |
| Stock owner, protected | `server/price.ts`, shared `server/params.ts`, stock acceptance/audit files, and price inputs/valuation in `server/tick.ts` |
| Business owner, shared hot spots | `server/business.ts`, `server/tasks.ts`, `server/bias.ts`, `server/rules.ts`; task supply, work masks, accounting, and canonical progress |
| Collaboration implementation | New `server/company-tasks/` modules, `shared/companyTasks.ts`, dedicated prompts/tests/demo, and feature-local configuration |
| One integration owner | Narrow tick/task hooks, management scheduling view, optional world/API fields, and route/prompt dispatch; no simultaneous shared-file editing |

Develop new modules against a small adapter. Integrate against current main with a single owner and review every shared hunk. Preserve the six employee seats including vacancies, actual progress, overwork increment, routine supply, `businessNews`, custom effect duration, configured feedback, and price RNG. The old local model's management bonuses, routine-output string credit, and accrual/pipeline formula are explicitly excluded.

With no company task, hooks return immediately and preserve baseline behavior: no extra model calls, changed prompts/action masks, RNG draws, costs, news, or prices. New activity uses namespaced random keys and never consumes the price noise stream. With a company task, prices can legitimately change because staff spend time differently and outcomes differ; matching a historical percentage above 100 is not a feature guarantee.

Do not globally implement the teammate's complaint-trigger mask or cause-based fallback as part of this feature: it changes ordinary-run behavior and needs a separate stock baseline. Cause metadata may be additive, but any future cause implementation must survive the proposal adapter and record the final sampled action's cause, including rules fallback; it cannot assume fallback always means normal work.

Use one brief state, one task list, and one submission route. Do not assign every employee automatically or exclude brief tasks permanently from Ops; relevant agents work within capacity, and Ops retains deliberate reprioritization, incident response, and replacement authority. Acting department leads can route information without changing the existing supervisors.

See `docs/company-task-stock-team-handoff.md` for the updated shareable integration boundary.

## Deadline release: five and a half hours

The complete plan below is a roadmap. Implementation will be performed by Codex, not manually by the user. The originally discussed 330-minute window is a reference budget; assess the actual remaining window when implementation starts rather than resetting the deadline on each planning update. Use short autonomous implementation and verification checkpoints rather than treating each module as hours of human coding. With 330 minutes available, the full core behavior is a reasonable target, with optional depth added after an end-to-end run passes. The ranges below are provisional wall-clock budgets, not measured throughput or a delivery guarantee; actual checkpoint results determine the next scope decision.

**Release acceptance story:** submit a hypothetical objective through the API; CEO states assumptions and briefs the team; Ops assigns work; an engineer asks Sales for research; Sales answers from completed simulated work or reports it is unfinished; personality-driven effort affects progress and deadline timing; review produces an outcome; existing costs and stock respond; the ordered history is inspectable through backend data.

Keep for this release:

- One active company task; reject an additional active submission clearly instead of implementing a queue.
- A bounded three-to-six-item workflow using existing task, dependency, allocation, and review mechanisms. CEO interpretation tailors the brief and task content to the prompt; universal support for arbitrary organizational workflows is deferred.
- A small collaboration vocabulary: request information, reply/share a finding, and escalate a priority conflict to Ops.
- At most one request/reply sequence per participating pair in a tick, with a global cap and an explicit attention cost. No general meeting engine.
- Existing trait/state-driven work choices, deadlines, stress, gossip, events, and departures. Add causal task status and timing records; do not redesign personality or social systems.
- Pause routine work while active, preserve binding obligations and urgent incident work, and share the existing allocator.
- Reuse payroll, work accounting, valuation, journals, and SSE. Produce existing-format task/work records and validated business-effect requests through a small adapter; the stock team owns their numeric valuation and market-news routing.
- Structured CEO/Ops decisions and addressed conversations in API/tick history, with readable dialogue and a backend demo script. No frontend work.
- Basic input validation, duplicate protection, run/reset checks, persistence through existing snapshots, and explicit rules fallback.

Defer general-purpose meetings, arbitrary negotiation/replanning, finding revision propagation, multiple active tasks or queued tasks, new history infrastructure, extensive multi-seed calibration, and a complete work-result/price refactor. Reuse current review/rework and staff-reassignment behavior where it already works.

| Elapsed time | Codex work budget | Gate |
| --- | --- | --- |
| 0–15 minutes | Record stock-team ownership, inspect current changes, freeze adapter contracts | Shared-file integrator and baseline procedure specified |
| 15–50 minutes | Implement intake, CEO/Ops flow, work links, workload replacement, snapshot defaults | Submit and step yields a valid staffed workflow |
| 50–95 minutes | Implement bounded conversations, findings, handoffs, escalation, attention accounting | A delivered finding actually enables dependent work |
| 95–125 minutes | Integrator applies minimal shared-file hooks against the stock-team baseline; connect outcomes/activity | First complete end-to-end simulated task using their valuation |
| 125–180 minutes | Run focused/regression checks, build, API demonstration, and bounded live-model checks; fix failures | Verified core story and explicit model/fallback behavior |
| 180–270 minutes | Add highest-value deferred depth only after the core passes; repeat relevant verification | Improved behavior without sacrificing the working baseline |
| 270–330 minutes | Freeze features; fix defects, rehearse representative tasks, document setup/results | Reproducible backend demonstration |

Target a first integrated run in roughly two hours and reassess against observed progress by the three-hour checkpoint. Do not interpret generated code as verified completion: model latency, test execution, debugging, and integration still consume wall-clock time. If a gate slips, simplify optional workflow and conversation choices. Protect the final verification and fix window. Rules fallback must remain labelled and functional; test the model-driven path separately before claiming it works.

The deferred items above describe the first integration baseline, not a blanket cut from the entire 330-minute window. Once that baseline passes, prioritize deeper meetings, richer role decisions, and additional representative tasks as time permits. Multiple active objectives and broad infrastructure refactors remain lower priority. This schedule assumes the current single-agent implementation stream; it does not assume additional agents have been authorized or started.

Backend completion means inspectable API/stream history. Existing frontend code will not automatically animate or display every new exchange; that requires a separately implemented client integration. New scene choreography remains outside this release.

## 1. Confirmed scope

This remains a company simulation. A user supplies a hypothetical company task; the backend simulates how the CEO, Ops, engineers, and Sales interpret it, delegate, communicate, work, and reach an outcome.

The implementation is backend only. It supplies structured activity and dialogue for the existing client or future presentation work. There is no task-entry UI work in this scope. Research, engineering, reports, and launches are all simulated company activities; no research browsing, code executor, deployment service, or actual product delivery is required.

Confirmed behavior:

- Keep the existing cast, personalities, stress, burnout, gossip, relationships, departures, stock price, and random business events.
- The CEO interprets a hypothetical task, records assumptions, and proceeds autonomously.
- Employees contact other departments directly. Managers resolve priority and capacity conflicts.
- Communication stays reliable. Personality shapes tone and work behavior; it does not introduce fabricated findings, deliberately corrupted handoffs, or arbitrary misunderstanding into the task channel.
- Delivery depends on personality and state. For example, an agent more likely to disengage should be more likely to fall behind and miss a deadline.
- User-task work replaces routine background work while active. Its work and outcomes affect simulated costs, finances, and stock price.
- Short, bounded conversations can happen within one tick.
- Both meaningful delegation and lively agent interactions matter. Backend events must support both.

Information reliability and delivery reliability are distinct: a lazy employee can accurately say “I have not finished the research” and still cause a missed deadline. Existing gossip remains a separate social information system.

## 2. The experience to simulate

Example input: “Investigate demand for a new service and plan its launch.”

1. CEO states assumptions and issues a brief with the objective, success conditions, deadlines, and responsibilities.
2. Ops assigns work across the existing Sales and Engineering staff, considering their current availability and capacity.
3. Engineer 1 asks Sales 2 directly: “Which customer segment should the design focus on?”
4. Sales 2 answers with already-completed simulated research, or states that it is not ready and requests time to finish it.
5. If Sales 2 has a conflicting priority, Ops resolves the schedule. CEO becomes involved only if strategy, scope, or major priorities must change.
6. Engineering consumes the delivered findings and advances its simulated design/build task.
7. An employee who repeatedly disengages falls behind. Their downstream colleague waits, asks for an update, or escalates.
8. A qualified colleague reviews the simulated result. Defects or unmet criteria lead to rework.
9. CEO reports the simulated outcome: accepted, late, failed, or abandoned, with a causal record of what happened.
10. Work, delays, and outcomes influence the existing business and valuation systems through explicit rules.

These exchanges are addressed messages with task links and consequences. General public dialogue alone must not count as a request, an answer, or successful work.

## 3. Existing code and extension strategy

| Area | Existing support | Required extension |
| --- | --- | --- |
| `server/management.ts` | CEO business responses; Ops assignment validation | User-task briefs, delegation, priority conflicts, and mission decisions |
| `shared/business.ts` | Tasks, owners, dependencies, deadlines, allocation, review | Consume unchanged types; keep extra mission metadata in a sidecar keyed by task ID |
| `server/tasks.ts` | Effort-based work, finite allocation, simulated review and defects | Preserve canonical executor; integrator adds only a default-preserving attention-budget hook if required |
| `shared/events.ts` | Evidence, directives, management rationales | Addressed task communication, decisions, and meeting records |
| `server/bias.ts` / `server/rules.ts` | Personality/state influence action choice and consequences | Reuse unchanged; no new action weights or global behavioral tuning |
| `server/tick.ts` | Authoritative staged simulation; seeded resolution | One integrator inserts narrow lifecycle hooks outside the stock calculation |
| `server/llm/` | Anthropic role prompts, validation, telemetry, fallbacks | Task interpretation and grounded collaboration contracts |
| `server/run-store.ts` | Durable world snapshots and run journals | Persist mission state and accepted inputs in the same run transaction model |
| `server/index.ts` / `shared/api.ts` | Run control, input queueing, HTTP, SSE, tick frames | Backend submission/read routes and additive activity data |

Use the existing simulation, not a separate background execution service. Keep `Business.tasks` as the single work/capacity ledger; mission metadata references those task IDs. Do not introduce a second task scheduler that allocates the same staff independently.

Reuse the eight existing agents and fixed seat IDs. Professional display labels such as “Engineer 1” can map to stable cast IDs without replacing their personalities. No new department-head hierarchy is required for the first version. Preserve main's six fixed employee seats for business output. CEO/Ops decisions remain observable hierarchy activity and do not create management productivity bonuses.

## 4. Hierarchy and decision authority

- **CEO:** interprets the user goal; records assumptions; defines scope, priorities, success conditions, and acceptable tradeoffs; resolves strategic conflicts; accepts or abandons the simulated task.
- **Ops:** assigns and reassigns staff; resolves competing requests; manages capacity, dependencies, deadlines, and replacement after departures.
- **Engineering:** raises technical questions, requests research, proposes approaches, performs simulated implementation, and reviews engineering work.
- **Sales:** performs simulated market/customer research, shares findings, proposes positioning, and reviews commercial assumptions.
- **Other Operations staff:** perform appropriate operational work and coordination within their capabilities.

A direct question does not transfer authority over another employee. An engineer can ask Sales for existing findings or request help; new work must be accepted within capacity or routed to Ops. Employees cannot silently cancel another person's assignment or change the CEO's objective.

Each decision records who made it, the question, alternatives, concise explanation, evidence known to that agent, and the tasks affected. Displayable explanations describe the decision; they do not claim to reveal private model reasoning.

Interpret freeform objectives through bounded work categories such as research, planning, engineering, coordination, and review. Preserve the original request and the CEO's assumptions; do not silently substitute an unrelated preset. Validate task count, effort, deadlines, capabilities, dependencies, and proposed business effects. If the model reply is unusable, rules mode can construct a simple generic simulated plan tied to the request. The example launch scenario must not become the only supported task.

## 5. Data model

Add `shared/companyTasks.ts` for domain contracts and a `companyTasks` section on the engine world. Keep additions optional/defaulted when reading older snapshots.

| Record | Essential fields |
| --- | --- |
| CompanyTask | ID, original prompt, run ID, status, brief version, linked work IDs, assumptions, success criteria, deadline, outcome |
| CompanyBrief | Version, author, objective, department requests, dependencies, priorities, constraints, simulated business-effect profile |
| Work metadata sidecar | Existing task ID mapped to company-task ID, work category, expected findings, required inputs, timing, and displacement metadata; existing Task shape stays unchanged |
| WorkFinding | ID/version, producing task and agent, structured simulated facts, summary, completion tick, known recipients |
| TaskMessage | ID, sender, recipients, thread, kind, related task/finding/decision, reply-to, sent/delivered tick and round |
| CompanyDecision | Actor, authority, reason category, considered options, explanation, consumed evidence, changes, brief revision |
| Meeting | Organizer, purpose, participants, linked work, ordered exchanges, decision/output references, time consumed |
| AgentActivity | Actor, activity kind, participants/target, task/message links, simulated location, order, time cost, resolved result |
| CompanyTaskOutcome | Accepted/failed/abandoned state, on-time/late timing, criteria results, reasons, simulated financial/news postings |

A task that finishes late is still capable of succeeding. Track deadline misses separately from terminal success/failure. Distinguish a missed task deadline from the parent company task's final outcome.

Suggested company-task states: `queued`, `briefing`, `delegated`, `in_progress`, `blocked`, `review`, `completed`, `failed`, `abandoned`. A blocked task can resume, and a failed review can return work to execution.

Every work item has one accountable owner, suitable capability requirements, finite effort, a deadline, dependencies, and acceptance rules. Validate dependency cycles and version references before applying a plan.

## 6. Simulated research and knowledge

Represent research as actual simulation state so one agent has something meaningful to tell another.

- Generate a small bounded synthetic scenario for the submitted task: customer segments, preferences, constraints, and technical considerations, as relevant.
- Store underlying scenario facts in engine-owned state. Agents receive only the brief, completed work, delivered messages, and observations they are entitled to know.
- Research tasks reveal a defined subset of facts when simulated effort completes. An LLM may phrase those facts, but cannot manufacture completion or unsupported results.
- A handoff references the exact finding version. Its addressed recipient gains access when delivery resolves.
- Engineering can select an approach from the received findings. Missing required inputs block dependent progress or trigger a valid request to Ops to change the plan.
- Revising findings can require dependent work to be reviewed or reworked; preserve the prior version and causal link.
- No-results and incomplete-results replies are valid. Asking a question cannot instantly create completed research.

Keep task findings separate from gossip claims. An employee may gossip about an announcement through the existing system, but a rumour must not silently replace a dependable task finding. Task-channel statements are validated against known facts and current work status.

## 7. Reliable communication with personality-dependent delivery

Reuse existing traits and state rather than inventing a permanent “lazy” label. An agent's likelihood of working, overworking, disengaging, or seeking an outside option already depends on ambition, loyalty, stress, burnout, financial need, and other traits.

The causal chain should remain observable:

`traits + current state → selected behavior → effective effort → dependency delay → review/completion → deadline and business outcome`

Do not directly flip a task to late because its owner has a personality label. A missed deadline results from accumulated work and simulated time. Identical personalities need not produce identical outcomes in every run.

Extend prompts and rules so:

- Character traits affect language, willingness to volunteer, work choices, and escalation style.
- Stress and burnout can reduce sustained delivery and increase existing defect/rework risk.
- Relationships influence who gets approached first, while capability and authority checks still apply.
- A disengaged employee can postpone responding, accurately report incomplete work, or spend less time on delivery.
- CEO and Ops receive their own character/state context for mission decisions; managers are not anonymous perfect coordinators. Do not add management output units: current main measures employee progress for business output.
- Communication remains factually grounded regardless of tone. Requests to distort findings or invent evidence are invalid task actions.

Preserve existing gossip, trust changes, rumours, random shocks, and departures. A resignation can leave a task ownerless and require Ops reassignment. A business shock can displace mission work and cause delays. Conflicts are visible rather than silently resolved for free.

## 8. Bounded conversations inside a tick

Introduce a small number of ordered conversation rounds within the existing authoritative tick:

1. Apply accepted inputs, arrivals, delivered information, events, and business obligations.
2. CEO/Ops process brief, assignment, and priority decisions using a shared management agenda.
3. Run the first communication round from the committed local tick state.
4. Validate and resolve those messages, then update recipients' knowledge.
5. Run further reply/escalation rounds from that updated state, stopping at the configured limit.
6. Resolve remaining employee work and reviews using the remaining capacity.
7. Resolve lifecycle, state changes, departures, finances, price, and the tick commit.

Within one round, agents decide from the same round-start snapshot. A reply can consume only information delivered in an earlier round. Stable ordering and seeded choices resolve conflicts; never let promise-completion order decide who knows what.

Proposed initial tuning values: at most three conversation rounds per tick, two authored exchanges per agent, and a configurable global message limit. Unresolved requests carry into the next tick. Limits include task-management exchanges so a busy company cannot generate unbounded meetings.

Only invoke collaboration turns for agents with a new brief, actionable inbox item, dependency question, conflict, or review need. Reuse the existing provider and telemetry, cap retries, and avoid asking all eight agents to speak in every round. Quiet employees continue their ordinary simulated work and social choices.

All activities consume simulated attention. For example, a short exchange could cost 0.2 of a work unit, while a meeting charges each participant. Put these settings in `server/company-tasks/config.ts`, not the shared `server/params.ts`. An integrator-owned optional execution-budget hook limits task progress using remaining attention and Ops allocation, with unchanged defaults for ordinary runs. Do not mutate persistent Ops allocations merely to charge a conversation. Sending and answering messages cannot award extra productive effort or create extra valuation records.

Existing action sampling stays unchanged. A bounded collaboration layer reserves attention, then the canonical work resolver consumes the remaining budget. Full-turn activities cannot also receive a free communication budget. Keep exactly one canonical employee WorkResult per tick; store individual exchanges in company-task activity, not additional business.work records.

Persist ordered exchanges inside the resulting tick. Existing phase notifications may say that agents are discussing; publish authoritative message content and outcomes after the tick commits. This preserves rollback and the current presentation acknowledgement gate.

## 9. Replacing routine workload without breaking main's task supply

User-objective work takes priority and replaces ordinary assignments for staff with actionable company-task work. Preserve contract obligations, urgent incident work, payroll, random events, social behavior, and presence.

Current main's `openBusinessTick` counts `pending`, `active`, `paused`, and `blocked` items toward each department's supply. Simply pausing routine items and hiding them from Ops can therefore prevent replacement work from spawning. Treat that as an explicit integration case, not an acceptable output drop.

The adapter must:

- Create ready company tasks before Ops assigns staff, using existing task kinds and the canonical task list.
- Track displaced routine IDs and prior state in the sidecar; do not delete history or alter the baseline generator/denominator.
- Keep only required dependency waits. Do not mark every employee blocked while a single research result is pending.
- Allocate independent ready company tasks first. Staff without actionable objective work can use existing ready operational/contract work rather than receive invented routine-output credit.
- Reuse displaced ready routine items as needed. If company dependencies make the stock generator's open-item count misleading, provide bounded real fallback work through the existing task factory for otherwise available staff; avoid a second allocator, duplicate creation, or unbounded paused backlog.
- Charge conversation time to actual execution capacity, not by silently inflating `remaining` or changing persistent Ops allocations.
- Restore displaced work once the objective ends, recording any actual missed obligations.

This preserves task-focused allocation while retaining main's real-work continuity when staff are waiting. A genuinely blocked or disengaged employee may still produce less output and lower the price; do not manufacture progress to keep price above 100.

Without an active company task, use main's task-supply and scheduling paths unchanged. Pausing simulation time pauses company-task progress and conversations.

## 10. Financial and stock-price consequences

The stock/business engine remains authoritative for all numeric effects. Collaboration owns decisions, task requests, and dialogue; the stock team owns how canonical work and economic facts affect valuation. The LLM cannot set cash, price, productivity multipliers, news weights, or arbitrary monetary benefits.

- **Costs:** preserve payroll/infrastructure accounting. Existing `post`/business helpers apply supported costs once; no second salary charge and no separate collaboration ledger.
- **Delivery:** company work uses existing kinds, owners, allocations, progress, dependencies, review, and completion paths. Extra categorization lives in sidecar metadata.
- **Benefits:** use existing supported commercial/delivery/savings mechanisms only when the corresponding simulated conditions are met. Research handoff alone earns no revenue.
- **Failure:** delays and failed work affect the existing simulation through actual lost effort, rework, displaced obligations, and supported outcomes. Do not add an independent price penalty.
- **Stock:** canonical WorkResult progress feeds main's productivity calculation. Accounting changes affect its current cash-based fundamentals through the ordinary business lifecycle; contracts/receivables do not acquire a new direct valuation multiplier. Existing verified case/disclosure routing remains authoritative.
- **Market news:** internal questions and ordinary findings are not market announcements. For an eligible final milestone, request the existing mapped case/news path with a stable mission outcome ID. Do not create both a release case and a second custom announcement for the same event. If the stock team has no accepted mapping yet, retain the milestone in company history and defer the new market announcement; activity/accounting still affects valuation.
- **New communication categories:** keep message records separate. Do not disguise a question as `support_colleague` or `report_issue` just to obtain their productivity credit; those actions have real existing side effects. Any required new valuation mapping is implemented by the stock owner behind the adapter.

Preserve canonical WorkResult IDs (`work-${tick}-${agent}`), actions, actual progress, and current completion/review behavior. Main's stock calculation reads progress rather than awarding productivity from the previous local model's outcome strings. Keep conversation wording in separate activity fields and do not rename existing outcomes unnecessarily.

Preserve `operating.seats`, cash-based fundamentals, current impact weights, `businessNews` valence/deduplication, `CustomPriceEffect` duration, price-owned output shifts, office-closed output handling, and the `price_feedback` setting. Do not replace these with the older audit's implementation.

## 11. Backend API, persistence, and client contract

Proposed routes:

- `POST /api/sim/company-tasks`: submit hypothetical task text; require a run ID and idempotency key; optionally include a bounded simulated deadline.
- `GET /api/sim/company-tasks`: current and queued tasks with summary status.
- `GET /api/sim/company-tasks/:id`: brief, work, exchanges, findings, decisions, timing, and outcome.

Use the existing SSE stream. Add optional company-task/activity data to snapshots and tick frames, with stable IDs and ordered round positions. Do not introduce a second clock or replace current stream message types.

Provide a presentation-ready activity contract: actor, recipients, task, kind, public dialogue, optional character thought, decision/finding references, meeting ID, simulated location, order, and result. This supports future CEO briefings, desk visits, Sales/Engineering conversations, meetings, and reviews without implementing client UI now. Reading spectator activity must not grant agents the same global knowledge.

Queue submissions durably before applying them at a tick boundary. Return `queued` immediately; CEO interpretation is simulation work and appears during stepping/playback. Respect inputs submitted while an LLM tick is in flight, using the manager's existing generation and queued-input reconciliation patterns.

Persist company-task state, findings, conversations, and input IDs with the same run snapshots/journal. Reset archives the old run and its task history; new runs do not inherit stale requests. Older snapshots normalize to empty company-task state. Reconnect restores ordered activity without repeated effects. Restart restores the last committed tick and remains paused as today.

## 12. Suggested file boundaries

New modules:

- `shared/companyTasks.ts`: records, intent schemas/contracts, activity DTOs, and typed effect codes.
- `server/company-tasks/intake.ts`: bounded hypothetical scenario and brief interpretation.
- `server/company-tasks/context.ts`: actor-specific brief, assignments, inbox, and findings.
- `server/company-tasks/collaboration.ts`: requests, replies, handoffs, meetings, and conversation rounds.
- `server/company-tasks/lifecycle.ts`: deadlines, criteria, late markers, review/rework, outcomes.
- `server/company-tasks/rules.ts`: deterministic fallbacks, authority checks, and activity accounting helpers.
- `server/company-tasks/config.ts`: feature-local limits and attention costs, isolated from valuation parameters.
- `server/company-tasks/adapter.ts`: existing task creation, scheduling view, execution-budget proposals, work observation, and business-effect requests.
- `server/llm/company-task-prompt.ts`: CEO interpretation and role-specific collaboration prompting.

Collaboration-owned additive work: the new modules above, `shared/companyTasks.ts`, and dedicated company-task tests/demo script. Minimal shared integration: optional world/API fields, intake routes, isolated prompt dispatch, a scheduling-view hook in `management.ts`, and lifecycle/execution-budget hooks in `tick.ts`/`tasks.ts`. One designated integrator applies shared-file edits after rebasing onto the accepted stock-team version. No collaboration edits to `price.ts`, shared `params.ts`, `business.ts`, `bias.ts`, `rules.ts`, or the valuation block; no `shared/business.ts`/`shared/events.ts` schema expansion in this release. If a further shared change proves necessary, document it for the owning integrator rather than expanding ownership silently.

Use a separate typed collaboration-intent contract inside the existing turn budget; do not add every kind of message to the legacy `Action` union. Existing social/work actions continue to use that union. The combined resolver enforces the shared attention budget and exposes final activity records.

Inspect exact files before implementation and preserve existing uncommitted source changes. No `src/` UI or 3D scene changes belong in this backend scope.

## 13. Implementation phases

### Phase 1 — contracts and deterministic baseline

Add company-task state, sidecar work links, knowledge/message/activity types, lifecycle transitions, feature-local config, and old-snapshot normalization. Develop against an adapter fixture without editing shared stock-team files. Implement a deterministic example with the current cast.

Acceptance: the world can represent a CEO brief, Ops assignments, an engineer-to-Sales request, a finding handoff, and a late outcome; it survives serialization and does not alter a no-task fixture.

### Phase 2 — input, hierarchy, and workload replacement

Implement submission/read handlers, durable pending inputs, CEO assumptions/brief, and Ops delegation. Record routine-work displacement after generation, preserve obligatory/urgent work, and verify ready-work availability despite paused/blocked items counting toward supply. Do not change main's ordinary-run routine cadence or add synthetic fallback productivity. The designated integrator applies the shared route and scheduling hooks.

Acceptance: submitting a hypothetical task and stepping produces valid hierarchy-based assignments. Every work item has an owner or recorded reason it cannot be assigned. Retries do not create duplicate tasks.

### Phase 3 — direct collaboration and knowledge transfer

Add bounded request/reply rounds, findings, handoffs, meetings, conflict escalation, and shared attention accounting. Begin with rule-driven fixtures, then integrate LLM intents against the same contracts.

Acceptance: an engineer asks Sales directly, Sales replies from actual known simulated findings, and Engineering uses the received version. If findings are unfinished, the reply says so. Conflicting work goes to Ops. Conversations and meetings cannot exceed capacity or round limits.

### Phase 4 — personality, delays, and review

Connect collaboration and work to existing personality/state-based choices, seeded resolution, defects, review, departures, and replacement. Add explicit deadline-miss events and causal outcome explanations.

Acceptance: controlled low-effort histories produce less progress and more delay than productive histories. Lazy behavior can cause a missed deadline without false information. Departures and shocks can interrupt work. Independent review can trigger simulated rework.

### Phase 5 — business effects and observable activity

Connect the adapter to existing task completion/accounting paths and the stock team's accepted effect mappings. Expose ordered activity and dialogue through the existing snapshots/SSE. The stock owner alone maps any genuinely new communication or market-outcome category; do not rewrite operating output, fundamentals, news routing, or return calculations.

Acceptance: company-task work feeds main's actual-progress calculation, existing costs, and verified outcome/news paths; outcome effects post once. The API explains who asked whom, who delegated, what information arrived, what changed, and why the task finished on time, late, or unsuccessfully.

### Phase 6 — resilience and calibration

Verify in-flight input reconciliation, recovery, reset, malformed LLM output, rules fallback, conversation caps, and retained history. Calibrate several representative company tasks across seeds and record model usage/latency.

Acceptance: all confirmed behavior is demonstrated through API/CLI and automated backend checks. No frontend implementation is needed to accept the work.

## 14. Verification and demonstration

Use the project's existing `tsx`/Node backend tests and build checks. Focus on behavioral guarantees:

- **Hierarchy:** employee questions can cross departments; only authorized managers change another person's assignment or strategic priority.
- **Knowledge:** no answer contains unavailable findings; follow-up rounds receive delivered information, not global spectator truth.
- **Capacity:** work, communication, meetings, event response, and review share finite attention; every meeting participant pays its cost.
- **Personality:** controlled behavior histories prove deadline causality; paired seeded experiments assess the expected likelihood difference, rather than requiring every low-effort agent to fail.
- **Reliability:** task-channel information remains grounded even when the speaker is lazy, stressed, or sarcastic. Existing gossip still works through its own mechanics.
- **Workload:** routine work is displaced/restored correctly; existing obligations and urgent events remain consequential.
- **Outcomes:** late completion differs from failure; reviews cause genuine rework; financial/news effects are exactly once.
- **Tick behavior:** same seed and fixed validated model replies yield the same state and event order; live model calls alone are not claimed deterministic.
- **Durability:** duplicate input, input during a tick, reset during inference, recovery, and reconnect preserve the correct run and history.
- **Fallback:** rules mode still produces delegation, exchanges, and simulated outcomes without an API key. It is explicitly distinguishable from model-generated choices.
- **Regression:** no-task fixtures preserve main at `73aba3e` (or an explicitly adopted newer stock revision) with fixed provider replies. Run existing backend tests, price-business acceptance, affected UI sync tests, and TypeScript/build checks; report pre-existing failures separately rather than changing valuation to satisfy an outdated expectation.
- **Stock compatibility:** exercise six-seat normalization, actual progress/overwork, early completion, paused/blocked supply counts, research waits, support settling, overtime, verified outcomes, negative shocks, custom impact/duration, and duplicate news. Compare task-on scenarios against the accepted baseline without imposing an identical price curve on intentionally different work.

Demonstration scenarios:

1. Engineer requests completed market research from Sales and uses it to progress.
2. Sales is behind schedule due to disengagement; Engineering waits and Ops reprioritizes.
3. A random business incident interrupts a user task, increases pressure, and changes its deadline outcome.
4. A reviewer requests rework before the CEO accepts a simulated result.
5. A staff departure causes reassignment and a visible delay.

Provide a small backend script/fixture that submits a hypothetical task, advances the simulation, and prints ordered delegation, dialogue, decisions, timing, and business effects. Record deterministic fixture results separately from live-model quality measurements. Do not claim existing UI can animate new activities until client integration is separately implemented.

## 15. Definition of done and remaining tuning

The backend accepts a hypothetical objective and simulates the company pursuing it through the existing hierarchy. Agents communicate directly, exchange grounded simulated findings, and escalate priority conflicts. Personalities and state influence effort, timing, and outcome. Routine workload is displaced; social systems and random events continue; financial and stock effects remain consistent. Every important exchange and consequence is available as structured backend data.

Implementation defaults still to calibrate: one active task versus multiple; per-tick conversation/attention caps; bounded effort/deadline ranges; synthetic business-effect profiles; and which displaced tasks count as existing obligations. These are engineering/tuning choices within the confirmed direction, not unanswered questions about whether this is a real product-building system.

For this update, the current branch was fast-forwarded to `origin/main` at `73aba3e`; the prior local stock patch was not reapplied. Only planning/handoff documents were edited on top of that source. No company-task feature implementation or new goal was started. Verification of the pulled baseline is recorded below.


## Baseline verification for this main update

- Branch update: `main` fast-forwarded from `dc8cffd` to `73aba3e`; no merge conflicts or local stock patch reapplied. `git diff --exit-code origin/main -- office-sim` passes.
- Dependencies: frozen-lockfile installation completed; installed `three` and `@types/three` now match main at `0.187.0`. Package manifest and lockfile were not edited beyond the upstream update.
- Backend: `npm test` passed **221/221** tests, including the new business-price tests. The initial sandbox run could not create the tsx IPC socket; the permitted rerun passed.
- UI/presentation/dialogue/voice: `node --import tsx --test src/hud.test.ts src/presentation.test.ts src/dialogue.test.ts src/voice.test.ts` passed **27/27** after dependency sync.
- Build: `npm run build` passed after dependency sync. Vite reports its existing large-chunk advisory; no build error.
- Scope: only this plan and the stock-team handoff were edited on top of upstream source. Company-task implementation phases remain unstarted, and no goal was created or resumed for this update.

These checks verify the pulled baseline, not the proposed company-task feature or the attached audit's historical price percentages. Reuse this baseline as the comparison point when executing the plan; do not reintroduce the pre-update local valuation implementation.

## Release implementation and verification

The backend release is implemented against `73aba3e`. It uses one run-scoped objective, a three-to-six-item CEO brief, the existing Ops scheduler, and canonical work and independent review. A separate company-task record tracks addressed messages, delivered finding versions, assignment changes, missed checkpoints, and the final outcome. Current snapshots and committed SSE frames carry additive company-task data. Restart restores those frames from the existing journal and leaves playback paused.

### Submit and inspect an objective

1. Read `run_id` from `GET /api/sim/state`.
2. Submit the following JSON to `POST /api/sim/company-tasks`.

   ```json
   {
     "run_id": "<current run ID>",
     "idempotency_key": "launch-demo-1",
     "objective": "Investigate demand for a new service and plan its launch.",
     "deadline_ticks": 32
   }
   ```

   A new submission returns HTTP 202 with status `queued`. Repeating the same payload and key returns its current summary. An occupied objective slot, conflicting key reuse, or stale run ID returns HTTP 409. Deadlines are measured from the briefing tick and can range from 4 to 96 ticks. The default is 32 ticks, followed by a 24-tick recovery window.
3. Advance with `POST /api/sim/step`, or use Play with the existing presentation acknowledgements. Read `GET /api/sim/company-tasks` for summaries and `GET /api/sim/company-tasks/:id` for the brief, canonical work, findings, activity, and outcome. Read `frame.company_activity` in history or SSE for the ordered records of a particular tick. Archived objectives are available in the existing run journal.

Run the backend demo from `office-sim`. It uses Fastify's HTTP injection interface and a temporary journal.

```sh
node --import tsx server/scripts/company-task-demo.ts
node --import tsx server/scripts/company-task-demo.ts 'Improve the internal handover process across teams.' 71 56 32
node --import tsx server/scripts/company-task-demo.ts 'Build a prototype for migrating the internal access system.' 941 56 32
```

The demo defaults to rules mode. Passing `--live` uses the configured Anthropic key for the supplied hypothetical objective. The tick count is the maximum number of manual steps. Brief and exchange records label model, rules, and fallback choices.

### Release defaults and measured results

- A request, reply, or escalation costs 0.2 attention per participant. Up to eight exchanges can resolve over three rounds, with up to two authored exchanges per person and one request/reply sequence per pair. Remaining attention limits canonical effort. A model may defer a reminder once, while an eligible completed finding remains deliverable.
- Signed obligations, collections, and incident work rank ahead of company work. Ready company work ranks ahead of discretionary work. Ops reuses available routine work, fills a real ready-work deficit when necessary, and returns displaced items to the scheduling pool at close.
- A finding comes from completed work or a verified archive. An employee must know the finding version before advancing dependent work. Independent review can send the work back for rework. Late acceptance, failed recovery, and abandonment are separate outcomes.
- Eligible reviewed releases use the existing release case and its cooldown. Work effort, collections, payroll, costs, and existing case outcomes feed main's valuation. Ordinary research and internal exchanges are recorded in the objective history. No new financial or market-effect mapping was required.

| Rules demo | Seed | Acceptance |
| --- | ---: | --- |
| Service demand and launch pilot | 42 | Tick 27, on time |
| Internal handover process | 71 | Tick 17, on time |
| Access system migration prototype | 941 | Tick 42, late |

The focused tests also cover an incomplete Sales reply and escalation across office close, supplier interruption, independent rework, departure and archived finding recovery, malformed proposals, bounded model deferral, and exhausted recovery. Paired rules runs compare research timing across 20 seeds under different traits and pressure. HTTP tests cover input deduplication, submission during inference, reset, failed journal writes, and reconnect.

The complete backend suite passed all 238 tests, including 17 company-task tests. All 27 frontend presentation, HUD, dialogue, and voice tests passed. TypeScript and the production build passed with the existing Vite chunk-size advisory.

The no-objective comparison matched `73aba3e` across 576 ticks. It used seeds 42, 71, and 941 over 96 ticks in rules and fixed-provider modes, with price feedback enabled for seed 71. World state, work, accounting, prices, and ordinary prompts matched. The existing `price-audit.ts --seeds 5 --ticks 80 --json` output also matched byte for byte. With the launch objective active, seed 42 reached price 114.47 and 5.8 productive units on tick 27, compared with 115.78 and 6.0 on the same tick without an objective.

The bounded live smoke check returned a validated four-item CEO brief in 3.6 seconds and three collaboration replies in 0.5–1.4 seconds per call. This used a synthetic launch request and a fixed provider for ordinary employee and management turns. The automatic reviewer rejected a later live rerun because the request would send prompts and simulation state to Anthropic. The final send/wait intent was checked through the Anthropic SDK with a mocked network transport.

A random-seed presentation test intermittently expected a quiet day when a billboard announcement was scheduled. This reproduced on `73aba3e` with seed 6. The quiet-day test now uses seed 42.
