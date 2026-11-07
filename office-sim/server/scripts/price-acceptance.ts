// Reproducible synthetic experiments; no network or live LLM calls.
// node --import tsx server/scripts/price-acceptance.ts --out ../docs/share-price-results.json
import { writeFileSync } from 'node:fs';
import { ACTIONS, type RunConfig, type ScenarioEvent } from '../engine-types';
import { DEFAULT_PARAMS } from '../params';
import { createPriceState, updatePrice, type PriceInput } from '../price';
import { stream } from '../rng';
import { createStubProvider } from '../stub-provider';
import { runSimulation, type RunResult } from '../tick';
import { fixtureCast } from './fixture';
import { parseArgs } from './run-sim';

const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
function correlation(points: Array<[number, number]>) {
  if (points.length < 2) return null;
  const x = mean(points.map(p => p[0]))!, y = mean(points.map(p => p[1]))!;
  const xx = points.reduce((s, p) => s + (p[0] - x) ** 2, 0), yy = points.reduce((s, p) => s + (p[1] - y) ** 2, 0);
  return xx && yy ? points.reduce((s, p) => s + (p[0] - x) * (p[1] - y), 0) / Math.sqrt(xx * yy) : null;
}
function metrics(run: RunResult, eventTick = 5) {
  const event = run.logs[eventTick - 1].price, before = run.logs[eventTick - 2].price;
  const end = run.logs.at(-1)!.price;
  const forward: Array<[number, number]> = [];
  for (let i = 0; i + 5 < run.logs.length; i++) {
    const m = run.logs[i].price.morale;
    if (m !== null) forward.push([m, Math.log(run.logs[i + 5].price.price / run.logs[i].price.price)]);
  }
  const peak = Math.max(...run.logs.slice(eventTick - 1, eventTick + 15).map(l => l.price.price));
  const after = run.logs[eventTick + 14].price.price;
  return { seed: run.config.seed, event: { tick: eventTick, price: event.price, logReturn: event.ret,
    outputLog: event.outputLog, newsLevel: event.newsLevel, noise: event.noise,
    outputChange: event.outputLog - before.outputLog, newsChange: event.newsLevel - before.newsLevel, noiseChange: event.noise - before.noise },
    correction: run.logs[eventTick + 5].price, peak, price15TicksLater: after,
    logChange15TicksLater: Math.log(after / event.price), logChangeFromPeak: Math.log(after / peak),
    endingPrice: end.price, headcount: end.headcount, morale: end.morale,
    endingActiveTrust: mean(Object.values(run.world.agents).filter(a => a.status === 'active').map(a => a.state.trust_mgmt)),
    moraleLead: { correlation: correlation(forward), samples: forward.length }, forward };
}
async function simulate(seed: number, scenario: ScenarioEvent[], feedback = false, gossip = true) {
  const config: RunConfig = { seed, mode: 'llm_bias', ticks: 30, scenario, gossip, billboard: true, priceFeedback: feedback };
  return runSimulation(fixtureCast(seed), config, createStubProvider(seed));
}
function isolated(seed: number, isTrue: boolean) {
  const p = { ...structuredClone(DEFAULT_PARAMS.price), sigma: 0, oRef: 1 };
  let state = createPriceState(p, 1);
  const records = [];
  for (let tick = 1; tick <= 8; tick++) {
    const input: PriceInput = { tick, events: tick === 1 ? [{ type: 'pr_scandal', claim: 'scandal', is_true: isTrue }] : [], leaks: [],
      claims: { scandal: { id: 'scandal', text: 'Isolated scandal', source: 'grapevine', created_tick: 1, is_true: isTrue,
        hops: 0, scandal: true, parentId: null, rootId: 'scandal', event: 'pr_scandal', onHear: { stress: 0, trust_mgmt: 0, loyalty: 0 } } },
      seats: [{ id: 'a', action: 'work', burnout: 0 }], postQuit: [{ id: 'a', active: true, state: { stress: 30, burnout: 0, trust_mgmt: 70 } }], feedback: false, feedbackDeltas: [] };
    const r = updatePrice(state, input, p, stream(seed, tick, '*', 'price')); state = r.state; records.push(r.record);
  }
  return { seed, isTrue, birthSimpleReturn: records[0].price / 100 - 1, newsAfterFiveTicks: records[5].newsLevel,
    retainedAfterFiveTicks: records[5].newsLevel / records[0].newsLevel, correctionTickNews: records[6].newsLevel,
    correctionTickPrice: records[6].price, corrected: records[6].correctedIds };
}
export async function priceAcceptance() {
  const calm: RunResult[] = [];
  for (const seed of seeds) calm.push(await simulate(seed, []));
  const calibrationOutput = mean(calm.flatMap(r => r.logs.map(l => l.price.rawOutput)));
  const decisions = calm.flatMap(r => r.logs.flatMap(l => l.decisions));
  const falseScenario: ScenarioEvent[] = [{ tick: 5, type: 'pr_scandal', isTrue: false }];
  const longScenario: ScenarioEvent[] = [{ tick: 5, type: 'long_hours_policy', isTrue: true }];
  const longHours = [], feedbackPairs = [], gossipPairs = [];
  const allForward: Array<[number, number]> = [];
  for (const seed of seeds) {
    longHours.push(metrics(await simulate(seed, longScenario)));
    const off = metrics(await simulate(seed, falseScenario)), on = metrics(await simulate(seed, falseScenario, true));
    feedbackPairs.push({ seed, off, on, trustDifference: on.endingActiveTrust !== null && off.endingActiveTrust !== null ? on.endingActiveTrust - off.endingActiveTrust : null });
    gossipPairs.push({ seed, gossipOn: off, gossipOff: metrics(await simulate(seed, falseScenario, false, false)) });
    allForward.push(...off.forward);
  }
  const summary = {
    calm: { measuredReference: calibrationOutput, selectedReference: DEFAULT_PARAMS.price.oRef,
      priceRange: [Math.min(...calm.flatMap(r => r.logs.map(l => l.price.price))), Math.max(...calm.flatMap(r => r.logs.map(l => l.price.price)))],
      seedsWithinFivePercent: calm.filter(r => r.logs.every(l => Math.abs(l.price.price / 100 - 1) <= 0.05)).length,
      actionMix: Object.fromEntries(ACTIONS.map(a => [a, decisions.filter(d => d.chosen.action === a).length / decisions.length])),
      runs: calm.map(r => ({ ...r.summary, minPrice: Math.min(...r.logs.map(l => l.price.price)), maxPrice: Math.max(...r.logs.map(l => l.price.price)) })) },
    longHoursDeclinesAfter15Ticks: longHours.filter(r => r.logChange15TicksLater < 0).length,
    feedbackStrongerEndingTrustDecline: feedbackPairs.filter(r => r.trustDifference !== null && r.trustDifference < 0).length,
    moraleLead: { correlation: correlation(allForward), samples: allForward.length },
  };
  return { setup: { seeds, ticks: 30, mode: 'llm_bias', provider: 'deterministic stub', initialStates: 'fixtureCast(seed): fixture.ts, seeded trait jitter, unchanged calm starting states',
    calibration: 'Single reference = rounded mean of all 300 no-event fixed-seat output observations; unchanged across treatments. Other price parameters unchanged.',
    feedback: 'Off except the on arm of feedbackPairs', gossip: 'On except the off arm of gossipPairs' },
    params: DEFAULT_PARAMS, summary, isolated: seeds.flatMap(seed => [isolated(seed, false), isolated(seed, true)]), longHours, feedbackPairs, gossipPairs };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await priceAcceptance();
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.out === 'string') writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
}
