# LLM contract handoff

Recorded 7 November 2026 against the revised `LLM Layer Build Spec.md`.
The revised spec supersedes conflicting instructions in `agent.md` and
`LLM Layer Implementation Plan.md`.

## Agreed desired output

Canonical actions match `Action` in `shared/types.ts`:
`work`, `overwork`, `slack_off`, `complain`, `gossip`, `verify`, `interview`, `leak`.

```ts
import { z } from 'zod';

export const ACTIONS = [
  'work', 'overwork', 'slack_off', 'complain',
  'gossip', 'verify', 'interview', 'leak',
] as const;

export const ProposalSchema = z.object({
  action: z.enum(ACTIONS),
  weight: z.number().min(0),
  target: z.string().nullable().optional(),
  claim: z.string().nullable().optional(),
});

export const LlmOutputSchema = z.object({
  proposals: z.array(ProposalSchema).min(1).max(3),
  public_line: z.string(),
  inner_monologue: z.string(),
  beliefs: z.record(z.number().min(0).max(100)),
});

export type Proposal = z.infer<typeof ProposalSchema>;
export type LlmOutput = z.infer<typeof LlmOutputSchema>;
```

This documents desired output using the existing Zod 3 dependency. It is not
a provider-side validation gate. Weights are relative and need not sum to one;
beliefs may be fractional despite the prompt requesting integers. New proposals
use `claim`, not `claim_id`. Public and inner lines express mood rather than
asserting that an action has occurred.

```json
{
  "proposals": [
    { "action": "complain", "weight": 0.5, "target": "a3" },
    { "action": "gossip", "weight": 0.3, "target": "a5", "claim": "claim-6-layoffs_rumour" },
    { "action": "work", "weight": 0.2 }
  ],
  "public_line": "Fine, I'll get it done.",
  "inner_monologue": "Third late night this week. I should call that recruiter back.",
  "beliefs": { "claim-1-merger": 85, "claim-6-layoffs_rumour": 72 }
}
```

## Provider and ownership

The integration target is `server/llm.ts`, exposing an injected provider with:

```ts
type TurnProvider = (agent: EngineProfile, ctx: TurnContext) => Promise<unknown>;
```

Import the engine's actual exported types once available; their import paths
cannot yet be established. Do not create substitute engine types, `AgentView`,
`GetDecision`, or a separate `src/llm/` pipeline.

The provider makes at most one Anthropic request per invocation, with SDK
retries disabled. It extracts text, removes surrounding code fences and parses
JSON. Controlled transport, timeout, rate-limit, missing/truncated text and
parse failures return `null`, without a canned turn. Parseable schema-invalid
objects must reach the engine validator. Usage and latency stay outside the
engine-facing output payload.

The engine owns validation, normalization, one retry, fallback rules, action
availability, weighting, sampling, target/claim selection, belief combination,
state updates and concurrent scheduling. Optional persistent caching requires
an agreed engine-acceptance mechanism first.

## Verified checkout and owner dependencies

- `shared/types.ts` exports the matching eight-action `Action` union and legacy
  `LlmTurn`; it does not export `Proposal` or `LlmOutput`. Shared-type additions
  belong to the shared-types owner. Preserve `LlmTurn` during migration.
- `server/llm.ts` currently exports
  `getAgentTurn(AgentProfile, AgentState, string): Promise<LlmTurn>`, uses
  OpenRouter through the OpenAI SDK, validates locally and returns a canned
  work turn on failure. It does not implement the agreed provider interface.
  Migrating it is later-step work.
- No `EngineProfile`, `TurnContext`, `TurnProvider`, or `server/llm-adapter.ts`
  implementation is present in this checkout. The engine owner must supply
  the branch, actual type exports/context fields, validator and injection site
  before integration can be verified. No provider callers were found.
- `package.json` declares Zod 3 and `tsx`, but not `@anthropic-ai/sdk`.
  Dependency installation is a Step 2 owner handoff, not authorized manifest
  work in Step 1. Local `node_modules` is absent.
- Engine runtime checks, schema execution and TypeScript compilation were not
  performed in this documentation-only step. Inspection does not establish
  live API compatibility or engine integration.

Step 1 status: READY FOR OWNER REVIEW. Contract agreement is recorded from the
revised spec; engine branch availability and type import paths remain owner
dependencies. Await developer confirmation before Step 2.
