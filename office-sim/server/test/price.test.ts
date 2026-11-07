import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { ACTIONS, type RunConfig, type TurnContext } from '../engine-types';
import { DEFAULT_PARAMS as P } from '../params';
import { applyPriceFeedback, createPriceState, normal, toPriceDTO, updatePrice, validatePriceParams, type PriceInput, type PriceState } from '../price';
import { stream } from '../rng';
import { buildScenario, fixtureCast } from '../scripts/fixture';
import { createStubProvider } from '../stub-provider';
import { createWorld, runSimulation, runTick } from '../tick';
import { makeAgent, makeClaim } from './helpers';

const params = () => ({ ...structuredClone(P.price), sigma: 0, oRef: 1 });
const input = (tick = 1): PriceInput => ({ tick, events: [], leaks: [], claims: {},
  seats: [{ id: 'a', action: 'work', burnout: 20 }],
  postQuit: [{ id: 'a', active: true, state: { stress: 30, burnout: 20, trust_mgmt: 70 } }], feedback: false, feedbackDeltas: [] });
const update = (state: PriceState, data: PriceInput, p = params()) => updatePrice(state, data, p, stream(1, data.tick, '*', 'price'));
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10, `${a} vs ${b}`);
const config = (over: Partial<RunConfig> = {}): RunConfig => ({ seed: 42, mode: 'llm_bias', ticks: 30, scenario: [], gossip: true, billboard: true, priceFeedback: false, ...over });

