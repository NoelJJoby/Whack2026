# Office Simulation: Agent Instructions

## Project

A simulation of an 8-person company. Billboard events (merger, policy change, scandal, rumour) hit the workforce, and we measure who cracks, who gossips and who quits. LLM agents choose actions. Deterministic rules update all numbers.

## Core rules (do not violate)

1. **LLM decides, rules update.** The LLM only returns an action, a target, a public line and an inner monologue. Every state change, claim propagation, trust update and quit is computed by rule code, never by the LLM.
2. **Agents never see ground truth.** Each event and claim carries a hidden `is_true` tag used only for logging and metrics. It must never appear in any agent prompt.
3. **Reproducible runs.** Every run takes a seed. Randomness (turn order, gossip distortion) uses that seed. Log every event, action and state change so a run can be replayed.
4. **Structured output only.** Agent turns return strict JSON in the schema below. Reject and retry malformed output; fall back to "work normally" after retries.
5. **Keep scope fixed.** 8 agents, 5 states, 8 actions, the listed events. Do not add agents, states, actions or events unless asked.

## Entities

Eight agents, defined by archetype. Each has fixed traits (ambition, financial need, ethics, sociability, distortion rate, quit thresholds) and starting state.

| Archetype | Role | Function | Key traits |
|---|---|---|---|
| CEO | Manager | Exec | High ambition, sees little gossip |
| Ops manager | Manager | Operations | Enforces policy, caught in the middle |
| Gossip hub | Staff | Sales | High sociability, distorts claims |
| Climber | Staff | Sales | High ambition, will undermine for promotion |
| Loyalist | Staff | Engineering | High loyalty, breaks hard when it tips |
| Skeptic | Staff | Engineering | Low trust, high ethics, leaks true scandals |
| Breadwinner | Staff | Operations | High financial need, stays past breaking point |
| Flight risk | Staff | Engineering | Has a recruiter contact, leaves first |

Archetype sets traits and starting state. Role and function have only three mechanical effects:
1. Managers take a stress hit when enforcing a policy they disagree with.
2. A bad manager lowers trust in management faster.
3. Function decides who a shock hits first (a merger hits Sales and Operations, not Engineering).

## State

Per agent, 0-100, rule-updated:
- `stress`
- `workload` (hours per day)
- `loyalty`
- `trust_mgmt`
- `burnout` (slow accumulator: sustained pressure matters more than spikes)

Pairwise:
- `affinity[a][b]`: how much a likes b
- `source_trust[a][b]`: how much a believes b's claims

## Actions

One per agent per tick:

1. `work` (normal)
2. `overwork`
3. `slack_off`
4. `complain` (target: colleague)
5. `gossip` (target: colleague, claim: true or distorted)
6. `verify` (target: third party, claim to check)
7. `interview` (outside job interview)
8. `leak` (only available if the agent holds a scandal claim)

Quitting is not an action. Rules trigger it.

## Billboard events

Injected into every agent's context on the next tick. Each carries a hidden true/false tag.

`merger`, `new_management`, `long_hours_policy` (20-hour days), `pr_scandal`, `layoffs_rumour`, `surprise_bonus`, `competitor_poaching`

## Agent turn schema

Input to the LLM: persona, fixed traits, current state, claims heard (with who said them), source trust values, available actions.

Output (strict JSON):

```json
{
  "action": "gossip",
  "target": "<agent id or null>",
  "claim_id": "<claim id or null>",
  "public_line": "what the agent says out loud",
  "inner_monologue": "what the agent actually thinks"
}
```

## Tick loop

1. **Apply event.** If the billboard has a new event, update world state (for example workload in affected functions) and add the claim to agents' contexts.
2. **Agent turns,** in seeded random order. Build prompt, call LLM, validate JSON.
3. **Resolve actions** with rules:
   - `overwork`: workload, stress and burnout up.
   - `slack_off`: stress down; small trust and affinity penalty if noticed.
   - `complain`: target's stress and `trust_mgmt` shift slightly toward the speaker's.
   - `gossip`: claim passes to the target; each hop is distorted with probability equal to the speaker's distortion rate.
   - `verify`: check the claim with a third party; update `source_trust` once the claim is confirmed or refuted.
   - `interview`: raises quit likelihood at the next check.
   - `leak`: reputational hit to the company; fires only if the claim is true or believed.
4. **Passive updates** (starting values, expose as tunable config):
   - `stress` rises when `workload` exceeds a comfortable level and falls when it is normal.
   - `burnout` accumulates while `stress` is above about 60 and decays slowly below 40.
   - `trust_mgmt` drops sharply on harmful policy and recovers less on a reversal (asymmetry is intentional).
   - `source_trust` rises when a source's claim is later confirmed true and falls when refuted.
5. **Quit check.** An agent quits when `burnout` exceeds its threshold **and** (`loyalty` or `trust_mgmt` is below its threshold). Spawn a replacement a few ticks later with low trust.
6. **Log** states, actions, claim spread and a one-line story-feed entry for notable events.

## Logging and metrics

Log every tick: tick number, seed, event applied, per-agent state, action, target, public line, inner monologue, claim spread, quits and spawns. Compute from the logs:

- Order in which archetypes crack under each shock
- Spread speed and reach of true versus false claims
- Time from shock to first resignation
- Whether `trust_mgmt` recovers after a reversal

## Ablation support

Make these switchable by config so the same seed can be run with and without them:
- gossip on/off
- billboard on/off
- role swap (for example the climber as manager versus staff)

## Conventions

- Keep rule logic in pure, unit-testable functions separate from LLM calls.
- Put all tunable numbers (thresholds, rates, comfort levels) in one config file, not inline.
- Never mock the LLM output format in a way that bypasses schema validation.
- Track token usage per tick.
- Prefer small, working increments: get the full tick loop running end to end before adding features.

## Out of scope unless asked

Extra agents, extra states, free-form agent actions, alliances, sabotage, departments as a system, and a share price model.

## Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript |
| Server | Fastify + plain SSE |
| LLM | OpenRouter via the `openai` SDK, one fast model |
| Validation | Zod |
| Frontend | Vite + React + Tailwind, plain `useState` (no Zustand) |
| Chart | Recharts (one chart) |
| Runner | `tsx` + `concurrently` |
