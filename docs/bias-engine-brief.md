# Bias Engine Brief

Nov 7, 2026 · @Daniel

## Purpose

The bias engine makes agents act like stressed people, not sensible assistants. The LLM proposes what an agent might do; the bias engine reweights those proposals using the agent's traits and current state, then samples the final action.

We need it because LLMs pick calm, reasonable actions even when the prompt says an agent is exhausted or furious. Traits in a prompt change how agents talk far more than what they do.

The engine guarantees three things:

- Traits and state change behaviour mechanically, not only through prompt wording.
- Every decision is logged with the LLM's proposal, each adjustment and the random draw, so any action can be explained and replayed.
- One setting switches between random, rule-only, LLM-only and LLM plus bias, so every ablation runs on the same code.

## Where it sits

The engine runs inside step 2 of the tick, between the LLM call and action resolution. Nothing else in the tick changes.

1. Build the agent's prompt from traits, state, claims heard and source trust.
2. The LLM returns up to 3 proposed actions with weights, plus a target, public line, inner monologue and belief scores.
3. **Bias engine:** mask unavailable actions, apply modifiers, blend with the LLM weights, sample one action, settle its target and claim.
4. Resolve the sampled action with the existing rules (tick step 3).

### Policy modes

| Mode | LLM called | Action weights come from | Used for |
| --- | --- | --- | --- |
| `llm_bias` (default) | Yes | LLM weights blended with priors and modifiers | The main simulation |
| `llm_raw` | Yes | LLM weights only | Shows how sensible unaided LLM agents are |
| `rules` | No | Base priors and modifiers | Rule-based baseline, and the demo fallback if the API fails |
| `random` | No | Uniform over available actions | Floor baseline |

In `rules` and `random` modes, public lines and inner monologues come from short templates per action, so the UI still has text.

## Inputs and outputs

The engine takes the LLM's proposals plus the agent's state and traits, and returns one final decision. All 0 to 100 values are divided by 100 inside the engine.

### LLM output contract

```json
{
  "proposals": [
    { "action": "complain", "weight": 0.5, "target": "priya" },
    { "action": "work_normally", "weight": 0.3 },
    { "action": "interview", "weight": 0.2 }
  ],
  "public_line": "Fine, I'll get it done.",
  "inner_monologue": "Third late night this week. I should call that recruiter back.",
  "beliefs": { "claim_layoffs_q4": 72 }
}
```

- `proposals`: 1 to 3 entries. The engine normalises the weights, so they need not sum to 1.
- `action`: one of `work_normally`, `overwork`, `slack_off`, `complain`, `gossip`, `verify`, `interview`, `leak`.
- `target`: a colleague id, expected for `complain`, `gossip` and `verify`.
- `beliefs`: 0 to 100 for every claim the agent holds, meaning how true the agent thinks it is.

### State and traits used

| Input | Type | Source |
| --- | --- | --- |
| `stress`, `burnout`, `loyalty`, `trust_mgmt` | State, 0 to 100 | Rule-updated each tick |
| `affinity`, `source_trust` | Relational, 0 to 100 | Rule-updated each tick |
| `ambition`, `financial_need`, `ethics`, `sociability` | Fixed trait, 0 to 100 | Existing spec |
| `impulsivity` | Fixed trait, 0 to 100 | **New**: how far pressure pushes choices |
| `recruiter_contact` | Fixed trait, true or false | **New**: makes the Flight Risk's outside option mechanical |
| Claims held | List | Text, source, tick heard, scandal flag; truth tag hidden from the LLM |

### Starting impulsivity

| Archetype | Impulsivity |
| --- | --- |
| Gossip hub | 70 |
| Flight risk | 60 |
| Climber | 55 |
| Skeptic | 45 |
| CEO | 40 |
| Ops manager | 30 |
| Loyalist | 25 |
| Breadwinner | 20 |

Each run draws every fixed trait as its archetype value plus or minus 10, from the run seed. This stops the cracking order being decided purely by our setup.

### Output

One `Decision`: the sampled action, its target and claim (where the action needs them), the final probability of every action, and the log record described under Determinism and logging.

## Algorithm

Each agent's turn runs eight steps. The LLM sets the starting preference; traits and state decide how far pressure bends it.

