# Engine handoff: cross-lane change requests

From the Simulation Engine lane (`simulation_engine` branch). The engine works today without any of these changes; each one removes an adapter or a local fixture. Each item names the owner, the exact change and the reason.

## 1. `office-sim/shared/types.ts` (all four: frozen, needs a team ping)

| # | Change | Why |
|---|---|---|
| 1a | Add `impulsivity: number` and `recruiter_contact: boolean` to `AgentProfile.traits`. | The bias brief needs both. The engine carries them in `EngineTraits` (`server/engine-types.ts`). |
| 1b | Decide on `'work'` vs `'work_normally'`. **Proposal: keep `'work'`.** | The brief and Python reference use `work_normally`; shared types and `llm.ts` use `work`. The engine uses `work` and the adapter accepts both spellings. |
| 1c | Add `Proposal { action; weight; target? }` and `LlmOutput { proposals; public_line; inner_monologue; beliefs }` (copy them from `server/engine-types.ts`). Keep `LlmTurn` until `llm.ts` migrates. | The brief's LLM contract is up to 3 weighted proposals plus belief scores. `server/llm-adapter.ts` accepts both shapes in the meantime. |
| 1d | Add `scandal: boolean` and `parent_id: string \| null` to `Claim`. | `leak` is gated on scandal claims. Distortion creates child claims, and we need the lineage to measure true vs false reach. |
| 1e | Add optional fields to `TickRecord`: `public_line?`, `inner_monologue?`, `quit?: boolean`, `state?: AgentState`, `decision?: DecisionLog`. | The frozen shape (one action, target and summary per record) can't carry the lines, the quit moment or the bias log. Until then the engine emits a valid `TickRecord[]` and returns everything else in a separate `EngineTickLog`. |
| 1f | Add per-agent `status: 'active' \| 'quit'` (and `quit_tick`) to `SimulationState.agents`, or a separate `status` map. | The frontend needs to grey out quitters. `toSimulationState()` currently signals a quit only through `metrics.crack_order`. |

## 2. `office-sim/server/llm.ts` (LLM and Data Lead)

| # | Change | Why |
|---|---|---|
| 2a | Return `null` (or throw) on failure instead of the canned `work` turn. | The brief says invalid output runs that agent in `rules` mode and logs it. The canned turn hides the failure, so the engine can't fall back. |
| 2b | Switch the Zod schema to the brief format (`proposals` with weights, plus `beliefs`). | The bias engine blends LLM weights. A single action gives it nothing to blend. |
| 2c | Expose a function with the `TurnProvider` shape: `(agent: EngineProfile, ctx: TurnContext) => Promise<unknown>`. | The engine injects the provider; it never imports `llm.ts`. `TurnContext` already holds state, colleagues, claims (without truth tags) and the available actions. |
| 2d | Prompt: describe state as feelings (the brief's band templates), use no archetype labels, include the "not an assistant" framing, and ask for beliefs per claim id. | The brief's prompt rules. `ctx.claims[].id` is the key to use in `beliefs`. |
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
