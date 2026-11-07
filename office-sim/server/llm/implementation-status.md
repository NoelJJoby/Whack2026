# LLM layer implementation and handoff

Updated 7 November 2026 after the developer requested completion of the remaining
plan. This is the current status; earlier blocked reports in `contracts.md` and
`step2.md` describe older checkouts. The revised
`/Users/theo/Downloads/LLM Layer Build Spec.md` supersedes conflicting contracts,
paths, retry ownership and cache requirements in the original implementation plan.

## Outcome and boundaries

The LLM lane is implemented and verified against the actual engine. A live
acceptance entrypoint injects the real Anthropic provider into `runTick`, then
reuses engine-accepted responses in the other mode without additional API calls.
All required LLM checks pass. Persistent caching is explicitly deferred under
the revised spec; no disk cache or cache directory exists.

The developer explicitly authorized logging changes to `server/tick.ts` and
`server/engine-types.ts`, approved the temporary personas in fixture cast order,
and approved exactly sixteen fictional fixture prompts for the live checks.
Only sixteen actual API requests were made in the successful live run, with
zero retries. Controlled failure tests use stubbed fetch and make no API calls.
Initial sandboxed requests could not connect; network-enabled execution was
rejected by automatic approval review until the payload was explicitly approved.

This verifies engine-level integration, not the web application's routes.
`server/index.ts` still uses its existing placeholder simulation functions.
Web server/UI migration, final production data/personas and the existing Vite
configuration issue belong to their owners and were not changed here.

## Stage endpoints

| Stage | Status | Evidence |
| --- | --- | --- |
| 1 — Contract | COMPLETE | Actual engine exports/adapter inspected; revised agreed eight-action contract retained. |
| 2 — Anthropic client | COMPLETE | Earlier smoke passed; current live engine checks also verify Messages transport, usage and latency. |
| 3 — Parsing | COMPLETE | Valid/fenced JSON and controlled malformed/missing/truncated failures; parseable invalid objects reach engine validation. |
| 4 — Provider | COMPLETE | Exact `TurnProvider`, one API attempt per invocation, `null` failures, no provider retry or canned turn. |
| 5 — Optional cache assessment | COMPLETE; cache deferred | No engine-acceptance callback or agreed path. No persistence/replay claims. |
| 6 — State wording | COMPLETE | Four tables, six boundaries each; no workload wording invented. |
| 7 — Traits/trust/personas | COMPLETE with temporary personas | Six tables checked; eight existing strings assigned by developer-approved fixture order. |
| 8 — Prompt | COMPLETE | Actual context, exact framing, claims/age/trust, events, colleagues, available actions, JSON and beliefs checked. |
| 9 — Prompt safety | COMPLETE | Automated checks and manual review of all sixteen calm/high-stress prompts. |
| 10 — Concurrency | COMPLETE | One provider handles eight overlapping calls; rate limit and hung request isolated and bounded. |
| 11 — Live engine integration | COMPLETE at engine boundary | Sixteen actual responses accepted; both modes receive identical proposals through test-only accepted snapshot replay; controlled repeated failures fall back to rules. |
| 12 — Decision logging | COMPLETE | Engine logs correlate agent/tick, retries, validation failure, fallback, usage and latency; concurrent isolation verified. |
| 13 — Behaviour/acceptance/handoff | COMPLETE for LLM lane | All available LLM checks pass; sixteen live outputs reviewed; no tuning or extra API calls needed. External limits are listed below. |

## Steps 8–13: changes and checks

### Step 8 — Prompt assembly

Outcome: `buildTurnPrompt(agent, ctx, persona?)` consumes the real exported
engine types. It preserves the exact opening and wording tables and includes
heard claims, source trust in words, tick ages, scandal eligibility metadata,
announcements, real colleague ids, only available actions in the action list,
relative proposal weights and an integer belief request for every heard claim.
Mood lines must not describe a completed action. Mode never changes the prompt.

Files changed and reasons:
- `prompt.ts`: extract and expose the real prompt builder from the provider for
  focused acceptance and review without making API calls.
- `../llm.ts`: consume that builder and allow optional caller-supplied persona
  text through `createTurnProvider({ personaFor })`, preserving `TurnProvider`.
- `personas.ts`: assign the existing eight temporary strings to fixture ids in
  the order approved by the developer. No persona text was rewritten.
- `tests/prompt.test.ts`: section order/context/actions/beliefs, approved persona
  mapping and exact desired-output schema examples. The schema exists only in
  the test oracle, never as a provider rejection gate.

