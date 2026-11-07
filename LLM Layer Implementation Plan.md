# LLM Layer Implementation Plan

Based on the updated LLM Layer Build Spec. This document is a plan for coding agents; it does not authorize starting implementation. “Endpoint” below means a completion checkpoint, not an HTTP route. This layer does not need new server endpoints.

## Instructions for every agent

1. Read the build spec and current repository instructions before starting. Preserve its exact shared types, schema, function signatures and ownership boundaries.
2. Work on one numbered step at a time. Before editing, list the exact files needed and why. Suggested files below are a maximum scope, not a requirement to touch every file.
3. Edit only necessary files under `src/llm/`. Preserve existing work. No unrelated formatting, cleanup, refactoring, renaming or fixes. Do not edit engine, tick loop, server, UI, project configuration, dependency manifests, lockfiles or environment files without explicit authorization for those files.
4. For missing dependencies or configuration outside that boundary, give the developer the exact required commands or changes. Never hardcode, print or commit API keys. Use Anthropic only, through `@anthropic-ai/sdk`.
5. Use plain `tsx` scripts with `node:assert` for meaningful checks. Use stubbed API responses for failure tests; reserve live API calls for smoke checks and behaviour evaluation.
6. Review the diff after each step. Report the outcome, files changed and reasons, checks run and results, and any owner dependency. Stop at the endpoint and wait for developer confirmation before starting the next numbered step.
7. Mark an endpoint COMPLETE only when its checks pass. Use READY FOR OWNER REVIEW or BLOCKED when applicable; do not silently skip checks or claim stubbed tests prove live integration works.

## Step 1 — Establish the shared contracts

**Purpose:** Agree the format exchanged between this layer and the engine.

**Files:** `src/llm/types.ts`, `src/llm/schema.ts`; a focused schema test under `src/llm/tests/` if needed.

- Copy the types and Zod schema exactly from the spec. Use neutral agent ids.
- Check that the types compile using the existing project setup. Do not alter project configuration to make the check pass.
- Check a valid response and invalid action, negative weight, empty or oversized proposal lists, and out-of-range beliefs.
- Give the developer the contracts to share with the engine owner. Do not contact the owner yourself unless instructed.

**Endpoint 1:** Types compile, schema checks pass, and the engine owner has reviewed the contracts. You can create and test these files immediately; the engine implementation is not needed. Until review happens, report READY FOR OWNER REVIEW. Unchanged-contract local work can continue when the developer confirms; engine integration must wait for agreement.

## Step 2 — Connect to Anthropic

**Purpose:** Prove that one model call works.

**Files:** `src/llm/client.ts`, `src/llm/config.ts`, a smoke script under `src/llm/tests/`.

- Check whether the official SDK and required tooling are already installed. If missing, provide installation instructions for the developer without modifying manifests or lockfiles.
- Read `ANTHROPIC_API_KEY` from the environment. Store the Claude model id, max output tokens, supported temperature setting, and timeout in one config file. Start the timeout at 20 seconds.
- Use the Messages API. Extract text blocks, map input/output token usage to the shared usage fields, and identify missing text or truncated output as failures.
- Disable SDK retries so the later decision wrapper controls retries. Apply a timeout to each attempt and log latency.
- Run one JSON-only smoke prompt when credentials and dependencies are available. Confirm the extracted JSON matches the existing schema; reuse the parse helper once Step 3 exists.

**Endpoint 2:** One actual Anthropic response has validated JSON, latency and correctly mapped token usage. If credentials or dependencies are unavailable, report BLOCKED for the live check and separately report any stubbed checks that passed. No provider-switching code exists.

## Step 3 — Parse and validate replies

**Purpose:** Turn model text into a checked `LlmOutput`.

**Files:** `src/llm/parse.ts`, `src/llm/tests/parse.test.ts`; touch the smoke script only to reuse this helper.

- Strip surrounding code fences if present, parse JSON, and validate with `LlmOutputSchema`.
- Return a typed success or a clear error; do not repair responses by inventing fields or changing the schema.
- Test valid JSON, fenced JSON, non-JSON text and all invalid schema cases from Step 1.

**Endpoint 3:** Valid responses produce typed output; malformed and invalid responses produce controlled errors.

## Step 4 — Implement `getDecision`

**Purpose:** Keep bad model calls from crashing a tick.

