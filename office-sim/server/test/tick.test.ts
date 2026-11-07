import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MODES, type RunConfig, type TurnContext } from '../engine-types';
import { DEFAULT_PARAMS as P } from '../params';
import { CALM_SCENARIO, CURATED_EVENT_TYPES, SHOCK_SCENARIO, buildScenario, fixtureCast } from '../scripts/fixture';
import { createStubProvider } from '../stub-provider';
import { createWorld, queueEvent, runSimulation, runTick, toSimulationState } from '../tick';

const config = (over: Partial<RunConfig> = {}): RunConfig => ({
  seed: 42, mode: 'llm_bias', ticks: 16, scenario: SHOCK_SCENARIO, gossip: true, billboard: true, priceFeedback: false, ...over,
});

const run = (c: RunConfig, provider = createStubProvider(c.seed)) => runSimulation(fixtureCast(c.seed), c, provider);

describe('tick loop: seeded event scheduling', () => {
  it('buildScenario uses the curated event pool and spaces events by 2-5 ticks', () => {
    const schedule = buildScenario(77, 40);
    assert.ok(schedule.length > 0);
    assert.ok(schedule.every((event) => CURATED_EVENT_TYPES.includes(event.type)));
    for (let i = 1; i < schedule.length; i++) {
      const gap = schedule[i].tick - schedule[i - 1].tick;
      assert.ok(gap >= 2 && gap <= 5, `gap ${gap} outside 2-5 ticks`);
    }
  });

  it('the same seed gives the same schedule, a different seed gives a different one', () => {
    const a = buildScenario(99, 50);
    const b = buildScenario(99, 50);
    const c = buildScenario(100, 50);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
  });
});

describe('tick loop: checkpoint', () => {
  it('16 ticks with the stub provider: at least one agent quits', async () => {
    const r = await run(config());
    assert.equal(r.world.tick, 16);
    assert.ok(r.summary.quits >= 1, `quits: ${r.summary.quits}`);
    assert.equal(r.summary.fallbacks, 0);
  });

  it('two runs with the same seed are identical; a different seed differs', async () => {
    const a = JSON.stringify(await run(config()));
    const b = JSON.stringify(await run(config()));
    assert.equal(a, b);
    assert.notEqual(a, JSON.stringify(await run(config({ seed: 43 }))));
  });

  it('every mode runs and emits one TickRecord per active agent per tick', async () => {
    for (const mode of MODES) {
      const r = await run(config({ mode }));
      const expected = r.logs.reduce((n, l) => n + l.order.length, 0);
      assert.equal(r.records.length, expected, mode);
      assert.ok(r.logs.every((l) => l.decisions.every((d) => d.effective_mode === mode)), mode);
    }
  });

  it('quitters stop taking turns', async () => {
    const r = await run(config());
    for (const q of r.world.quits) {
      assert.ok(r.records.every((rec) => rec.agent !== q.agent || rec.tick <= q.tick));
    }
  });

  it('runTick never mutates its input world', async () => {
    const w = createWorld(fixtureCast(1), 1);
    const before = JSON.stringify(w);
    await runTick(w, createStubProvider(1), config());
    assert.equal(JSON.stringify(w), before);
  });
});

