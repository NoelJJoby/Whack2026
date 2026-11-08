// Business-mode share price is two-way: healthy work lifts it, shirking, vacancies and shocks
// lower it, and custom events move it on the tick they are announced.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueuedEvent, ScenarioEvent, TurnProvider, World } from '../engine-types';
import { fixtureCast } from '../scripts/fixture';
import { createStubProvider } from '../stub-provider';
import { createWorld, queueEvent, runTick, type TickConfig } from '../tick';
import { TICKS_PER_MONTH } from '../../shared/workday';

const SEEDS = [1, 2, 3];
const config = (scenario: ScenarioEvent[] = []): TickConfig => ({ mode: 'llm_raw', scenario, gossip: true, billboard: true, priceFeedback: false, business: true });

/** The stub works every assignment and review it is given; llm_raw takes that as given. */
const working = (seed: number) => createStubProvider(seed);
const slacking = (seed: number): TurnProvider => {
  const stub = createStubProvider(seed);
  return async (agent, ctx) => ctx.management ? stub(agent, ctx)
    : { proposals: [{ action: 'slack_off', weight: 1 }], public_line: 'Taking it slow.', inner_monologue: 'Not today.', beliefs: Object.fromEntries(ctx.claims.map(c => [c.id, 50])) };
};

async function run(seed: number, provider: TurnProvider, opts: { ticks?: number; scenario?: ScenarioEvent[]; quit?: string[]; inject?: { tick: number; event: QueuedEvent } } = {}) {
  let world: World = createWorld(fixtureCast(seed), seed);
  for (const id of opts.quit ?? []) { world.agents[id].status = 'quit'; world.agents[id].quitTick = 0; }
  const prices: number[] = [];
  for (let t = 1; t <= (opts.ticks ?? TICKS_PER_MONTH); t++) {
    if (opts.inject?.tick === t) world = queueEvent(world, opts.inject.event);
    world = (await runTick(world, provider, config(opts.scenario))).world;
    prices.push(world.price.price);
  }
  return prices;
}

test('a healthy, fully working office trends up over a month', async () => {
  for (const seed of SEEDS) {
    const prices = await run(seed, working(seed));
    assert.ok(prices.at(-1)! > 100, `seed ${seed} ends at ${prices.at(-1)}`);
    const firstDay = prices.slice(0, 8).reduce((a, b) => a + b) / 8, lastDay = prices.slice(-8).reduce((a, b) => a + b) / 8;
    assert.ok(lastDay > firstDay, `seed ${seed}: last day ${lastDay} vs first day ${firstDay}`);
  }
});

test('an office where everyone slacks off, or half the staff quit, trends down', async () => {
  for (const seed of SEEDS) {
    const healthy = (await run(seed, working(seed))).at(-1)!;
    const slack = (await run(seed, slacking(seed))).at(-1)!;
    // Three of the six employee seats (one Sales, two Engineering) are vacant from the start.
    const halfQuit = (await run(seed, working(seed), { quit: ['climber', 'skeptic', 'flight'] })).at(-1)!;
    for (const [name, price] of [['slack', slack], ['half quit', halfQuit]] as const) {
      assert.ok(price < 100, `seed ${seed} ${name} ends at ${price}`);
      assert.ok(price < healthy, `seed ${seed} ${name} ${price} vs healthy ${healthy}`);
    }
  }
});

test('a pr_scandal or competitor_poaching shock causes a visible drop', async () => {
  const tick = 10;
  for (const type of ['pr_scandal', 'competitor_poaching'] as const) {
    const control = await run(1, working(1), { ticks: tick });
    const shocked = await run(1, working(1), { ticks: tick, scenario: [{ tick, type, isTrue: true }] });
    const drop = Math.log(shocked[tick - 1] / control[tick - 1]);
    assert.ok(drop < -0.03, `${type}: log change ${drop} on the shock tick`);
  }
});

test('a positive custom event raises the price on the tick it is announced; a negative one lowers it', async () => {
  const tick = 10;
  const custom = (type: QueuedEvent['type'], priceImpact: number): QueuedEvent => ({ type, isTrue: true, custom: true, text: 'Custom announcement',
    customEffects: { morale: 0, trust: 0, stress: 0, burnout: 0, productivity: 0, churnRisk: 0, rumorSpread: 0, priceImpact },
    customMeta: { severity: 3, durationTicks: 4, summary: 'Custom announcement' } });
  const control = (await run(1, working(1), { ticks: tick }))[tick - 1];
  const good = (await run(1, working(1), { ticks: tick, inject: { tick, event: custom('surprise_bonus', 0.05) } }))[tick - 1];
  const bad = (await run(1, working(1), { ticks: tick, inject: { tick, event: custom('pr_scandal', -0.05) } }))[tick - 1];
  // The custom impact replaces the base type's, in log-price units, on the announcing tick.
  assert.ok(Math.abs(Math.log(good / control) - 0.05) < 1e-9, `good news: ${good} vs ${control}`);
  assert.ok(Math.abs(Math.log(bad / control) + 0.05) < 1e-9, `bad news: ${bad} vs ${control}`);
});