Checks: `node --import tsx server/llm/tests/prompt.test.ts`, provider regression,
focused TypeScript and diff review passed. Dependency: none for temporary
personas. Next: stage 9, authorized and completed below.

### Step 9 — Safety and manual prompt review

Files changed: `tests/promptSafety.test.ts` creates real engine contexts for all
eight fixture agents in calm/high-stress conditions. It checks numeric state and
trait disclosures by section, forbidden metadata, identity framing, invariance
to hidden truth and unused raw scores, and legitimate claim ids/tick ages.

Checks: `node --import tsx server/llm/tests/promptSafety.test.ts --write
/tmp/whack-prompt-review.txt` passed. Read all sixteen prompts in full. No truth
metadata, raw scores or archetype identity framing appeared. Engine ids such as
`gossip`, `climber`, `loyalist`, `skeptic`, `breadwinner` and `flight` can resemble
archetypes; they remain unchanged as reference ids, not identity descriptions.
Their semantic effect is an engine/data-owner consideration. Dependency: none
for the approved temporary content. Next: stage 10, authorized and completed.

### Step 10 — Concurrent provider calls

Files changed: `tests/concurrency.test.ts` now tests eight calls through one
actual provider instance and real SDK, with stubbed fetch. A start barrier
prevents a success until all eight calls enter fetch. Six distinct responses,
one rate limit and one hung request remain independent; all eight calls return,
with one attempt each. A 200 ms timeout is bounded by a two-second watchdog.

Checks: `node --import tsx server/llm/tests/concurrency.test.ts` passed (hung call
approximately 204 ms); focused TypeScript and diff review passed. No production
scheduler was added. Dependency: none. Next: stage 11, completed with explicitly
approved live data after logging implementation so the same calls verified both.

### Step 11 — Live engine integration

Files changed: `tests/integration.ts` is the explicitly live acceptance entrypoint,
separate from offline `*.test.ts` scripts. It injects the production provider into
the actual engine. Both eight-agent batches hear the same fictional layoffs
rumour, with fixture traits/personas and calm/high stress/burnout states.
The second engine mode uses an in-memory test snapshot only after engine
acceptance, confirms identical prompts and proposals before bias, and reports no
new token usage. This snapshot is not a persistent or production replay cache.

Checks: `node --import tsx server/llm/tests/integration.ts --out
/tmp/whack-llm-live-acceptance.json` passed with network access after explicit
payload approval. Sixteen API calls succeeded, all accepted on the first engine
attempt. The controlled 503 path uses stubbed fetch: sixteen failed fetches for
eight agents, exactly two engine-owned attempts each, then logged rules fallback.

Dependency: none for engine-level verification. The web integration owner still
needs to migrate the existing placeholder routes; this task did not edit them.
Next: stage 12 logging, separately authorized and completed.

### Step 12 — Correlated decision logs

Files changed and reasons:
- `telemetry.ts`: `AsyncLocalStorage` provides a collector per provider
  invocation, avoiding prompt parsing, payload fields or global callback swaps.
- `client.ts`: publish existing sanitized request metrics to that collector.
- `../tick.ts`: engine supplies invocation scope, counts its own attempts/retries,
  records each attempt's validation result and attaches telemetry to the existing
  agent/tick decision log. Only logging changed; rules and retry policy remain.
- `../engine-types.ts`: add optional `DecisionLog.provider` and its metadata type;
  `TurnProvider`, `LlmOutput` and shared types remain unchanged.
- `tests/logging.test.ts`: staggered concurrent responses with normal success,
  invalid-then-valid recovery, repeated transport failure and an uninstrumented
  provider verify counts, correlation, usage summation and null metadata.

The provider log contains `attempts`, `retry_count`, `cache_hit`, total
`latency_ms`, reported API `usage`, and per-request attempt/latency/outcome/usage/
validation error. Usage includes API responses rejected by engine validation.
`false` cache status means a measured API request; `null` means the injected
provider supplies no telemetry. Replayed test outputs report no fresh API usage.
The engine's existing `fallback` and `effective_mode` fields supply final status.
No latency is fabricated for stub providers without metrics, preserving the
engine's deterministic seeded tests.

Checks: `node --import tsx server/llm/tests/logging.test.ts`, all 89 existing engine
tests, focused TypeScript and live log assertions passed. Dependency: none while
persistent caching is deferred. Next: stage 13, authorized and completed below.

### Step 13 — Behaviour review and final handoff

