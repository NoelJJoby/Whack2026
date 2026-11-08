import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { TurnProvider, World } from '../engine-types';
import { DEFAULT_PARAMS as P } from '../params';
import { fixtureCast } from '../scripts/fixture';
import { createStubProvider } from '../stub-provider';
import { createWorld, runTick, toSimulationState } from '../tick';
import { isOfficeHour, isOvertime, TICKS_PER_DAY } from '../../shared/workday';

const config = { mode: 'llm_raw' as const, scenario: [], gossip: true, billboard: true, priceFeedback: false };

/** Agents in `late` propose only overwork; everyone else only normal work. */
function provider(late: Set<string>, calls: string[] = []): TurnProvider {
  return async (agent, ctx) => {
    calls.push(`${ctx.tick}:${agent.id}`);
    return { proposals: [{ action: late.has(agent.id) ? 'overwork' : 'work', weight: 1 }], public_line: '', inner_monologue: '', beliefs: {} };
  };
}

async function runTo(w: World, tick: number, p: TurnProvider, params = P) {
  const logs = [];
  while (w.tick < tick) {
    const r = await runTick(w, p, config, params);
    w = r.world;
    logs.push(r.log);
  }
  return { world: w, logs };
}

/** Workloads well below the stay-late threshold, so only overwork keeps people in. */
function calmWorld() {
  const w = createWorld(fixtureCast(42), 42);
  for (const id of w.ids) { w.agents[id].state.workload = 40; w.agents[id].baselineWorkload = 40; }
  return w;
}

describe('presence: who works late', () => {
  it('at 17:00 only overworkers and high workloads stay; at 23:00 everyone goes home; at 09:00 everyone is back', async () => {
    const late = new Set(['climber']);
    let w = calmWorld();
    w.agents.breadwinner.state.workload = 90; w.agents.breadwinner.baselineWorkload = 90;
    const r = await runTo(w, 5, provider(late));
    const close = r.logs.at(-1)!;
    assert.ok(close.presence, '17:00 records presence');
    assert.deepEqual([...close.presence!.stayed].sort(), ['breadwinner', 'climber']);
    for (const id of r.world.ids) assert.equal(toSimulationState(r.world).agents[id].present, ['breadwinner', 'climber'].includes(id), id);

    const evening = await runTo(r.world, TICKS_PER_DAY, provider(late));
    for (const log of evening.logs) {
      assert.ok(isOvertime(log.tick));
      assert.ok(log.order.every((id) => late.has(id) || id === 'breadwinner'), `tick ${log.tick}: ${log.order}`);
    }
    const end = evening.logs.at(-1)!;
    assert.deepEqual(end.presence!.stayed, [], '23:00 sends everyone home');
    assert.ok(evening.world.ids.every((id) => evening.world.agents[id].present === false));

    const morning = await runTo(evening.world, TICKS_PER_DAY + 1, provider(late));
    assert.equal(morning.logs[0].order.length, evening.world.ids.length, 'everyone is back at 09:00');
    assert.ok(morning.logs[0].presence === undefined, 'ordinary office hours log no presence');
  });

  it('overtime costs only the people who stayed', async () => {
    const params = structuredClone(P);
    params.rules.passive.stressRelax = 0;
    params.rules.passive.burnoutGain = 0;
    params.rules.passive.burnoutGainPerStress = 0;
    params.rules.passive.burnoutDecay = 0;
    const late = new Set(['climber']);
    const r = await runTo(calmWorld(), 5, provider(late), params);
    const before = structuredClone(r.world.agents);
    const next = await runTick(r.world, provider(late), config, params);
    const overwork = params.rules.actions.overwork;
    assert.equal(next.world.agents.climber.state.stress, before.climber.state.stress + overwork.stress + params.rules.overtime.stress);
    assert.equal(next.world.agents.climber.state.burnout, before.climber.state.burnout + overwork.burnout + params.rules.overtime.burnout);
    for (const id of next.world.ids.filter((x) => x !== 'climber')) {
      assert.deepEqual(next.world.agents[id].state, before[id].state, `${id} is at home: unchanged`);
    }
  });

  it('when everyone went home, evening hours make no calls and no one acts', async () => {
    const calls: string[] = [];
    const r = await runTo(calmWorld(), TICKS_PER_DAY, provider(new Set(), calls));
    const evening = calls.filter((c) => isOvertime(Number(c.split(':')[0])));
    assert.deepEqual(evening, []);
    assert.ok(r.logs.filter((l) => isOvertime(l.tick)).every((l) => l.order.length === 0 && l.lines.length === 0));
  });

  it('nobody can gossip or complain to someone who has gone home', async () => {
    const late = new Set(['gossip']);
    const talk: TurnProvider = async (agent, ctx) => {
      // Everyone left in the office is a colleague the prompt offers; nobody at home is.
      for (const c of ctx.colleagues) assert.notEqual(c.id, 'skeptic', `tick ${ctx.tick}: ${c.id} offered while away`);
      return { proposals: [{ action: late.has(agent.id) ? 'overwork' : 'work', weight: 1 }], public_line: '', inner_monologue: '', beliefs: {} };
    };
    const r = await runTo(calmWorld(), 5, provider(late));
    await runTo(r.world, TICKS_PER_DAY, talk);
  });
});

describe('presence: business hours', () => {
  it('cases open and management meets only in office hours', async () => {
    let w = createWorld(fixtureCast(42), 42);
    const stub = createStubProvider(42);
    for (let i = 0; i < TICKS_PER_DAY * 6; i++) w = (await runTick(w, stub, { ...config, mode: 'llm_bias', business: true })).world;
    assert.ok(w.eventState.cases.length > 0, 'cases opened');
    assert.ok(w.eventState.cases.every((e) => isOfficeHour(e.openedTick)), 'no case opens after 17:00');
    assert.ok(w.eventState.decisions.every((d) => isOfficeHour(d.tick)), 'no management meeting after 17:00');
  });
});