describe('tick loop: LLM contract', () => {
  it('null and invalid provider output fall back to rules and are logged', async () => {
    const provider = createStubProvider(42, {
      nullFor: (id, t) => id === 'flight' && t === 1,
      invalidFor: (id, t) => id === 'loyalist' && t === 1,
    });
    const r = await runTick(createWorld(fixtureCast(42), 42), provider, config());
    const byAgent = Object.fromEntries(r.log.decisions.map((d) => [d.agent, d]));
    assert.equal(byAgent.flight.fallback, 'no_output');
    assert.equal(byAgent.flight.effective_mode, 'rules');
    assert.equal(byAgent.loyalist.fallback, 'invalid_json');
    assert.equal(byAgent.gossip.fallback, null);
  });

  it('invalid output is retried once before falling back', async () => {
    let calls = 0;
    const flaky = createStubProvider(42);
    const provider = async (agent: Parameters<typeof flaky>[0], ctx: TurnContext) => {
      if (agent.id === 'ceo' && calls++ === 0) return '{oops';
      return flaky(agent, ctx);
    };
    const r = await runTick(createWorld(fixtureCast(42), 42), provider, config());
    assert.equal(r.log.decisions.find((d) => d.agent === 'ceo')?.fallback, null);
  });

  it('a provider that throws is a logged fallback, not a crash', async () => {
    const r = await runTick(createWorld(fixtureCast(42), 42), async () => { throw new Error('rate limited'); }, config());
    assert.ok(r.log.decisions.every((d) => d.fallback === 'provider_error'));
  });

  it('the legacy single-action LlmTurn format works', async () => {
    const r = await run(config({ ticks: 3 }), createStubProvider(42, { legacyFormat: true }));
    assert.equal(r.summary.fallbacks, 0);
    assert.ok(r.logs[0].decisions.every((d) => d.llm?.proposals.length === 1 && d.llm.proposals[0].weight === 1));
  });

  it('agents never see truth tags', async () => {
    const seen: TurnContext[] = [];
    const stub = createStubProvider(42);
    await run(config({ ticks: 10 }), async (a, ctx) => {
      seen.push(ctx);
      return stub(a, ctx);
    });
    assert.ok(seen.some((c) => c.claims.length > 0));
    for (const c of seen) assert.ok(!JSON.stringify(c).includes('is_true'));
  });

  it('rules and random modes never call the provider', async () => {
    for (const mode of ['rules', 'random'] as const) {
      let calls = 0;
      await run(config({ mode, ticks: 3 }), async () => { calls++; return null; });
      assert.equal(calls, 0, mode);
    }
  });

  it('tick-1 proposals are identical across llm_raw and llm_bias (shared, like a cache)', async () => {
    const a = await run(config({ mode: 'llm_raw', ticks: 1 }));
    const b = await run(config({ mode: 'llm_bias', ticks: 1 }));
    const props = (r: typeof a) => r.logs[0].decisions.map((d) => [d.agent, d.llm?.proposals]).sort();
    assert.deepEqual(props(a), props(b));
  });
});

describe('tick loop: events and ablations', () => {
  it('queued judge events apply on the next tick', async () => {
    const w = queueEvent(createWorld(fixtureCast(5), 5), { type: 'pr_scandal', isTrue: false, hearers: ['skeptic'] });
    const r = await runTick(w, null, config({ mode: 'rules', scenario: [] }));
    assert.deepEqual(r.log.events.map((e) => [e.type, e.is_true]), [['pr_scandal', false]]);
    assert.equal(r.world.queue.length, 0);
  });

  it('billboard off: no events; gossip off: nobody gossips', async () => {
    const r = await run(config({ billboard: false, gossip: false }));
    assert.ok(r.logs.every((l) => l.events.length === 0));
    assert.ok(r.records.every((rec) => rec.action !== 'gossip'));
  });

  it('calm run: at most one agent quits in 30 ticks', async () => {
    const r = await run(config({ scenario: CALM_SCENARIO, ticks: 30 }));
    assert.ok(r.summary.quits <= 1, `quits: ${r.summary.quits}`);
  });

  it('toSimulationState projects onto the shared shape', async () => {
    const r = await run(config());
    const s = toSimulationState(r.world);
    assert.equal(s.tick, 16);
    assert.deepEqual(Object.keys(s.agents), r.world.ids);
    assert.deepEqual(s.metrics.crack_order, r.summary.crack_order);
    assert.equal(s.metrics.true_reach, r.summary.reach.true_holders);
    assert.ok(s.claims.every((c) => !('scandal' in c)));
  });

  it('every tunable lives in params: a different param set changes the run', async () => {
    const harsher = structuredClone(P);
    harsher.rules.passive.burnoutGain = 6;
    const a = await runSimulation(fixtureCast(42), config(), createStubProvider(42));
    const b = await runSimulation(fixtureCast(42), config(), createStubProvider(42), harsher);
    assert.ok(b.summary.quits > a.summary.quits);
  });
});