test('initial price is exact; constant work with no noise stays at P0', () => {
  const p = params(); let state = createPriceState(p, 1);
  assert.equal(state.price, p.initialPrice); assert.equal(state.ret, 0);
  for (let tick = 1; tick <= 30; tick++) { state = update(state, input(tick), p).state; close(state.price, p.initialPrice); close(state.ret, 0); }
});
test('same seed produces identical immutable results with an isolated price stream', () => {
  const p = { ...params(), sigma: 0.1 }, state = createPriceState(p, 1), data = input();
  const before = structuredClone({ state, data, p });
  const first = update(state, data, p);
  for (let i = 0; i < 100; i++) stream(1, 1, '*', 'action').next();
  assert.deepEqual(first, update(state, data, p)); assert.deepEqual({ state, data, p }, before);
  first.state.news.push({ id: 'mutation', kind: 'leak', claimId: 'c', rootId: 'c', impact: 0, bornTick: 1, isTrue: true, correctionTick: null });
  assert.equal(state.news.length, 0);
});
test('every action has explicit configurable output; only the overwork bonus depends on burnout', () => {
  const p = { ...params(), outputAlpha: 1 };
  const expected = { work: 1, overwork: 1.24, verify: 0.6, complain: 0.5, gossip: 0.5, slack_off: 0.3, interview: 0.2, leak: 0.2 };
  for (const action of ACTIONS) { const data = input(); data.seats[0].action = action;
    close(update(createPriceState(p, 1), data, p).record.rawOutput, expected[action]);
    data.seats[0].burnout = 100;
    close(update(createPriceState(p, 1), data, p).record.rawOutput, p.productivity[action]);
  }
});
test('news correction follows actual claim birth; repeated and late leaks are separate shocks', () => {
  const p = params(); const data = input();
  data.claims.c = makeClaim('c', { is_true: false, created_tick: 1 });
  data.events = [{ type: 'pr_scandal', is_true: false, claim: 'c' }];
  data.leaks = [{ agent: 'a', claim: 'c' }, { agent: 'b', claim: 'c' }];
  let result = update(createPriceState(p, 1), data, p);
  close(result.record.newsLevel, -0.14); assert.equal(result.state.news.length, 3);
  for (let tick = 2; tick <= 6; tick++) { result = update(result.state, input(tick), p); close(result.record.newsLevel, -0.14 * 0.95 ** (tick - 1)); }
  result = update(result.state, input(7), p); close(result.record.newsLevel, 0); assert.equal(result.record.correctedIds.length, 3);
  const late = input(8); late.claims = data.claims; late.leaks = [{ agent: 'a', claim: 'c' }];
  result = update(result.state, late, p); close(result.record.newsLevel, 0);
  assert.deepEqual(result.record.bornIds, ['leak:8:a:c']); assert.deepEqual(result.record.correctedIds, ['leak:8:a:c']);
  result = update(result.state, input(9), p); assert.deepEqual(result.record.correctedIds, []);
});
test('distorted children use their own truth and correction clock, not their root', () => {
  const p = params(); const data = input(4);
  data.claims.root = makeClaim('root', { is_true: true, created_tick: 1 });
  data.claims.child = makeClaim('child', { is_true: false, created_tick: 4, rootId: 'root', parentId: 'root' });
  data.leaks = [{ agent: 'a', claim: 'child' }];
  let state = createPriceState(p, 1); for (let t = 1; t <= 3; t++) state = update(state, input(t), p).state;
  let r = update(state, data, p); assert.equal(r.state.news[0].correctionTick, 10);
  for (let t = 5; t <= 10; t++) r = update(r.state, input(t), p);
  assert.deepEqual(r.record.correctedIds, ['leak:4:a:child']); close(r.record.newsLevel, 0);
});
test('isolated false scandal is exp(-.08)-1 and true scandal retains rho^5 after five ticks', () => {
  for (const isTrue of [false, true]) {
    const p = params(), data = input(); data.claims.c = makeClaim('c', { is_true: isTrue, created_tick: 1 });
    data.events = [{ type: 'pr_scandal', is_true: isTrue, claim: 'c' }];
    let r = update(createPriceState(p, 1), data, p); close(r.state.price / 100 - 1, Math.exp(-0.08) - 1);
    for (let t = 2; t <= 7; t++) { r = update(r.state, input(t), p); if (t === 6) close(r.record.newsLevel / -0.08, 0.95 ** 5); }
    if (isTrue) { assert.equal(r.record.correctedIds.length, 0); assert.ok(r.record.newsLevel < 0); }
    else { close(r.record.newsLevel, 0); close(r.state.price, 100); }
  }
});
test('noise affects only the price level and returns contain the noise difference', () => {
  const p = params(), noisy = { ...p, sigma: 0.01 }, state = createPriceState(p, 1);
  const first = update(state, input(), noisy), clean = update(state, input(), p);
  close(first.record.rawOutput, clean.record.rawOutput); close(first.record.newsLevel, clean.record.newsLevel);
  close(first.record.ret, first.record.noise);
  const second = update(first.state, input(2), noisy); close(second.record.ret, second.record.noise - first.record.noise);
  const zero = { ...stream(1, 1, '*', 'price'), next: () => 0 }; assert.ok(Number.isFinite(normal(zero)));
});
test('vacant office has finite bounded price, output floor, zero headcount and null morale', () => {
  const p = { ...params(), outputAlpha: 1 }; const data = input(); data.seats[0].action = null; data.postQuit[0].active = false;
  const r = update(createPriceState(p, 1), data, p);
  assert.equal(r.record.rawOutput, 0); assert.equal(r.record.headcount, 0); assert.equal(r.record.morale, null);
  assert.equal(r.record.guards.outputFloor, true); assert.ok(r.state.price >= p.minPrice && r.state.price <= p.maxPrice);
});
test('price bounds preserve the raw decomposition and guard reason', () => {
  for (const [impact, bound] of [[10000, 'max'], [-10000, 'min']] as const) {
    const p = params(); p.impacts.pr_scandal = impact;
    const data = input(); data.claims.c = makeClaim('c', { created_tick: 1 }); data.events = [{ type: 'pr_scandal', is_true: true, claim: 'c' }];
    const r = update(createPriceState(p, 1), data, p); assert.equal(r.record.guards.priceBound, bound);
    assert.ok(Math.abs(r.state.price / (bound === 'max' ? p.maxPrice : p.minPrice) - 1) < 1e-14);
    close(r.record.guards.rawLogPrice, Math.log(100) + impact);
  }
});
test('invalid parameters, roster, state, claims and nonfinite inputs are rejected', () => {
  for (const [key, value] of Object.entries({ initialPrice: 0, oRef: 0, outputFloor: -1, sigma: -1, rho: 0, outputAlpha: 2, minPrice: 200, maxPrice: Infinity, refuteDelay: 1.5, trustCoefficient: -1 })) {
    assert.throws(() => validatePriceParams({ ...params(), [key]: value }), key);
  }
  assert.throws(() => createPriceState(params(), 0)); assert.throws(() => createWorld([], 1));
  const data = input(); data.seats[0].burnout = NaN; assert.throws(() => update(createPriceState(params(), 1), data));
  data.seats[0].burnout = 20; data.postQuit[0].state.stress = Infinity; assert.throws(() => update(createPriceState(params(), 1), data));
  data.postQuit[0].state.stress = 30; data.leaks = [{ agent: 'a', claim: 'missing' }]; assert.throws(() => update(createPriceState(params(), 1), data));
});
test('feedback logs requested and actual shifts with asymmetric trust recovery, state caps and no quitters', () => {
  const active = makeAgent('a', { trust_mgmt: 50, stress: 50 }), quitter = makeAgent('q', {}, {}, { status: 'quit' });
  const prior = createPriceState(params(), 2); prior.ret = 1;
  let changes = applyPriceFeedback(prior, [active, quitter], P);
  assert.equal(changes.length, 1); assert.deepEqual(changes[0].requested, { trust_mgmt: 2, stress: 0 });
  assert.deepEqual(changes[0].actual, { trust_mgmt: 1, stress: 0 });
  prior.ret = -1; active.state.stress = 99.5; active.state.trust_mgmt = 1;
  changes = applyPriceFeedback(prior, [active], P);
  assert.deepEqual(changes[0].requested, { trust_mgmt: -2, stress: 1.5 });
  assert.deepEqual(changes[0].actual, { trust_mgmt: -1, stress: 0.5 });
});
test('feedback uses only the previous return before event effects and provider contexts', async () => {
  const cast = fixtureCast(42).slice(0, 1), w = createWorld(cast, 42); w.price.ret = -0.1;
  const seen: TurnContext[] = [];
  const r = await runTick(w, async (_a, ctx) => { seen.push(ctx); return { action: 'work', target: null, public_line: '', inner_monologue: '' }; }, config({ priceFeedback: true, scenario: [{ tick: 1, type: 'long_hours_policy' }] }));
  close(seen[0].state.trust_mgmt, w.agents[cast[0].profile.id].state.trust_mgmt - 2 - 15);
  close(seen[0].state.stress, w.agents[cast[0].profile.id].state.stress + 1.5 + 8 + (cast[0].profile.role === 'Manager' ? 10 : 0));
  assert.equal(r.log.price.feedbackDeltas.length, 1);
  const initial = await runTick(createWorld(cast, 42), null, config({ mode: 'rules', priceFeedback: true }));
  assert.deepEqual(initial.log.price.feedbackDeltas[0].requested, { trust_mgmt: 0, stress: 0 });
});
test('same-tick quitters contribute their sampled action; next tick their seat is vacant', async () => {
  const cast = fixtureCast(1).slice(0, 1); cast[0].start = { ...cast[0].start, burnout: 100, stress: 100, loyalty: 0, trust_mgmt: 0 };
  const p = structuredClone(P); p.price.outputAlpha = 1;
  const first = await runTick(createWorld(cast, 1, p), null, config({ mode: 'rules' }), p);
  assert.equal(first.log.quits.length, 1); assert.ok(first.log.price.rawOutput > 0); assert.equal(first.log.price.headcount, 0);
  const second = await runTick(first.world, null, config({ mode: 'rules' }), p);
  assert.equal(second.log.price.rawOutput, 0); assert.equal(second.log.price.morale, null);
});
test('overwork uses burnout before action resolution, not the resulting burnout', async () => {
  const cast = fixtureCast(42).slice(0, 1);
  const p = structuredClone(P);
  p.bias.floorWeight = 0;
  const w = createWorld(cast, 42, p);
  const before = w.agents[cast[0].profile.id].state.burnout;
  const r = await runTick(w, async () => ({ proposals: [{ action: 'overwork', weight: 1 }], public_line: '', inner_monologue: '', beliefs: {} }), config({ mode: 'llm_raw' }), p);
  assert.equal(r.log.decisions[0].chosen.action, 'overwork');
  assert.notEqual(r.world.agents[cast[0].profile.id].state.burnout, before);
  close(r.log.price.rawOutput, 1 + 0.3 * (1 - before / 100));
});

