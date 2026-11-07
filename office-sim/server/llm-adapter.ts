// Accepts either LLM output format and returns the brief's LlmOutput, or null
// with a reason. The engine falls back to `rules` mode on null.
import { z } from 'zod';

import { ACTIONS, type Action, type LlmOutput, type Proposal } from './engine-types';

/** Accepted spellings from the brief / team docs that differ from shared/types. */
export const ACTION_ALIASES: Record<string, Action> = {
  work_normally: 'work',
  verify_rumour: 'verify',
  leak_to_press: 'leak',
};

export const MAX_PROPOSALS = 3;

export function toAction(name: string): Action | null {
  if ((ACTIONS as readonly string[]).includes(name)) return name as Action;
  return ACTION_ALIASES[name] ?? null;
}

const text = z.string().optional().default('');

const BriefSchema = z.object({
  proposals: z
    .array(
      z.object({
        action: z.string(),
        weight: z.number().optional(),
        target: z.string().nullable().optional(),
      }),
    )
    .min(1),
  public_line: text,
  inner_monologue: text,
  beliefs: z.record(z.unknown()).optional(),
});

/** shared/types LlmTurn: one action, no weights, no beliefs. */
const TurnSchema = z.object({
  action: z.string(),
  target: z.string().nullable().optional(),
  claim_id: z.string().nullable().optional(),
  public_line: text,
  inner_monologue: text,
});

export interface AdaptResult {
  output: LlmOutput | null;
  reason: string | null;
  /** Unknown action names that were dropped. */
  dropped: string[];
}

function fail(reason: string, dropped: string[] = []): AdaptResult {
  return { output: null, reason, dropped };
}

function cleanBeliefs(raw: Record<string, unknown> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(raw ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v)) out[id] = Math.min(100, Math.max(0, v));
  }
  return out;
}

export function toLlmOutput(raw: unknown): AdaptResult {
  if (raw === null || raw === undefined) return fail('no_output');
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return fail('invalid_json');
    }
  }

  let rawProposals: Array<{ action: string; weight?: number; target?: string | null }>;
  let public_line: string;
  let inner_monologue: string;
  let beliefs: Record<string, number> = {};

  const brief = BriefSchema.safeParse(value);
  if (brief.success) {
    rawProposals = brief.data.proposals;
    public_line = brief.data.public_line;
    inner_monologue = brief.data.inner_monologue;
    beliefs = cleanBeliefs(brief.data.beliefs);
  } else {
    const turn = TurnSchema.safeParse(value);
    if (!turn.success) return fail('schema_mismatch');
    rawProposals = [{ action: turn.data.action, weight: 1, target: turn.data.target ?? null }];
    public_line = turn.data.public_line;
    inner_monologue = turn.data.inner_monologue;
  }

  const dropped: string[] = [];
  const merged = new Map<Action, Proposal>();
  for (const p of rawProposals) {
    const action = toAction(p.action);
    if (!action) {
      dropped.push(p.action);
      continue;
    }
    const weight = p.weight === undefined ? 1 : p.weight;
    if (!Number.isFinite(weight) || weight < 0) {
      dropped.push(p.action);
      continue;
    }
    const prev = merged.get(action);
    if (prev) prev.weight += weight;
    else merged.set(action, { action, weight, ...(p.target ? { target: p.target } : {}) });
  }

  const proposals = [...merged.values()]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.weight - a.p.weight || a.i - b.i)
    .slice(0, MAX_PROPOSALS)
    .map(({ p }) => p);

  if (proposals.length === 0) return fail('no_valid_actions', dropped);
  if (proposals.reduce((s, p) => s + p.weight, 0) <= 0) return fail('zero_weights', dropped);

  return { output: { proposals, public_line, inner_monologue, beliefs }, reason: null, dropped };
}
