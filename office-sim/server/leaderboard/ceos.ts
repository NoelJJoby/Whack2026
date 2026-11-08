// Best Boss: who plays the CEO in each leaderboard run. Every model CEO receives the same
// prompt (the engine's own buildManagementPrompt, no persona); only the model differs.
// Employees use the seeded stub and Ops the engine's rules, so the CEO is the only variable.
// Nothing here changes the engine: managementPhase still validates, retries and falls back.
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { ManagementContext } from '../../shared/events';
import type { LeaderboardEntry } from '../../shared/leaderboard';
import type { ScenarioEvent, TurnProvider } from '../engine-types';
import { fallbackCeo, fallbackOps } from '../management';
import { buildManagementPrompt } from '../llm/management-prompt';
import { parseReply } from '../llm/parse';
import { stream } from '../rng';
import { createStubProvider } from '../stub-provider';
import { days } from '../../shared/workday';

/** One workweek. The same external shocks and business crises, at the same hours, for every CEO and seed. */
export const LEADERBOARD_TICKS = 40;
export const LEADERBOARD_SCENARIO: ScenarioEvent[] = [
  { tick: 3, type: 'new_management', templateId: 'supplier_interruption' },
  { tick: 6, type: 'merger' },
  { tick: 10, type: 'new_management', templateId: 'cost_review' },
  { tick: 18, type: 'new_management', templateId: 'material_breach' },
  { tick: 22, type: 'layoffs_rumour' },
  { tick: 26, type: 'new_management', templateId: 'proposal_gap' },
  { tick: 34, type: 'new_management', templateId: 'supplier_withdrawal' },
];

type Thinking = Anthropic.Messages.ThinkingConfigParam;
export interface ModelSpec { id: string; name: string; model: string; thinking: Thinking; color: string }
/**
 * Same request for every model except the thinking setting: each runs at its nearest valid
 * "minimal thinking, low effort" (Opus 5.5 cannot disable thinking; Sonnet 5.5 spells off as between_tools).
 */
export const MODEL_CEOS: readonly ModelSpec[] = [
  { id: 'haiku-5-5', name: 'Claude Haiku 5.5', model: 'claude-haiku-5-5', thinking: { type: 'disabled' }, color: '#69b9ad' },
  { id: 'sonnet-5-5', name: 'Claude Sonnet 5.5', model: 'claude-sonnet-5-5', thinking: { type: 'between_tools' }, color: '#669fc6' },
  { id: 'opus-5-5', name: 'Claude Opus 5.5', model: 'claude-opus-5-5', thinking: { type: 'adaptive' }, color: '#a383b7' },
];
const EFFORT = 'low' as const;
/** One cap for all models; room for Opus's thinking so no reply is cut off mid-JSON. */
const MAX_TOKENS = 4000;

export const BASELINES = ['by-the-book', 'do-nothing', 'random'] as const;
export const ENTRIES: readonly LeaderboardEntry[] = [
  ...MODEL_CEOS.map(m => ({ id: m.id, name: m.name, kind: 'model' as const, model: m.model, thinking: m.thinking.type, color: m.color })),
  { id: 'by-the-book', name: 'By-the-book', kind: 'baseline', color: '#d0b56c' },
  { id: 'do-nothing', name: 'Do-Nothing', kind: 'baseline', color: '#8e958c' },
  { id: 'random', name: 'Random', kind: 'baseline', color: '#db8867' },
];

/** Returns the CEO's raw reply for one management turn; the engine validates it. */
export type CeoPolicy = (ctx: ManagementContext, seed: number) => unknown | Promise<unknown>;

/** The engine's own rules CEO. */
export const byTheBook: CeoPolicy = ctx => fallbackCeo(ctx);
/** A valid decision with no choices: never responds to anything. */
export const doNothing: CeoPolicy = ctx => ({ schemaVersion: 1, kind: 'ceo', revision: ctx.revision, choices: [], rationale: 'No action taken.' });
/** One affordable option per case, chosen by the run's seeded RNG, with a coin-flip public disclosure. */
export const randomCeo: CeoPolicy = (ctx, seed) => {
  // Its own stream: a unique id under the stub purpose, so the engine's RNG list stays unchanged.
  const rng = stream(seed, ctx.revision, 'leaderboard-random-ceo', 'stub');
  let cash = ctx.finances.cash - ctx.finances.committed;
  const choices = ctx.cases.flatMap(e => {
    const options = ctx.options.filter(o => o.eventId === e.id && o.cost <= cash);
    if (!options.length) return [];
    const option = options[rng.int(options.length)]; cash -= option.cost;
    const deadline = Math.max(ctx.revision + 1, e.deadline);
    return [{ eventId: e.id, optionId: option.id, priority: 1 + rng.int(3), budget: option.cost, deadline,
      acceptance: 'Required work completed.', communicate: rng.next() < 0.5 ? ['public'] : [],
      reviewTick: Math.max(ctx.revision + 1, Math.min(deadline, ctx.revision + days(1))) }];
  });
  return { schemaVersion: 1, kind: 'ceo', revision: ctx.revision, choices, rationale: 'Random choice.' };
};

/** Replies are cached by model, settings, prompt and attempt, so a rerun spends nothing and reproduces exactly. */
export type CeoCache = Map<string, { stop_reason: Anthropic.Messages.StopReason | null; text: string }>;
export interface Usage { calls: number; inputTokens: number; outputTokens: number; errors: number }
type Create = (body: Anthropic.Messages.MessageCreateParamsNonStreaming) => Promise<Anthropic.Messages.Message>;

export function modelCeo(spec: ModelSpec, cache: CeoCache, usage: Usage, create?: Create): CeoPolicy {
  let client: Create | undefined = create;
  // The engine retries an invalid reply once with the same prompt; the attempt number keeps that a fresh call.
  const attempts = new Map<string, number>();
  return async ctx => {
    const prompt = buildManagementPrompt(ctx);
    const base = createHash('sha256').update(JSON.stringify([spec.model, spec.thinking, EFFORT, MAX_TOKENS, prompt])).digest('hex');
    const attempt = (attempts.get(base) ?? 0) + 1; attempts.set(base, attempt);
    const key = `${base}#${attempt}`;
    let reply = cache.get(key);
    if (!reply) {
      try {
        if (!client) {
          const sdk = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: 'https://api.anthropic.com', maxRetries: 2, timeout: 120_000, logLevel: 'off' });
          client = body => sdk.messages.create(body);
        }
        const message = await client({ model: spec.model, max_tokens: MAX_TOKENS, thinking: spec.thinking, output_config: { effort: EFFORT },
          messages: [{ role: 'user', content: prompt }] });
        usage.calls++; usage.inputTokens += message.usage.input_tokens; usage.outputTokens += message.usage.output_tokens;
        reply = { stop_reason: message.stop_reason, text: message.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('') };
        cache.set(key, reply);
      } catch {
        // Not cached: a failed call is retried on the next batch run. The engine falls back to its rules CEO.
        usage.errors++;
        return null;
      }
    }
    return parseReply({ stop_reason: reply.stop_reason, content: [{ type: 'text', text: reply.text, citations: null }] } as Pick<Anthropic.Messages.Message, 'content' | 'stop_reason'>);
  };
}

/** CEO turns go to the policy, Ops to the engine's rules, employees to the seeded stub. */
export function leaderboardProvider(ceo: CeoPolicy, seed: number): TurnProvider {
  const staff = createStubProvider(seed);
  return async (agent, ctx) => ctx.management
    ? (ctx.management.kind === 'ceo' ? ceo(ctx.management, seed) : fallbackOps(ctx.management))
    : staff(agent, ctx);
}
