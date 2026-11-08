import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { advanceLiveScorecard, createLiveScorecard, moraleOf, productivity, type ScoreAgent } from '../../shared/scorecard';
import { DEFAULT_PARAMS as P } from '../params';
import { SHOCK_SCENARIO, fixtureCast } from '../scripts/fixture';
import { createStubProvider } from '../stub-provider';
import { runSimulation, toSimulationState } from '../tick';
import { scorecardMetrics } from '../reporting';

const agent = (stress: number, burnout = stress, status: ScoreAgent['status'] = 'active', trust_mgmt = 50): ScoreAgent => ({ status, stress, burnout, trust_mgmt });

describe('live scorecard', () => {
  it('counts resignations against retention and layoffs separately', () => {
    let card = createLiveScorecard({ price: 100, agents: [agent(10), agent(10), agent(10), agent(10)] });
    card = advanceLiveScorecard(card, { tick: 3, price: 99, agents: [agent(10, 10, 'quit'), agent(10, 10, 'laid_off'), agent(10), agent(10)], falseReach: 2, leaks: 1 });
    card = advanceLiveScorecard(card, { tick: 4, price: 99, agents: [agent(10, 10, 'quit'), agent(10, 10, 'laid_off'), agent(10, 10, 'quit'), agent(10)], falseReach: 1, leaks: 0 });
    assert.equal(card.quits, 2); assert.equal(card.layoffs, 1);
    assert.equal(card.retention, 0.5); assert.equal(card.firstQuitTick, 3);
    assert.equal(card.peakFalseReach, 2); assert.equal(card.falseReach, 1); assert.equal(card.leaks, 1);
  });
  it('morale is 100 minus mean stress and burnout over active staff', () => {
    assert.equal(moraleOf([agent(20, 40), agent(60, 80, 'quit')]), 70);
    assert.equal(moraleOf([agent(20, 40, 'quit')]), null);
  });
});

describe('productivity', () => {
  it('weights productive actions, halves overwork and ignores the rest', () => {
    assert.equal(productivity([['work', 'overwork'], ['slack_off', 'support_colleague']], P.scorecard, P.rules.actions.overwork.burnout), (1 + 0.5 + 0 + 1) / 4);
    assert.equal(productivity([], P.scorecard, P.rules.actions.overwork.burnout), 0);
  });
});

describe('scorecard wiring', () => {
  it('a run carries a scorecard that matches its world', async () => {
    const config = { seed: 42, mode: 'llm_bias' as const, ticks: 24, scenario: SHOCK_SCENARIO, gossip: true, billboard: true, priceFeedback: false };
    const run = await runSimulation(fixtureCast(42), config, createStubProvider(42));
    const card = run.summary.scorecard!;
    assert.equal(card.tick, 24); assert.equal(card.price, run.world.price.price);
    assert.equal(card.quits, run.world.quits.length); assert.equal(card.leaks, run.world.leaks.length);
    assert.deepEqual(toSimulationState(run.world).metrics.scorecard, card);
  });
  it('the report reads per-tick logs and tolerates a world without a scorecard', async () => {
    const config = { seed: 7, mode: 'llm_bias' as const, ticks: 16, scenario: SHOCK_SCENARIO, gossip: true, billboard: true, priceFeedback: false };
    const logs: unknown[] = [];
    const run = await runSimulation(fixtureCast(7), config, createStubProvider(7), P, r => logs.push(r.log));
    const m = scorecardMetrics(logs.map((log, i) => ({ kind: 'tick', tick: i + 1, world: run.world, audit: { log } })));
    assert.ok(m.scoreProductivity > 0 && m.scoreProductivity <= 100);
    assert.equal(m.scorePrice, run.world.price.price);
    const { scorecard: _, ...old } = run.world;
    const legacy = scorecardMetrics([{ kind: 'tick', tick: 1, world: old, audit: { log: logs[0] } }]);
    assert.equal(legacy.scorePrice, undefined); assert.ok(legacy.scoreProductivity >= 0);
  });
});
