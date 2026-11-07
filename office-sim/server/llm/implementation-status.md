# LLM implementation: stages 3 onward

7 November 2026. The developer requested execution from stage 3 onward and
confirmed that the engine branch is not available yet. Independent stages were
completed; engine-dependent stages are explicitly blocked.

## Authority and boundaries

Read `/Users/theo/Downloads/LLM Layer Build Spec.md` (updated 7 November 2026),
`office-sim/agent.md`, the implementation plan and the existing contract handoff.
The revised spec supersedes the old plan's seven-action contract, `src/llm/`
layout, provider-side validation/retry and separate runner. Work stays in
`office-sim/server/llm/` until the actual engine types and injection point exist.

No substitute `AgentView`, `EngineProfile`, `TurnContext`, `GetDecision`,
`buildPrompt` or `fireAll` implementation was introduced. The legacy
`server/llm.ts` remains unchanged and still uses OpenRouter and a canned fallback;
it is **not** the completed Anthropic provider. The new helpers are not wired
into the simulation yet.

## Step reports

### Step 3 — Text extraction and JSON parsing

Status: COMPLETE.

Outcome: `parseReply(message): unknown | null` extracts text blocks, strips an
optional surrounding JSON/plain code fence and parses JSON. Empty, non-JSON,
truncated and incomplete replies return `null`. Normal `end_turn` and
`stop_sequence` completions are accepted. Parseable schema-invalid and legacy
output reaches engine validation unchanged; there is no local schema gate.

Files changed:
- `parse.ts`: production extraction/parser helper.
- `tests/parse.test.ts`: valid/fenced/multi-block replies, missing text,
  incomplete completion reasons, malformed JSON and schema-invalid passthrough.
- `tests/smoke.ts`: reuses the parser instead of duplicating extraction/parsing.

Checks: parser script and focused TypeScript checks passed. Network-enabled
live smoke passed with 31 input tokens, 9 output tokens and 1227.87525 ms latency.
The initial sandboxed smoke returned a controlled request failure; the separate
network-enabled invocation succeeded. No keys or response bodies were logged.
This smoke verifies transport/parsing, not model decision quality or integration.

Dependency: none for this helper. Next: stage 4 when engine types are available.

### Step 4 — Injected provider

Status: BLOCKED.

Outcome/files changed/checks: no production provider edit. Inspected the current
checkout and local branch trees; no `EngineProfile`, `TurnContext`,
`TurnProvider` or `server/llm-adapter.ts` implementation exists. The developer
confirmed the engine branch is unavailable. Existing shared types are legacy
types and must not be substituted for the agreed provider inputs.

Dependency: actual engine exports, context fields and injection site. Once
available, migrate `server/llm.ts` to the exact provider signature, construct the
real prompt, call `createMessageClient` once and pass its message to `parseReply`.
Controlled errors return `null`; the engine owns validation/retry/fallback.
Next: implement stage 4 after the engine arrives; independent stages below are ready.

### Step 5 — Assess optional caching

Status: COMPLETE (assessment only; caching explicitly deferred).

Outcome: no persistence or cache configuration was added. The engine owns
validation and has no available acceptance callback/interface. Caching parsed
but unaccepted output would violate the revised spec. No cache location is
chosen; agreement is still required if caching is later enabled.

Files changed: this report records the deferral. Checks: inspected the engine
contract and absent adapter; replay/concurrency cache checks are not applicable
because no cache is implemented. Dependency: an agreed engine acceptance
mechanism and developer-approved cache location for optional future work.
Next: independent stage 6, completed below.

### Step 6 — State wording

Status: COMPLETE.

Outcome: four exact sentence tables and a state paragraph in stress, burnout,
loyalty, management-trust order. Input uses a `Pick` of existing `AgentState`
fields, without changing shared types. Workload is omitted because no wording
table is supplied by the spec.

Files changed: `bands.ts` for wording; `tests/bands.test.ts` for exact boundaries
and combined paragraph checks. Checks: script and focused TypeScript passed;
0, 39, 40, 69, 70 and 100 checked for all four fields. The paragraph has no raw
numbers or newlines. Dependency: none for helpers. Next: stage 7, completed below.

### Step 7 — Traits, source trust and personas

Status: COMPLETE (wording/helpers; engine data integration pending).

Outcome: all five trait tables and source-trust table match the supplied text.
Eight temporary, behaviour-only persona strings are available but unassigned.
No author-supplied personas were found or modified. All eight placeholder
strings were manually read; they contain no archetype identity framing.

Files changed: `traits.ts` for the six tables; `personas.ts` for clearly marked
temporary text; `tests/traits.test.ts` for exact boundaries and placeholder checks.
Checks: script and focused TypeScript passed, with all six boundaries for all
six tables. Dependency: the existing `AgentProfile.traits` lacks `impulsivity`;
the engine/data owner must supply the actual input and persona mapping. No
trait value was invented. Next: stage 8 after real context is supplied.

