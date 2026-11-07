# Engine handoff: cross-lane change requests

From the Simulation Engine lane (`simulation_engine` branch). The engine works today without any of these changes; each one removes an adapter or a local fixture. Each item names the owner, the exact change and the reason.

## Status on 7 November 2026, after the engine (#1) and LLM (#4) merges on `main`

**Engine and LLM handler: aligned.** `server/test/llm-e2e.test.ts` runs the real provider chain (`buildTurnPrompt` → Anthropic client → `parseReply` → adapter → bias → rules) for 16 ticks, using a fake Anthropic transport and no network. It checks the following:

- The prompt advertises exactly `ctx.available`, the colleague ids and the claim ids.
- Nothing proposed is dropped.
- LLM targets and claims are honoured.
- Gossiped and distorted claims reach the hearer's next prompt.
- Quitters leave the colleague list.
- Beliefs are stored.
- The retry recovers a broken reply, and a dead agent runs on rules.

All engine tests (93), all 9 LLM test files and `tsc --noEmit -p tsconfig.json` pass. Note that `pnpm install` is needed once to pull in `@anthropic-ai/sdk`.

**Test simulation with the real LLM:** `pnpm exec tsx server/scripts/run-sim.ts --llm --ticks 16 --out runs/llm-run.json`. This makes at most 8 × 16 × 2 = 256 requests, and about 120 in practice. The runner reads `ANTHROPIC_API_KEY` from `office-sim/.env`, then the repo-root `.env`. It stops if every call fails on tick 1. Add `--cast data` to use the `data.ts` cast.

Done on `main`: 1a, 1c, 1d, 1e, 1f (shared types); 3a, 3b, 3c (data.ts); 2a–2d (llm.ts); 6c (tsconfig). Still open:

| Owner | Item |
|---|---|
| Integration | **5a/5b:** `server/index.ts` still runs the placeholder `stepSimulation`, so the web UI shows no real simulation. Also, `setInterval` calls `step()` every 2.5 s without awaiting it. A real LLM tick takes about 3 s (up to 40 s with the timeout and retry), so the interval must not start a new tick while one is still running. |
| Integration | **6a, 6b:** package scripts; add `runs/` to `.gitignore`. |
| Everyone | The repo-root `.env` is **not git-ignored**: only `office-sim/.gitignore` lists `.env`. Move the key to `office-sim/.env` or add a root `.gitignore`. |
| LLM and Data | With the `data.ts` cast, nobody quits in 16 ticks of the shock scenario (stub provider, seeds 1, 2, 3, 42). Its starting burnout (20–35) is well below the fixture's. Raise starting burnout and stress, or lower `quit_threshold`, if the demo uses that cast. |
| LLM and Data | `reachSummary` in `metrics.ts` counts each claim object once, plus once per agent holding it. So reach is inflated by the number of claims. The engine reports reach through `claimReach()` and doesn't call it. |

Behaviour note, no change needed: `leak` is offered in the prompt based on the previous tick's belief. If the reply lowers the agent's belief in the scandal claim below the leak threshold, the engine masks `leak` in the same tick. The other proposals still count.

## 1. `office-sim/shared/types.ts` (all four: frozen, needs a team ping)

| # | Change | Why |
|---|---|---|
| 1a | Add `impulsivity: number` and `recruiter_contact: boolean` to `AgentProfile.traits`. | The bias brief needs both. The engine carries them in `EngineTraits` (`server/engine-types.ts`). |
| 1b | **Decided: keep `'work'`.** No change needed. | The brief and Python reference use `work_normally`; shared types and `llm.ts` use `work`. The adapter accepts both spellings. |
| 1c | Add `Proposal` and `LlmOutput` exactly as in [llm-output-contract.md](llm-output-contract.md). Keep `LlmTurn` until `llm.ts` migrates. | The decided LLM contract: up to 3 weighted proposals (optional `target` and `claim`) plus belief scores. `server/llm-adapter.ts` accepts both shapes in the meantime. |
| 1d | Add `scandal: boolean` and `parent_id: string \| null` to `Claim`. | `leak` is gated on scandal claims. Distortion creates child claims, and we need the lineage to measure true vs false reach. |
| 1e | Add optional fields to `TickRecord`: `public_line?`, `inner_monologue?`, `quit?: boolean`, `state?: AgentState`, `decision?: DecisionLog`. | The frozen shape (one action, target and summary per record) can't carry the lines, the quit moment or the bias log. Until then the engine emits a valid `TickRecord[]` and returns everything else in a separate `EngineTickLog`. |
| 1f | Add per-agent `status: 'active' \| 'quit'` (and `quit_tick`) to `SimulationState.agents`, or a separate `status` map. | The frontend needs to grey out quitters. `toSimulationState()` currently signals a quit only through `metrics.crack_order`. |

