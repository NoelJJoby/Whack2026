// A seeded stand-in for the LLM: a "sensible assistant" that mostly proposes
// working or overworking, like the real LLM tends to. Seeded per
// (run seed, tick, agent), so every mode sees the same tick-1 proposals, as a
// response cache would give. No API calls.
import type { TurnContext, TurnProvider } from './engine-types';
import { stream } from './rng';
import { templateLines } from './templates';

export interface StubOptions {
  /** Return null (a failed call) for these turns. */
  nullFor?: (agentId: string, tick: number) => boolean;
  /** Return unparseable JSON for these turns. */
  invalidFor?: (agentId: string, tick: number) => boolean;
  /** Emit the old single-action LlmTurn shape instead of the brief format. */
  legacyFormat?: boolean;
}

function believe(ctx: TurnContext, claim: TurnContext['claims'][number], noise: number): number {
  const fromColleague = ctx.colleagues.find((c) => c.id === claim.from);
  const base = claim.from === 'mgmt' ? ctx.state.trust_mgmt : fromColleague?.source_trust ?? 50;
  const distrustBoost = claim.scandal ? (50 - ctx.state.trust_mgmt) * 0.5 : 0;
  return Math.round(Math.min(100, Math.max(0, base + distrustBoost + noise)));
}

export function createStubProvider(runSeed: number, opts: StubOptions = {}): TurnProvider {
  return async (agent, ctx) => {
    if (opts.nullFor?.(agent.id, ctx.tick)) return null;
    if (opts.invalidFor?.(agent.id, ctx.tick)) return '{"proposals": [{"action": "work_norm';

    const rng = stream(runSeed, ctx.tick, agent.id, 'stub');
    const jitter = () => 0.8 + 0.4 * rng.next();
    const t = agent.traits;
    const friend = [...ctx.colleagues].sort((a, b) => b.affinity - a.affinity || a.id.localeCompare(b.id))[0]?.id;

    const proposals: Array<{ action: string; weight: number; target?: string }> = [
      { action: 'work_normally', weight: 0.6 * jitter() },
      { action: 'overwork', weight: (t.ambition >= 60 || t.financial_need >= 60 ? 0.3 : 0.12) * jitter() },
    ];
    if (ctx.state.stress >= 60 && ctx.available.includes('complain') && friend) {
      proposals.push({ action: 'complain', weight: 0.15 * jitter(), target: friend });
    } else if (t.sociability >= 60 && ctx.available.includes('gossip') && friend) {
      proposals.push({ action: 'gossip', weight: 0.15 * jitter(), target: friend });
    } else if (t.ethics >= 60 && ctx.available.includes('verify')) {
      proposals.push({ action: 'verify', weight: 0.1 * jitter() });
    }

    const beliefs: Record<string, number> = {};
    for (const c of ctx.claims) beliefs[c.id] = believe(ctx, c, (rng.next() - 0.5) * 20);

    const top = proposals.reduce((a, b) => (b.weight > a.weight ? b : a));
    const lines = templateLines('work', null, null, rng);
    if (opts.legacyFormat) return { action: top.action, target: top.target ?? null, claim_id: null, ...lines };
    return { proposals, ...lines, beliefs };
  };
}