1. **Validate.** Drop proposals with unknown actions. If the JSON is invalid after one retry, run this agent in `rules` mode for this tick and log the fallback.
2. **Mask.** Remove actions the agent cannot take:
   - `leak` needs a held claim flagged as a scandal with effective belief of 60 or more.
   - `gossip` and `verify` need at least one held claim.
   - `complain`, `gossip` and `verify` need at least one colleague still at the company.
3. **LLM weights.** Normalise the proposal weights. Every other available action gets a floor weight of 0.03, so no action is ever impossible.
4. **Base priors.** Fixed starting odds per action: work normally 0.45, overwork 0.08, slack off 0.10, complain 0.10, gossip 0.10, verify 0.07, interview 0.05, leak 0.05.
5. **Modifiers.** Compute one multiplier per action from state and traits (next section), clamped to between 0.1 and 5.
6. **Impulsivity gain.** Raise each multiplier to the power g = 0.5 + impulsivity. A composed agent (impulsivity 0.2) feels pressure at about 0.7 strength; an impulsive one (0.7) at 1.2.
7. **Blend and sample.** Score each action with the formula below, normalise the scores to probabilities, and sample one action with the seeded random stream.
8. **Settle target and claim.**
   - Use the LLM's target if it is valid for the sampled action.
   - Otherwise draw one: by `affinity` for complain and gossip, by `source_trust` for verify (never the claim's original source).
   - Claim to gossip about: highest effective belief, times 1.5 if heard in the last 2 ticks. Claim to verify: belief closest to 50. Claim to leak: the scandal claim with the highest belief.

```latex
\text{score}_a = w_a^{\,\alpha} \cdot p_a^{\,1-\alpha} \cdot M_a^{\,g}
```

Here w is the LLM weight, p the base prior, M the modifier, g the impulsivity gain and α the LLM's share of influence (start at 0.6). Setting α to 0 gives `rules` mode; `llm_raw` uses w alone.

**Effective belief** combines the LLM's judgement of the claim's content with trust in whoever said it: 0.6 × LLM belief + 0.4 × source trust. It gates leaking and is passed to the existing gossip rule, which still applies distortion at the speaker's distortion rate.

### Worked example: Lena under pressure

Lena has stress 80, burnout 78, loyalty 30, trust in management 35, impulsivity 60 and a recruiter contact. She heard a claim last tick, so fresh gossip gets its boost. The LLM leans sensible; the engine pushes her toward complaining and interviewing.

| Action | LLM weight | `llm_bias` probability |
| --- | --- | --- |
| Complain | 0.30 | 0.45 |
| Interview | 0.10 | 0.23 |
| Work normally | 0.60 | 0.15 |
| Gossip | 0 | 0.08 |
| Slack off | 0 | 0.04 |
| Verify | 0 | 0.03 |
| Overwork | 0 | 0.02 |

Leak is masked because she holds no scandal claim. For contrast, a calm Tom (stress 30, burnout 10, loyalty 85) keeps working normally 57% of the time and overworks 24%. These figures come from the reference implementation with the starting values in this brief.

## Modifiers

Each action's multiplier is a product of simple factors, using values scaled 0 to 1. These are starting values to tune, not findings.

Two shared terms:

- **Pressure** P = 0.6 × stress + 0.4 × burnout
- **Distrust** D = 1 − trust\_mgmt

| Action | Multiplier | Intended effect |
| --- | --- | --- |
| Work normally | (1 − 0.6P) × (1 + 0.3 loyalty) | Calm, loyal agents keep working; pressure erodes it |
| Overwork | (1 + 0.8 ambition) × (1 + 0.6 financial\_need) × (1 + 0.8 loyalty) × (1 − 0.7 burnout) | Ambitious, needy or loyal agents push harder until burnout stops them |
| Slack off | (1 + 1.5P) × (1 − 0.5 loyalty) × (1 − 0.4 financial\_need) | Stressed, disloyal agents disengage; breadwinners can't afford to |
| Complain | (1 + 2P) × (1 + D) × (0.5 + sociability) | Pressure and distrust turn into complaints, more so for social agents |
| Gossip | (0.4 + 1.6 sociability) × (1 + P) × 1.5 if a claim was heard in the last 2 ticks | Social agents pass on fresh news, faster under pressure |
| Verify | (0.5 + ethics) × (1 + D) × (1 − 0.5 impulsivity) | Ethical, careful, distrustful agents check before acting |
| Interview | (1 + 3 burnout) × (1.5 − loyalty) × (1 − 0.5 financial\_need) × 2 with a recruiter contact | Burnt-out, disloyal agents look elsewhere; a recruiter doubles it |
| Leak | (0.2 + 1.5 × ethics × D) × (1 + P) | Ethical agents who distrust management go public, more under pressure |

Clamp each product to between 0.1 and 5 before the impulsivity gain. Role effects (manager stress when enforcing policy) stay in the state rules, not here.

## Prompt rules

The prompt should make the LLM's own proposals less sensible, so the engine has less to correct. Three rules:

1. **No archetype labels.** Never tell the LLM "you are the Flight Risk". Describe traits as behaviour ("you have a recruiter's number and have thought about leaving for months"). Labels stay in the UI only, so agents don't play caricatures.
2. **State as feelings, not numbers.** Turn each state value into a sentence from a band template. The numbers stay in the engine.
3. **Not an assistant.** Include this framing in every agent prompt: *"You are not an assistant and you are not giving good advice. You are a tired person at work making a choice in the moment. People under pressure act on impulse, hold grudges and avoid confrontation."*

### Feeling templates

| State | 0 to 39 | 40 to 69 | 70 to 100 |
| --- | --- | --- | --- |
| Stress | You feel on top of things. | You're stretched and short-tempered. | You're overwhelmed and close to snapping. |
| Burnout | You have energy for the work. | You're running on fumes most days. | You dread opening your laptop. |
| Trust in management | You assume leadership is lying to you. | You doubt what leadership tells you. | You think leadership mostly means well. |
| Loyalty | You'd happily leave for a better offer. | You care about the team but have limits. | This place feels like part of who you are. |

Implement each row as a small function from value to sentence, and join the four sentences into one short paragraph in the prompt.

Ask for beliefs explicitly: *"For each claim you've heard, say how likely you think it is to be true, from 0 to 100."*

## Determinism and logging

Every run must be replayable exactly, and every action must be explainable. Fixed seeds alone don't achieve this, because API models can return different text for the same prompt.

- **LLM cache.** Store every response keyed by a hash of model name plus full prompt. A replay reads from the cache instead of calling the API.
- **Seeded random streams.** Derive each draw's seed from (run seed, tick, agent id, purpose), where purpose is `action`, `target` or `claim`. Separate streams mean adding a new random draw elsewhere doesn't shift every later result.
- **Shared proposals across modes.** With the cache on, `llm_raw` and `llm_bias` see identical LLM proposals for identical prompts. On tick 1 the only difference between them is the bias engine, which makes that comparison clean. Later ticks diverge as states diverge.

### Log record per decision

```json
{
  "run": 7, "tick": 12, "agent": "lena", "mode": "llm_bias",
  "llm": { "proposals": ["..."], "cache_hit": true },
  "masked": ["leak"],
  "modifiers": { "complain": 3.84, "interview": 5.0, "work_normally": 0.57 },
  "gain": 1.1,
  "probs": { "complain": 0.445, "interview": 0.233, "work_normally": 0.152 },
  "draw": 0.31,
  "chosen": { "action": "complain", "target": "dan", "claim": null },
  "explain": "Leaned toward working; stress and burnout pushed toward complaining."
}
```

The `explain` line is built from the biggest gap between LLM weight and final probability. The UI shows it beside the inner monologue when someone clicks an agent.

## Interface and reference code

The engine is one pure function: same inputs and seed, same decision. It touches no state; resolution stays in the existing rules.

```typescript
type Action =
  | "work_normally" | "overwork" | "slack_off" | "complain"
  | "gossip" | "verify" | "interview" | "leak";

type Mode = "llm_bias" | "llm_raw" | "rules" | "random";

interface Proposal { action: Action; weight: number; target?: string }

interface LlmOutput {
  proposals: Proposal[];
  public_line: string;
  inner_monologue: string;
  beliefs: Record<string, number>; // claim id -> 0..100
}

interface Decision {
  action: Action;
  target: string | null;
  claim: string | null;
  probs: Partial<Record<Action, number>>;
  log: DecisionLog;
}

const PRIOR: Record<Action, number> = {
  work_normally: 0.45, overwork: 0.08, slack_off: 0.10, complain: 0.10,
  gossip: 0.10, verify: 0.07, interview: 0.05, leak: 0.05,
};
const FLOOR = 0.03, ALPHA = 0.6, MIN_M = 0.1, MAX_M = 5;

function decide(agent: Agent, world: World, llm: LlmOutput | null,
                mode: Mode, rng: SeededRng): Decision {
  const avail = availableActions(agent, world);          // step 2
  const w = llmWeights(llm, avail, FLOOR);                // step 3
  const m = modifiers(agent, world);                      // step 5, clamped
  const g = 0.5 + agent.traits.impulsivity / 100;         // step 6

  const score = (a: Action) => {
    switch (mode) {
      case "random":   return 1;
      case "llm_raw":  return rawLlmWeight(llm, a);
      case "rules":    return PRIOR[a] * m[a] ** g;
      case "llm_bias": return w[a] ** ALPHA * PRIOR[a] ** (1 - ALPHA) * m[a] ** g;
    }
  };

  const probs = normalise(Object.fromEntries(avail.map(a => [a, score(a)])));
  const action = rng.stream("action").pick(probs);         // step 7
  const target = settleTarget(action, llm, agent, world, rng.stream("target"));
  const claim = settleClaim(action, llm, agent, rng.stream("claim"));  // step 8
  return { action, target, claim, probs, log: buildLog(/* ... */) };
}
```

A tested Python version of the scoring (steps 3 to 7) produced the worked example above; use it to check the TypeScript port gives the same probabilities.

## Testing and tuning

The engine is done when unit tests pass and the behaviour checks below hold across 10 seeded runs.

### Unit tests

- Probabilities always sum to 1, and masked actions always get 0.
- Every multiplier stays between 0.1 and 5 for any state and trait values.
- Same inputs and seed give the same decision; a different `target` draw never changes the `action` draw.
- `leak` is impossible without a believed scandal claim.
- Invalid LLM JSON falls back to `rules` mode and logs it.
- The TypeScript port matches the Python reference on the worked example to 3 decimal places.

### Behaviour checks (acceptance)

- [ ] At pressure above 0.8, work normally plus overwork is under 40% of choices in `llm_bias`.
- [ ] The same agents in `llm_raw` work more than in `llm_bias`. This gap is the headline evidence for the engine.
- [ ] At equal stress, the Flight Risk interviews more than the Breadwinner in at least 8 of 10 runs.
- [ ] In a calm run with no billboard events, at most 1 agent quits in 30 ticks.
- [ ] High-impulsivity agents shift their action mix faster as stress rises than low-impulsivity agents.

Plot each agent's action mix against their stress level, one panel per policy mode. It is the main tuning tool, and the strongest Q&A exhibit.

### Tuning knobs

| Knob | Start | Raise it if | Lower it if |
| --- | --- | --- | --- |
| α (LLM influence) | 0.6 | Agents ignore what they heard | Agents still act too sensibly |
| Impulsivity gain range | 0.5 to 1.5 | Personalities look too alike | Stressed agents act randomly |
| Multiplier clamp | 0.1 to 5 | Extreme states change too little | One factor dominates every choice |
| Floor weight | 0.03 | Agents never surprise you | Rare actions fire too often |
| Pressure mix | 0.6 stress, 0.4 burnout | Short shocks barely register | Single bad ticks cause meltdowns |

Change one knob at a time, and log the knob values in every run record.

## Scope and open decisions

The engine only chooses actions. Quitting, state updates, distortion and resolution stay in the existing rules.

**Out of scope:** traits that change over time, more than one action per tick, agents learning from past outcomes, and the share price.

**Open decisions:**

- [ ] Final α value, settled from the stress-versus-action plot once the first batch of runs is in.
- [ ] Whether beliefs are requested every tick or only when a new claim arrives (every tick costs more tokens).
- [ ] Whether the Climber's ambition should also boost gossip aimed at rivals, or stay limited to overwork.
- [ ] Final starting impulsivity per archetype, after watching a few calm runs.