test('public DTO allowlist omits engine-only metadata and future corrections', () => {
  const data = input(); data.claims.c = makeClaim('c', { is_true: false, created_tick: 1 }); data.events = [{ type: 'pr_scandal', is_true: false, claim: 'c' }];
  const dto = toPriceDTO(update(createPriceState(params(), 1), data).record);
  for (const key of ['isTrue', 'is_true', 'rootId', 'parentId', 'correctionTick', 'claimId', 'feedbackDeltas']) assert.ok(!JSON.stringify(dto).includes(`"${key}"`), key);
  assert.equal(dto.markers[0].event, 'headline');
});

test('feedback off reproduces current main workforce over ten seeds and thirty ticks', async () => {
  const results = [];
  for (let seed = 1; seed <= 10; seed++) {
    const scenario = buildScenario(seed, 30);
    const r = await runSimulation(fixtureCast(seed), config({ seed, scenario }), createStubProvider(seed));
    results.push({ seed, agents: r.world.agents, claims: r.world.claims, logs: r.logs.map(({ price: _price, ...log }) => log), records: r.records });
  }
  const digest = createHash('sha256').update(JSON.stringify(results)).digest('hex');
  assert.equal(digest, '2a4b0315c64a367fd6bbd6d892dda836a5998af903542415eb61e9dab3f746ee');
});