**Files:** `src/llm/getDecision.ts`, `src/llm/tests/getDecision.test.ts`; change `client.ts` only if required for test injection.

- Keep the exact signature `(prompt: string) => Promise<LlmResult | null>`.
- Call the client, parse and validate, then return the shared result shape.
- Retry once after an unusable reply or call failure. Each attempt has its own timeout. After the second failure, log it and return `null`.
- Never throw from `getDecision`, and never substitute a fabricated `work_normally` response.
- Test success, first-failure recovery, repeated invalid output, API rejection, missing/truncated text and timeout using a stubbed client. Assert at most two API attempts.

**Endpoint 4:** Every tested failure resolves to a valid result or `null`; no rejection escapes and retry counts are correct. Two timed-out attempts can take roughly twice the per-call timeout.

## Step 5 — Add the disk cache

**Purpose:** Reuse identical decisions across modes and restarts.

**Files:** `src/llm/cache.ts`, `src/llm/getDecision.ts`, `src/llm/config.ts`, `src/llm/tests/cache.test.ts`.

- Hash model name + newline + full prompt with SHA-256.
- Store validated raw response text and usage in JSON. Re-parse and validate cached text on reads.
- Implement `readwrite`, `replay` and `off`. A replay miss returns `null` and never calls Anthropic.
- Keep cache location configurable; agree its final location with the developer. Use isolated temporary storage for tests.
- Make concurrent writes safe so the later eight-agent runner cannot lose or corrupt entries. Handle disk/read/parse failures without allowing `getDecision` to throw; report the chosen behaviour.
- Test hits, restart persistence, replay misses, off mode, invalid cache entries, concurrent writes and exclusion of failed replies.

**Endpoint 5:** Repeated identical requests reuse validated output without an API call; replay makes zero API calls, and concurrent use preserves the cache.

## Step 6 — Convert state into feelings

**Purpose:** Describe state without exposing raw state numbers.

**Files:** `src/llm/bands.ts`, `src/llm/tests/bands.test.ts`.

- Implement the spec's exact wording for stress, burnout, loyalty and trust in management.
- Join the four sentences into one paragraph. Follow the four fields in `AgentView.state`; do not add a fifth state because the introductory prose mentions five.
- Test 0, 39, 40, 69, 70 and 100 for every state.

**Endpoint 6:** Every boundary produces the correct sentence and the combined paragraph contains no raw state values.

## Step 7 — Add trait and trust wording

**Purpose:** Describe behaviour and source credibility in words.

**Files:** `src/llm/traits.ts`, `src/llm/personas.ts` only if still a stub, focused tests under `src/llm/tests/`.

- Implement all five trait tables and source-trust bands from the spec.
- Test the same six boundary values for every trait and source trust.
- If real personas have not arrived, provide eight clearly marked behaviour-only placeholders. Do not include archetype labels.
- If the persona author has supplied real text, leave their file untouched. Report any prompt-safety problem to the developer.

**Endpoint 7:** Trait/trust checks pass and eight usable persona strings are available. State whether personas are placeholders or author-supplied.

## Step 8 — Assemble the prompt

**Purpose:** Build the model's complete view from `AgentView`.

**Files:** `src/llm/prompt.ts`, `src/llm/tests/prompt.test.ts`.

- Preserve `BuildPrompt` and the exact opening paragraph from the spec.
- Follow the skeleton in order: persona, traits, state, claims and source trust, colleagues, seven actions, JSON example and beliefs instruction.
- Include claim ids, source ids and ticks since heard. Use the specified no-claims sentence when applicable.
- Keep raw state, trait and trust scores out of the prompt. Do not include truth tags or archetype labels. Allowed numbers such as belief ranges, ids and tick ages remain valid.
- State simple assumptions for unspecified inputs, such as missing source trust, without changing contracts.

**Endpoint 8:** Sample prompts match the skeleton with and without claims and contain the exact framing and beliefs request.

## Step 9 — Check for hidden-information leaks

**Purpose:** Verify the model only sees permitted information.

**Files:** `src/llm/tests/promptSafety.test.ts`; change `prompt.ts` only if a check exposes a defect there.

- Generate calm and high-stress prompts for all eight agents.
- Check for archetype labels, raw numeric state/trait/trust fields, and claim truth metadata. Avoid banning every digit, because ids, tick ages and output ranges are legitimate.
- Use distinctive test values and inspect the relevant prompt sections so coincidental numbers in the JSON example do not cause misleading failures.
- Print and read all sixteen prompts to check tone and accidental disclosure in persona or claim text. Report problems in owner-supplied content without editing it.