Files changed: this report records outcomes, ownership, exact commands and entry
points. No production wording was tuned after the live run. All sixteen live
proposal sets and public/inner lines were read. Lines conveyed mood or intent,
without claiming a sampled action had already happened.

| One eight-agent sample per condition | Calm | High stress/burnout |
| --- | --- | --- |
| Accepted decisions | 8/8 | 8/8 |
| Actual API requests / engine retries | 8 / 0 | 8 / 0 |
| Agents with `work` as highest-weight proposal | 1 | 0 |
| Mean within-agent share of proposed weight on `work` | 30.8% | 16.1% |

High-stress proposals shifted toward checking claims, interviews, complaints and
slacking off. This is an observation from one sample, not a deterministic model
behaviour guarantee. Calls took 2.33–3.25 seconds each. Total reported usage:
11,396 input tokens and 3,785 output tokens, including the existing system-side
API accounting; no extra tuning or separate smoke calls were made.

Checks: all nine offline LLM scripts, all 89 engine tests, focused TypeScript and
final whitespace review pass. Full-project `tsc --noEmit` still reports the
pre-existing TS6305 for `vite.config.d.ts`. No configuration workaround was added.
Final review confirmed only necessary LLM files and the two explicitly approved
engine logging files changed. Pre-existing user edits to `agent.md` and the old
implementation plan were preserved. Dependency: external items below. Next:
none for this LLM plan; web/config/data owners continue their separate work.

## Entry points and configuration

Production exports:
- `server/llm.ts`: `getAgentTurn: TurnProvider`, or `createTurnProvider(options)`
  for per-instance transport/metrics/persona injection.
- `server/llm/prompt.ts`: `buildTurnPrompt(agent, ctx, persona?)`.
- `server/llm/parse.ts`: `parseReply(message): unknown | null`.
- Existing state/trait/source-trust sentence helpers and `temporaryPersonaFor`.

Injection example using actual export paths from `server/`:

```ts
import 'dotenv/config';
import { getAgentTurn } from './llm';
import { fixtureCast } from './scripts/fixture';
import { createWorld, runTick } from './tick';

const world = createWorld(fixtureCast(42), 42);
const result = await runTick(world, getAgentTurn, {
  mode: 'llm_bias', scenario: [], gossip: true, billboard: true,
});
// result.log.decisions includes engine-owned attempts, fallback and API metrics.
```

Configure `ANTHROPIC_API_KEY` securely in the caller environment; the live script
and existing server entrypoint load dotenv. The provider never logs credentials,
prompts or response bodies. `config.ts` retains `claude-sonnet-5-5`, 1024 maximum
output tokens, 20 seconds per request, omitted temperature and zero SDK retries.
The engine owns its one retry, validation, normalization, masking, weighting,
sampling, beliefs, target/claim selection, state updates and final fallback.

Run from `/Users/theo/Desktop/Whack2026/office-sim`:

```sh
for test in server/llm/tests/*.test.ts; do node --import tsx "$test" || exit 1; done
node --import tsx --test server/test/*.test.ts
./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --esModuleInterop --skipLibCheck --types node server/llm.ts server/llm/*.ts server/llm/tests/*.ts
git diff --check
```

The explicitly live command is separate and requires external-payload approval;
it was run once successfully for the sixteen approved fixture prompts:

```sh
node --import tsx server/llm/tests/integration.ts --out /tmp/whack-llm-live-acceptance.json
```

## Deferred and external work

- Optional persistent cache: still deferred. A future implementation needs an
  agreed engine acceptance callback identifying each accepted raw response and
  a configurable developer-approved storage path, then replay/persistence/
  concurrent-write tests. Logging telemetry is not an acceptance callback.
- Web application: `server/index.ts` still uses placeholder `createInitialSimulation`
  and `stepSimulation`; it has not been migrated to a persistent engine World,
  `runTick` and SSE. Engine-level live acceptance does not claim the web UI works.
- Final production cast/persona data remains author-owned. The live test uses
  existing engine fixtures; eight temporary persona strings are mapped to
  `ceo`, `ops`, `gossip`, `climber`, `loyalist`, `skeptic`, `breadwinner`, `flight`
  in that order. Callers can provide final persona text via `personaFor` without
  changing shared types or overwriting author content.
- Full-project type checking: configuration owner must remove `vite.config.ts`
  from `tsconfig.json`'s `include` (it is already a referenced composite project),
  as recorded in the existing engine handoff. The targeted LLM/engine graph
  compiles. `tsconfig.json` was not authorized for edits and remains unchanged.