### Step 8 — Prompt assembly

Status: BLOCKED.

Outcome/files changed: no prompt builder using invented context fields. Actual
claim, colleague, available-action and announcement fields remain unknown.
Checks: inspected existing shared types and data. Existing ids include `gossip`,
`climber`, `loyalist`, `skeptic`, `breadwinner` and `flight`; some resemble
archetypes. Preserve actual reference ids and agree identity framing with the
engine owner. Do not put `AgentProfile.archetype` into a prompt.

Dependency: actual engine context, impulsivity, persona assignment, claim age and
scandal metadata. Preserve the spec's exact opening, every-claim belief request,
mood-only lines and only `ctx.available` actions when implementing this stage.
Next: build and check prompts after stage 4 inputs are available.

### Step 9 — Full prompt safety

Status: BLOCKED.

Outcome/files changed/checks: helper/placeholder checks pass, but no full prompts
exist. Sixteen calm/high-stress prompts have **not** been generated or reviewed.
Dependency: stage 8 and real eight-agent inputs. Next: automate disclosure checks
and manually read all sixteen actual prompts; legitimate ids and ages stay allowed.

### Step 10 — Concurrent invocations

Status: BLOCKED for provider endpoint; transport checks passed.

Outcome: eight client calls start before any successful response can finish.
Distinct outputs, usage and callback metrics remain associated with their own
invocation. One rate limit and one hung request resolve to `null` without
rejecting the batch. Every invocation makes exactly one API attempt. No
production scheduler or engine retry loop was added.

Files changed: `tests/concurrency.test.ts`, with real SDK/stubbed fetch, a
start barrier, abort-aware hung fetch and a two-second watchdog. Checks: script
and focused TypeScript passed; timeout was approximately 203 ms with a 200 ms
test setting. Dependency: stage 4 exact provider for the final provider-level
check. This client test does not prove engine integration. Next: repeat at the
provider boundary when available.

### Step 11 — Live engine integration

Status: BLOCKED.

Outcome/files changed/checks: no engine edits or integrated runs. Dependency:
engine branch, exported provider inputs, validation/normalization, one engine
retry, rules fallback and injection owner. A precise compilable integration
example must wait for actual export paths and fields. Next: owner injects the
provider and verifies both `llm_raw` and `llm_bias`, including repeated-failure
rules fallback. Cached-mode equivalence is not applicable while cache is deferred.

### Step 12 — Correlated decision logging

Status: BLOCKED.

Outcome/files changed: no new logging mechanism or payload fields. Existing
client metrics expose per-call latency, outcome and mapped usage via an optional
callback. Transport tests demonstrate per-invocation callback isolation; they
do not establish integrated agent/tick records.

Checks: existing client and new concurrency scripts pass. Dependency: agree the
internal metadata/correlation mechanism with the engine owner before changing
logging. The caller must supply agent id, tick, retry count and fallback reason;
never infer them from prompts. Cache is absent, so no cached usage may be
reported as new billing. Next: owner-correlated integrated log verification.

### Step 13 — Acceptance and handoff

Status: BLOCKED overall; all available LLM-local checks passed.

Outcome: independent implementation and verification are ready. No live
calm/high-stress behavioural comparison, full prompt review or engine integration
is claimed. No wording tuning was attempted without those results.

Files changed: `implementation-status.md` for this handoff and stage dependencies.
The other files changed in this task are listed under their stages above.
Existing changes to `agent.md`, manifests, lockfile, config, client and prior
handoff files were preserved; no engine, UI, shared types or environment edits.
New files and the smoke edit were manually reviewed; whitespace checks pass.

## Verification commands and entry points

Run from `/Users/theo/Desktop/Whack2026/office-sim`:

```sh
for test in server/llm/tests/*.test.ts; do node --import tsx "$test" || exit 1; done
./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --esModuleInterop --skipLibCheck --types node server/llm/*.ts server/llm/tests/*.ts
node --import tsx server/llm/tests/smoke.ts
git diff --check
```

All five test scripts passed: client, parser, bands, traits and concurrency.
The focused TypeScript command passed. The live smoke requires network access,
the installed SDK and `ANTHROPIC_API_KEY`; it loads local dotenv settings without
printing credentials. The already-configured model is `claude-sonnet-5-5`, with
1024 max output tokens, 20 seconds per attempt, no temperature parameter and
SDK retries disabled. There is no cache directory.

Also ran `./node_modules/.bin/tsc --noEmit`. Full project checking is blocked by
the previously recorded TS6305: `vite.config.d.ts` has not been built from
`vite.config.ts`. No project configuration changes were made to bypass it.

Usable local exports: `createMessageClient`, `parseReply`, `stateParagraph`, the
four individual state sentence functions, the five trait sentence functions,
`sourceTrustSentence` and `placeholderPersonas`. There is no completed
engine-facing provider entry point yet. Resume at stage 4 when the actual engine
branch is available, then finish stages 8–13 against its real contracts.
