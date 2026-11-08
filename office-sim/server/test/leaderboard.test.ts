import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { board, METRICS, normalise, type LeaderboardFile, type LeaderboardRun, type MetricId } from '../../shared/leaderboard';
import { LEADERBOARD_SCENARIO, MODEL_CEOS, doNothing, leaderboardProvider, modelCeo, type CeoCache, type Usage } from '../leaderboard/ceos';
import { runMetrics } from '../leaderboard/metrics';
import type { EngineTickLog } from '../engine-types';
import { DEFAULT_PARAMS as P } from '../params';
import { fixtureCast } from '../scripts/fixture';
import { runSimulation } from '../tick';

const base = Object.fromEntries(METRICS.map(m => [m.id, 1])) as Record<MetricId, number>;
const run = (entry: string, seed: number, over: Partial<Record<MetricId, number>>): LeaderboardRun =>
  ({ entry, seed, metrics: { ...base, ...over }, prices: [100, 101], ceo: { decisions: 4, fallbacks: 0 } });
const file = (runs: LeaderboardRun[]): LeaderboardFile => ({ schemaVersion: 1, generatedAt: 'x', mode: 'test', ticks: 40, seeds: [1, 2], scenario: [],
  entries: [{ id: 'a', name: 'A', kind: 'model', color: '#fff' }, { id: 'b', name: 'B', kind: 'baseline', color: '#fff' }], runs, usage: {} });

describe('leaderboard scoring', () => {
  it('normalises min-max with lower-is-better metrics flipped', () => {
    const runs = [run('a', 1, { endPrice: 50, volatility: 2 }), run('a', 2, { endPrice: 100, volatility: 4 })];
    const { scores } = normalise(runs);
    assert.equal(scores.get(runs[0])!.endPrice, 0); assert.equal(scores.get(runs[1])!.endPrice, 100);
    assert.equal(scores.get(runs[0])!.volatility, 100); assert.equal(scores.get(runs[1])!.volatility, 0);
  });
  it('scores a metric with no spread 50 and leaves it out of the group average', () => {
    const runs = [run('a', 1, { endPrice: 50 }), run('b', 1, { endPrice: 100 })];
    const { scores, spread } = normalise(runs);
    assert.equal(spread.morale, false); assert.equal(scores.get(runs[0])!.morale, 50);
    const rows = board(file(runs), 0);
    assert.equal(rows.find(r => r.entry.id === 'b')!.shareholders, 100, 'only end price has spread among shareholder metrics');
  });
  it('the slider moves rank from shareholders to people', () => {
    // A wins on price, B keeps everyone.
    const runs = [run('a', 1, { endPrice: 100, departures: 2 }), run('a', 2, { endPrice: 90, departures: 2 }),
      run('b', 1, { endPrice: 60, departures: 0 }), run('b', 2, { endPrice: 50, departures: 0 })];
    assert.deepEqual(board(file(runs), 0).map(r => r.entry.id), ['a', 'b']);
    assert.deepEqual(board(file(runs), 1).map(r => r.entry.id), ['b', 'a']);
    const a = board(file(runs), 0)[0];
    assert.equal(a.rank, 1); assert.equal(a.max, 100); assert.ok(Math.abs(a.min - 80) < 1e-9); assert.ok(Math.abs(a.score - 90) < 1e-9);
  });
  it('badges go to the best mean, are shared on ties and skipped when everyone is equal', () => {
    const runs = [run('a', 1, { endPrice: 100, leaks: 0 }), run('b', 1, { endPrice: 50, leaks: 0 })];
    const rows = board(file(runs), 0.5);
    assert.deepEqual(rows.find(r => r.entry.id === 'a')!.badges, ['Top share price']);
    assert.deepEqual(rows.find(r => r.entry.id === 'b')!.badges, []);
  });
});

describe('model CEO', () => {
  it('caches replies per prompt and attempt, and counts usage only for real calls', async () => {
    const cache: CeoCache = new Map(); const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, errors: 0 };
    let calls = 0;
    const create = async () => { calls++; return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2 }, content: [{ type: 'text', text: '{"ok":true}' }] } as never; };
    const ctx = { schemaVersion: 1, kind: 'ceo', revision: 3, actor: 'ceo', authority: 'full', cases: [], evidence: [], options: [], directives: [],
      finances: { cash: 0, committed: 0, revenue: 0, bookings: 0, costs: 0, target: 0 }, employees: [], tasks: [] } as never;
    const ceo = modelCeo(MODEL_CEOS[0], cache, usage, create);
    assert.deepEqual(await ceo(ctx, 1), { ok: true });
    assert.deepEqual(await ceo(ctx, 1), { ok: true }, 'a retry of the same prompt is a second, separate call');
    assert.equal(calls, 2); assert.equal(cache.size, 2);
    const replay = modelCeo(MODEL_CEOS[0], cache, usage, async () => { throw new Error('network'); });
    assert.deepEqual(await replay(ctx, 1), { ok: true }, 'a rerun is served from the cache');
    assert.equal(usage.calls, 2); assert.equal(usage.inputTokens, 20); assert.equal(usage.errors, 0);
  });
});

describe('leaderboard run', () => {
  it('a stub run with the composite provider yields every metric', async () => {
    const logs: EngineTickLog[] = []; const ticks = 12;
    const result = await runSimulation(fixtureCast(1, P), { seed: 1, mode: 'llm_bias', ticks, scenario: LEADERBOARD_SCENARIO, gossip: true, billboard: true, priceFeedback: false, business: true },
      leaderboardProvider(doNothing, 1), P, r => logs.push(r.log));
    const m = runMetrics(result.world, logs, P, ticks);
    for (const def of METRICS) assert.ok(Number.isFinite(m[def.id]), def.id);
    assert.equal(m.endPrice, result.world.price.price);
    assert.ok(result.world.eventState.decisions.some(d => d.kind === 'ceo' && d.fallback === null && d.choices.length === 0), 'Do-Nothing decisions validate as empty');
  });
});
