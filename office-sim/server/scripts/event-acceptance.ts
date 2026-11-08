import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createWorld, runTick } from '../tick';
import { fixtureCast } from './fixture';
import type { World } from '../engine-types';
import { arrival } from '../events/lifecycle';
import { TICKS_PER_MONTH, workdayTime } from '../../shared/workday';
const seeds = Array.from({ length: Number(process.env.EVENT_SEEDS ?? 100) },(_,i) => i+1);
const ticks = TICKS_PER_MONTH * 12;
function metrics(w: World) {
  const b = w.business; const roots = w.eventState.cases;
  const arrivals = w.eventState.scheduling.filter(s => s.reason === 'scheduled');
  const sourceCounts = Object.fromEntries(['external','employee','management','injection'].map(source => [source, { positive: roots.filter(e => e.origin === source && e.valence === 'positive').length, negative: roots.filter(e => e.origin === source && e.valence === 'negative').length }]));
  return { seed: w.seed, roots: roots.length, positive: roots.filter(e => e.valence === 'positive').length,
    common: roots.filter(e => e.rarity === 'common').length, rare: roots.filter(e => e.rarity === 'rare').length, sourceCounts,
    scheduled: arrivals.length, replacements: w.eventState.scheduling.filter(s => s.reason.startsWith('replaced') || s.reason.startsWith('promoted')).length,
    deferrals: Object.fromEntries([...new Set(w.eventState.scheduling.filter(s => !['scheduled','replaced_by_work_outcome','replaced_by_employee_error','promoted_existing_incident'].includes(s.reason)).map(s => s.reason))].map(reason => [reason,w.eventState.scheduling.filter(s => s.reason === reason).length])),
    costReviews: roots.filter(e => e.templateId === 'cost_review').length, layoffs: w.ids.filter(id => w.agents[id].status === 'laid_off').length,
    avoidedLayoffs: roots.filter(e => e.templateId === 'cost_review' && e.outcome?.includes('avoided')).length,
    breaches: roots.filter(e => e.domain === 'security' && e.rarity === 'rare').length,
    openCaseAge: roots.filter(e => ['open','responding','monitoring'].includes(e.status)).map(e => ticks-e.openedTick),
    repeatFamilies: roots.length-new Set(roots.map(e => e.templateId)).size,
    lateDeliveries: b.tasks.filter(t => t.deadline < ticks && !['done','cancelled'].includes(t.status)).length,
    cash: b.cash, revenue: b.revenue, costs: b.costs, headcount: w.ids.filter(id => w.agents[id].status === 'active').length,
    trust: w.ids.reduce((n,id) => n+w.agents[id].state.trust_mgmt,0)/w.ids.length,
    burnout: w.ids.reduce((n,id) => n+w.agents[id].state.burnout,0)/w.ids.length,
    exits: w.quits.length, idleTime: b.idle, work: b.work.filter(r => r.progress > 0).length,
    fallbackCount: w.eventState.decisions.filter(d => d.fallback && d.fallback !== 'rules').length,
    arrivals: arrivals.map(a => ({ rarity: a.rarity, tick: a.tick, nominal: a.nominal, activeDay: workdayTime(a.tick).day, calendarDay: workdayTime(a.tick).dayOfMonth, month: workdayTime(a.tick).month })),
  };
}
const started = performance.now();
const results = [];
for (const seed of seeds) {
  let w = createWorld(fixtureCast(seed),seed);
  for (let tick = 0; tick < ticks; tick++) w = (await runTick(w,null,{ mode: 'rules', scenario: [], gossip: true, billboard: true, business: true })).world;
  results.push(metrics(w));
}
const nominal = Object.fromEntries((['common','rare'] as const).map(rarity => {
  // Gaps between successive nominal arrivals, in ticks.
  const samples = seeds.flatMap(seed => { let due = arrival(seed,rarity,0,0); return Array.from({length: 30},(_,i) => { const next = arrival(seed,rarity,i+1,due); const gap = next-due; due = next; return gap; }); });
  return [rarity,{ min: Math.min(...samples), max: Math.max(...samples), mean: samples.reduce((n,v) => n+v,0)/samples.length }];
}));
const roots = results.reduce((n,r) => n+r.roots,0); const positive = results.reduce((n,r) => n+r.positive,0);
const output = { configuration: { seeds, ticks, months: 12, mode: 'rules', personality: 'seeded fixture cast', scheduler: 'stateful common/rare; causal replacements enabled' }, nominal, totalRoots: roots, positiveFraction: positive/roots,
  totalCostReviews: results.reduce((n,r) => n+r.costReviews,0), totalLayoffs: results.reduce((n,r) => n+r.layoffs,0), totalAvoidedLayoffs: results.reduce((n,r) => n+r.avoidedLayoffs,0),
  averageHeadcount: results.reduce((n,r) => n+r.headcount,0)/results.length, averageCash: results.reduce((n,r) => n+r.cash,0)/results.length,
  elapsedMs: performance.now()-started, results };
writeFileSync(process.env.EVENT_ACCEPTANCE_OUTPUT ?? '/tmp/events-acceptance.json',JSON.stringify(output,null,2));
console.log(JSON.stringify({ ...output, results: undefined },null,2));
if (output.positiveFraction < 0.55 || output.positiveFraction > 0.65) process.exitCode = 1;