## 2. `office-sim/server/llm.ts` (LLM and Data Lead)

| # | Change | Why |
|---|---|---|
| 2a–2d | Implement [llm-output-contract.md](llm-output-contract.md):<br>• return `null` on failure (no canned `work` turn, no schema retry)<br>• emit proposals with weights and beliefs<br>• expose a `TurnProvider`<br>• follow the brief's prompt rules | The bias engine blends LLM weights and needs beliefs to settle claims. The canned fallback hides failures from the engine. |
| 2e | Optional: cache responses by hash(model + prompt). | Exact replays and shared proposals across `llm_raw` and `llm_bias`. The decision log already has a `cache_hit` field. |

## 3. `office-sim/server/data.ts` (LLM and Data Lead)

| # | Change | Why |
|---|---|---|
| 3a | Real trait values. Every trait is currently 0, and `quit_threshold: 0` would make everyone quit on tick 1. | Until then the engine uses `server/scripts/fixture.ts`. |
| 3b | Starting state per archetype (stress, workload, loyalty, trust_mgmt, burnout, plus affinity and source-trust overrides). | `AgentProfile` has no starting state. |
| 3c | Impulsivity per the brief's table (gossip hub 70, flight risk 60, climber 55, skeptic 45, CEO 40, ops 30, loyalist 25, breadwinner 20), and `recruiter_contact: true` for the flight risk. | The brief. |
| 3d | Define `quit_threshold` as the **per-agent burnout threshold**. Loyalty and trust thresholds stay global in `params.ts`. | agent.md says "quit thresholds" (plural) but the type has one number. |
| 3e | Per-event truth tag, claim text, and who first hears each rumour. | The engine's defaults for these are in `params.ts` (`eventParams`), and the fixture scenario overrides them. |

The engine can take `data.ts` as-is once traits are filled: `CastMember = { profile, start }`.

## 4. `office-sim/server/metrics.ts` (LLM and Data Lead)

| # | Change | Why |
|---|---|---|
| 4a | `reachSummary` counts claim objects, not agents reached. Use agent-claim holdings instead, or call `claimReach()` / `reachByClaim()` in `server/claims.ts`. | The "true vs false claim reach" metric. |

The engine already imports `crackOrderFromEvents` and `firstQuitTime` unchanged.

## 5. `office-sim/server/index.ts` (Integration and Demo Lead)

| # | Change | Why |
|---|---|---|
| 5a | Hold an engine `World` in the sim singleton. Use `createWorld(cast, seed)`, then `await runTick(world, provider, config)` per step and `queueEvent(world, event)` for the injector, and send `toSimulationState(world)` and the `TickRecord[]` over SSE. | `stepSimulation` / `createInitialSimulation` are kept unchanged for compatibility but are still placeholders. `runTick` is async because the LLM is. |
| 5b | Pass `mode` from config (`llm_bias` by default; `rules` is the demo fallback if the API is down). | The brief's policy modes. |

## 6. Config and scripts (Integration and Demo Lead)

| # | Change | Why |
|---|---|---|
| 6a | `package.json` scripts: `"test": "tsx --test server/test/*.test.ts"`, `"sim": "tsx server/scripts/run-sim.ts"`, `"ablate": "tsx server/scripts/ablate.ts"`. | Convenience. No new dependencies: tests use the built-in `node:test`. |
| 6b | `.gitignore`: add `runs/`. | The ablation runner writes there by default. |
| 6c | `tsc --noEmit -p tsconfig.json` fails on `main` with TS6305, because `vite.config.ts` is both in `include` and a referenced composite project. Remove `vite.config.ts` from `tsconfig.json` `include`. | A pre-existing issue, not from the engine. The engine is typechecked by filtering that one error. |

## 7. Docs

- `docs/simulation-logic.md` doesn't exist. The engine follows `office-sim/agent.md` for the tick loop, state, actions and quit rule.
- Where the docs were silent, the engine chose concrete numbers, all of them in `params.ts`: the interview, verify, slack-off and leak effects, trust asymmetry, and claim impact on hearing. They're listed in `office-sim/server/params.ts`.