**Endpoint 9:** Automated checks pass and all sixteen prompts have been reviewed. Any owner-supplied content issue is explicitly resolved or reported as blocking readiness.

## Step 10 — Run all eight calls concurrently

**Purpose:** Avoid waiting for agents one at a time.

**Files:** `src/llm/runner.ts`, `src/llm/tests/runner.test.ts`.

- Implement the exact `fireAll` signature using `Promise.all`.
- Return one result or `null` per input agent id. Keep timeouts and retries per call; isolate an unexpected rejection so other agents still return.
- Do not add action sampling or seeded resolution logic; the tick loop owns that.
- Use controlled stubs to prove calls begin concurrently. Include a hung call and check that the whole runner completes within the configured retry/timeout budget.

**Endpoint 10:** All eight ids are returned, calls run concurrently, and a hung or failed call cannot reject or indefinitely block the batch.

## Step 11 — Hand off engine integration

**Purpose:** Connect the completed layer to the existing simulation.

**Files:** Only necessary adapter/example/test files under `src/llm/`. Engine and tick-loop edits belong to their owners.

- Confirm the engine owner has agreed the contracts and the engine is ready.
- Give the developer an exact integration example: construct `AgentView`, call `buildPrompt`, pass prompts into `fireAll`, then provide each `LlmResult.output` or `null` to the engine.
- Document that the engine owns fallback rules, masking, weighting and sampling, and that the tick loop owns seeded action resolution order.
- Have the owner connect this code, or obtain explicit authorization for the particular external files before editing them.
- Run both `llm_raw` and `llm_bias` against identical prompts and the same cache. Compare the proposals before engine reweighting, not the final sampled actions.

**Endpoint 11:** A real integrated run shows identical cached proposals in both modes, and `null` triggers engine rules mode. A working local harness alone is READY FOR OWNER INTEGRATION, not COMPLETE.

## Step 12 — Complete decision logging

**Purpose:** Make decisions and failures inspectable.

**Files:** Only necessary logging changes within `src/llm/`, plus a focused test. The engine owner changes their decision log.

- Capture cache hits, retry counts, fallback status, usage and latency from the appropriate layer.
- Preserve `GetDecision` and `LlmResult`; do not add agent id or tick to their shared signatures. Agree an internal logging mechanism and how the caller correlates events with agent/tick context before implementing it.
- Let the tick loop or engine supply agent id and tick. Never guess these by parsing prompts or log an API key.
- Verify records for success, cache hit, retry recovery, final failure and replay miss. Distinguish cached usage from a new billable API call.

**Endpoint 12:** An integrated log contains agent id, tick, cache hit, retry count, fallback status and usage for each decision, with call latency available. Logging does not change the shared contracts or break concurrent correlation.

## Step 13 — Tune and hand over

**Purpose:** Confirm behaviour and deliver the finished layer.

**Files:** Prompt wording files under `src/llm/` only where needed; focused tests if wording changes affect them. Do not change author-owned personas.

- Run all acceptance scripts and repeat the live smoke check only if relevant code changed.
- Compare calm agents with agents whose stress and burnout exceed 70. Review whether proposals are dominated by `work_normally`; report observations rather than promising a deterministic model outcome.
- If needed, tune only editable prompt wording. Preserve the exact required opening, contracts, actions and state rules. Re-run prompt-safety checks after edits. Changed prompts must use fresh cache keys.
- Give the developer the public entry points, commands actually used, config/env requirements, cache location, test results, persona status and any unresolved owner dependency.
- Review the final diff to confirm that only necessary, authorized files changed.

**Endpoint 13:** Required checks pass, behaviour has been reviewed, the integration works, and the handoff is usable. Explicitly list anything still blocked; do not mark the whole implementation complete while a required owner review or live check is outstanding.

## Completion report after every step

```text
Step: <number and name>
Status: COMPLETE / READY FOR OWNER REVIEW / READY FOR OWNER INTEGRATION / BLOCKED
Outcome: <what now works>
Files changed: <each file and why it was necessary>
Checks: <exact commands or manual checks, and results>
Dependency: <what another owner or the developer must provide, or none>
Next: <next numbered step; wait for developer confirmation>
```
