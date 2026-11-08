import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MODES, type RunConfig, type TurnContext } from '../engine-types';
import { DEFAULT_PARAMS as P } from '../params';
import { CALM_SCENARIO, CURATED_EVENT_TYPES, SHOCK_SCENARIO, buildScenario, fixtureCast } from '../scripts/fixture';
import { createStubProvider } from '../stub-provider';
import { createWorld, queueEvent, runSimulation, runTick, toSimulationState } from '../tick';
import { isOfficeHour, TICKS_PER_DAY, TICKS_PER_QUARTER } from '../../shared/workday';

const config = (over: Partial<RunConfig> = {}): RunConfig => ({
  seed: 42, mode: 'llm_bias', ticks: 16, scenario: SHOCK_SCENARIO, gossip: true, billboard: true, priceFeedback: false, ...over,
});

const run = (c: RunConfig, provider = createStubProvider(c.seed)) => runSimulation(fixtureCast(c.seed), c, provider);

describe('tick loop: seeded event scheduling', () => {
  it('buildScenario puts one shock at a random office hour in each 14-workday period', () => {
    const period = P.cadence.shockPeriodDays * TICKS_PER_DAY;
    for (let seed = 1; seed <= 2000; seed++) {
      const schedule = buildScenario(seed, TICKS_PER_QUARTER * 2);
      assert.ok(schedule.every((event) => CURATED_EVENT_TYPES.includes(event.type)));
      assert.ok(schedule.every((event) => isOfficeHour(event.tick)), `seed ${seed}: shock outside office hours`);
      const periods = schedule.map((event) => Math.floor((event.tick - 1) / period));
      assert.equal(new Set(periods).size, periods.length, `seed ${seed}: two shocks in one period`);
      // Every complete period inside the run has exactly one.
      for (let p = 0; (p + 1) * period <= TICKS_PER_QUARTER * 2; p++) assert.ok(periods.includes(p), `seed ${seed}: period ${p} has no shock`);
    }
    const quarter = buildScenario(77, TICKS_PER_QUARTER).length;
    assert.ok(quarter >= 2 && quarter <= 3, `expected 2-3 shocks per quarter, got ${quarter}`);
  });

  it('the same seed gives the same schedule, a different seed gives a different one', () => {
    const a = buildScenario(99, TICKS_PER_QUARTER * 2);
    const b = buildScenario(99, TICKS_PER_QUARTER * 2);
    const c = buildScenario(100, TICKS_PER_QUARTER * 2);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
  });

  it('buildScenario deals every event type before repeating one, and varies truth and rumour sources', () => {
    const truths = new Set<boolean>();
    const sources = new Set<string>();
    for (let seed = 1; seed <= 100; seed++) {
      const types = buildScenario(seed, TICKS_PER_QUARTER * 2).map((event) => event.type);
      assert.equal(new Set(types).size, types.length, `seed ${seed} repeats an event within a quarter`);
      for (const event of buildScenario(seed, TICKS_PER_QUARTER * 2)) {
        truths.add(event.isTrue!);
        if (event.source) sources.add(event.source);
      }
    }
    assert.deepEqual([...truths].sort(), [false, true]);
    assert.ok(sources.size > 3, `rumour sources: ${[...sources]}`);
  });

  it('extending the run length keeps the earlier schedule', () => {
    const short = buildScenario(5, TICKS_PER_QUARTER);
    assert.deepEqual(buildScenario(5, TICKS_PER_QUARTER * 2).slice(0, short.length), short);
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
    await run(config({ ticks: 10, scenario: [{ tick: 2, type: 'pr_scandal', isTrue: true }] }), async (a, ctx) => {
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

  it('calm run: at most one agent quits in 30 ticks, in all but a few seeds', async () => {
    let unstable = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const r = await run(config({ seed, scenario: CALM_SCENARIO, ticks: 30 }));
      if (r.summary.quits > 1) unstable++;
    }
    assert.ok(unstable <= 3, `${unstable} of 50 calm runs lost more than one agent`);
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
    const a = await runSimulation(fixtureCast(42), config({ ticks: 50, scenario: [{ tick: 2, type: 'pr_scandal', isTrue: true }] }), createStubProvider(42));
    const b = await runSimulation(fixtureCast(42), config({ ticks: 50, scenario: [{ tick: 2, type: 'pr_scandal', isTrue: true }] }), createStubProvider(42), harsher);
    assert.ok(b.summary.quits > a.summary.quits);
  });
});

describe('workday hours', () => {
  it('applies no overtime penalty in office hours (09:00 to 17:00, and 09:00 the next day)', async () => {
    const params = structuredClone(P);
    params.rules.passive.stressRelax = 0;
    params.rules.passive.burnoutGain = 0;
    params.rules.passive.burnoutGainPerStress = 0;
    params.rules.passive.burnoutDecay = 0;
    const provider = async () => ({ proposals: [{ action: 'work', weight: 1 }], public_line: '', inner_monologue: '', beliefs: {} });
    for (const tick of [1, 2, 3, 4, 5, 9] as const) {
      const world = createWorld(fixtureCast(42), 42, params);
      world.tick = tick - 1;
      world.price.tick = tick - 1;
      const id = world.ids[0];
      const before = world.agents[id].state;
      const result = await runTick(world, provider, config({ mode: 'llm_raw', scenario: [] }), params);
      assert.equal(result.world.agents[id].state.stress, before.stress + params.rules.actions.work.stress);
      assert.equal(result.world.agents[id].state.burnout, before.burnout);
    }
  });

  it('applies overwork burnout only to active employees who choose overwork', async () => {
    const params = structuredClone(P);
    params.rules.passive.stressRelax = 0;
    params.rules.passive.burnoutGain = 0;
    params.rules.passive.burnoutGainPerStress = 0;
    params.rules.passive.burnoutDecay = 0;
    const world = createWorld(fixtureCast(42), 42, params);
    world.tick = 4;
    world.price.tick = 4;
    const [id, quitter] = world.ids;
    world.agents[quitter].status = 'quit';
    const before = structuredClone(world.agents);
    const result = await runTick(world, async () => ({ proposals: [{ action: 'overwork', weight: 1 }], public_line: '', inner_monologue: '', beliefs: {} }), config({ mode: 'llm_raw', scenario: [] }), params);
    assert.equal(result.world.agents[id].state.burnout, before[id].state.burnout + params.rules.actions.overwork.burnout);
    assert.deepEqual(result.world.agents[quitter], before[quitter]);
  });
});
