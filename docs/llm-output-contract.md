# LLM output contract

What `llm.ts` returns for one agent on one tick, and what the engine does with it. This replaces the single-action `LlmTurn` shape.

## Decisions at a glance

| Question | Decision |
|---|---|
| Shape | Up to 3 weighted proposals, plus a public line, an inner monologue and belief scores. |
| Action names | The 8 names in `shared/types.ts` `Action`. The "work normally" action is spelled `work`, not `work_normally`. |
| Proposal fields | `action` and `weight` are required. `target` and `claim` are optional. |
| Weights | Relative numbers ≥ 0. They don't need to sum to 1; the engine normalises them. |
| Beliefs | Every tick, for every claim the agent holds, from 0 to 100. |
| Failure | Return `null`. Don't substitute a canned `work` turn. The engine retries once, then runs that agent rule-based for the tick and logs it. |
| Who validates | `llm.ts` parses the JSON. The engine validates it (`server/llm-adapter.ts`). |

## Shape

```json
{
  "proposals": [
    { "action": "complain", "weight": 0.5, "target": "gossip" },
    { "action": "gossip", "weight": 0.3, "target": "loyalist", "claim": "claim-6-layoffs_rumour" },
    { "action": "work", "weight": 0.2 }
  ],
  "public_line": "Fine, I'll get it done.",
  "inner_monologue": "Third late night this week. I should call that recruiter back.",
  "beliefs": { "claim-1-merger": 85, "claim-6-layoffs_rumour": 72 }
}
```

Drop-in types and Zod schema (proposed for `shared/types.ts` and `llm.ts`):

```ts
import { z } from 'zod';

export const ACTIONS = [
  'work', 'overwork', 'slack_off', 'complain', 'gossip', 'verify', 'interview', 'leak',
] as const;

export const ProposalSchema = z.object({
  action: z.enum(ACTIONS),
  weight: z.number().min(0),
  target: z.string().nullable().optional(), // colleague id, from ctx.colleagues[].id
  claim: z.string().nullable().optional(),  // claim id, from ctx.claims[].id
});

export const LlmOutputSchema = z.object({
  proposals: z.array(ProposalSchema).min(1).max(3),
  public_line: z.string(),
  inner_monologue: z.string(),
  beliefs: z.record(z.number().min(0).max(100)), // claim id -> 0..100
});

export type Proposal = z.infer<typeof ProposalSchema>;
export type LlmOutput = z.infer<typeof LlmOutputSchema>;
```

## The 8 actions

The prompt should offer only the actions in `ctx.available` for that agent and tick. The engine masks the rest anyway.

| Action | Meaning | `target` | `claim` | Available when |
|---|---|---|---|---|
| `work` | Work normally. | No | No | Always |
| `overwork` | Stay late; take on more. | No | No | Always |
| `slack_off` | Disengage for the day. | No | No | Always |
| `complain` | Vent to a colleague. | Expected | No | At least one colleague is still at the company |
| `gossip` | Pass a claim to a colleague. | Expected | Optional | The agent holds a claim, a colleague remains, and gossip is switched on |
| `verify` | Check a claim with a third party. | Expected | Optional | The agent holds a claim and a colleague remains |
| `interview` | Outside job interview. | No | No | Always |
| `leak` | Take a scandal claim to the press. | No | Optional | The agent holds a scandal claim it believes (effective belief ≥ 60) |

Quitting is not an action. The rules trigger it.

## Proposal format

- **1 to 3 proposals**, one per action. If the LLM sends more than 3, the engine keeps the 3 with the highest weights. Duplicate actions are merged by adding their weights.
- **`weight`** is how strongly the agent leans toward that action right now. Only the ratios between weights matter: `0.6 / 0.3 / 0.1` and `6 / 3 / 1` mean the same. Actions the LLM doesn't propose still get a small floor chance, so the LLM doesn't need to list every option.
- **`target`** is a colleague id from `ctx.colleagues`. The engine uses it if it's valid for the action it finally samples. Otherwise it draws a target: by affinity for `complain` and `gossip`, and by source trust for `verify`, avoiding whoever the claim came from unless nobody else is left.
- **`claim`** is a claim id from `ctx.claims`. The engine uses it if the agent holds that claim (for `leak`, a believed scandal claim). Otherwise it picks one:
  - **gossip:** the highest effective belief, boosted for fresh claims
  - **verify:** the belief closest to 50
  - **leak:** the most-believed scandal claim
- The engine may sample an action other than the LLM's top proposal, or one it didn't propose at all. That's the bias engine working. `public_line` and `inner_monologue` should therefore read as the agent's mood, not narrate one specific action.

## Beliefs

- Give one entry for **every** claim in `ctx.claims`, every tick, keyed by claim id. Use an integer from 0 to 100 for how true the agent thinks it is.
- Ask for it in the prompt: *"For each claim you've heard, say how likely you think it is to be true, from 0 to 100."*
- The engine combines it with trust in whoever told the agent: effective belief = 0.6 × LLM belief + 0.4 × source trust. That number gates `leak` and steers which claim gets gossiped or verified.
- Missing ids are tolerated. The engine uses the agent's last stated belief for that claim, or source trust alone if there isn't one. This covers a later decision to ask only when a new claim arrives, to save tokens.

## Provider interface

The engine calls the LLM through an injected function. It never imports `llm.ts`.

```ts
type TurnProvider = (agent: EngineProfile, ctx: TurnContext) => Promise<unknown>;
```

- **Return** the parsed JSON object, or the raw JSON string. Return `null` on a transport, rate-limit or parse failure. Throwing is also handled.
- **Don't** retry on schema errors or substitute a fallback turn. The engine validates the output, retries once, then falls back to rules mode for that agent and logs why.
- `ctx` contains everything the prompt needs:
  - `state`: the numbers. Turn them into feelings with the brief's band templates.
  - `available`: the actions to offer.
  - `colleagues`: id, name, affinity and source trust.
  - `claims`: id, text, who said it, when it was heard and a scandal flag. There are **no truth tags**.
  - `events`: this tick's announcements.
- All 8 agents are called in parallel each tick.
- For OpenRouter models that support it, set `response_format: { type: "json_object" }`.

Prompt rules from `docs/bias-engine-brief.md` still apply: no archetype labels, describe state as feelings rather than numbers, and include the "not an assistant" framing in every agent prompt.

## Compatibility

The engine still accepts the old `LlmTurn` shape (one action, which becomes one proposal with weight 1; `claim_id` becomes `claim`) and the spellings `work_normally`, `verify_rumour` and `leak_to_press`. This keeps current code working while `llm.ts` migrates. New code should emit the shape above.
