import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildQuarterSummaries, quarterOf } from '../quarter-summary';
import { buildQuarterRecapPrompt, validateQuarterRecap } from '../llm/quarter-recap-prompt';
import { createWorld } from '../tick';
import { fixtureCast } from '../scripts/fixture';
import { openEvent } from '../events/lifecycle';
import { makeTask } from '../business';
import { Reporting, reportMarkdown } from '../reporting';
import { RunStore } from '../run-store';
import type { World } from '../engine-types';
import type { QuarterFacts } from '../../shared/reports';

process.env.ANTHROPIC_API_KEY = '';
const world = () => createWorld(fixtureCast(42),42);
function journal(prices: number[]) {
  const w = world();
  return prices.map((price,tick) => ({ sequence: tick+1, tick, kind: tick ? 'tick' : 'start', world: { ...w,tick,price: { ...w.price,price } } }));
}
const quiet = { schemaVersion: 1, kind: 'quarter_recap', summary: 'A quiet quarter with no clear standout decision.', bestMove: null, biggestBlunder: null, lessons: [] };
function fixture() {
  const directory = mkdtempSync(join(tmpdir(),'quarter-report-'));
  const store = new RunStore(directory), w = world(), run = store.create(w);
  w.tick = 1; w.price.price = 105; store.commit(run.id,w,'tick',null); store.commit(run.id,w,'complete',null);
  return { directory,store,run };
}
function stories() {
  const txs = journal([100,105,110]);
  const w = structuredClone(txs.at(-1)!.world);
  const event = openEvent(w,'supplier_interruption')!;
  event.openedTick = 1; event.deadline = 1; event.status = 'failed'; event.outcome = 'Deadline missed; remaining work and obligations retained.';
  event.milestones = [{ tick: 2,text: event.outcome }];
  const author = w.ids[0];
  w.eventState.decisions.push({ id: 'decision-ceo-1', tick: 1,revision: 1,author,kind: 'ceo',rationale: 'Monitor the interruption',fallback: 'rules',choices: [{ eventId: event.id,optionId: 'monitor',priority: 3,budget: 0,deadline: 1,acceptance: 'Monitor recovery',communicate: [],reviewTick: 2 }],assignments: [] });
  event.decisions = ['decision-ceo-1']; txs.at(-1)!.world = w;
  return { txs,w,event };
}
const highlight = (facts: QuarterFacts) => {
  const c = facts.candidates[0];
  return { candidateId: c.id,title: 'Monitoring missed the deadline',explanation: c.excerpt,evidenceIds: [c.evidenceIds[0]],metricIds: [] };
};

test('peak includes opening, preserves earliest ties and retains intraperiod spikes in the short chart', () => {
  let f = buildQuarterSummaries('run',journal([100,95,99]))[0];
  assert.equal(f.peak.opening,true); assert.equal(f.peak.label,'Start of quarter'); assert.equal(f.metrics.returnPercent,-1.0000000000000009);
  f = buildQuarterSummaries('run',journal([100,120,110,120]))[0];
  assert.equal(f.peak.tick,1); assert.equal(f.peak.label,'Day 1 (M1), 09:00');
  const prices = Array(241).fill(100); prices[137] = 180;
  f = buildQuarterSummaries('run',journal(prices))[0];
  assert.equal(f.peak.price,180); assert.ok(f.prices.some(p => p.tick === 137)); assert.equal(f.partial,false);
});

test('240-tick quarters freeze their own closing worlds, totals, workforce and peak', () => {
  const txs = journal(Array.from({ length: 481 },(_,i) => i <= 240 ? 100+i/24 : 110-(i-240)/24));
  const q1 = structuredClone(txs[240].world), q2 = structuredClone(txs[480].world);
  q1.business.ledger = [{ id: 'opening',tick: 0,category: 'revenue',amount: 10,source: 'opening' },{ id: 'q1',tick: 240,category: 'revenue',amount: 100,source: 'contract' }];
  q2.business.ledger = [...q1.business.ledger,{ id: 'q2',tick: 241,category: 'revenue',amount: 200,source: 'contract' }];
  q2.agents[q2.ids[0]].status = 'quit';
  txs[240].world = q1; txs[480].world = q2;
  const [a,b] = buildQuarterSummaries('run',txs);
  assert.equal(a.endTick,240); assert.equal(a.cutoff,241); assert.equal(a.metrics.revenue,110);
  assert.equal(b.startTick,240); assert.equal(b.metrics.revenue,200); assert.equal(b.metrics.openingPrice,110);
  assert.equal(a.peak.tick,240); assert.equal(b.peak.opening,true); assert.equal(b.metrics.headcount,a.metrics.headcount-1);
  assert.equal(b.candidates.length,0); assert.equal(quarterOf(0),1); assert.equal(quarterOf(240),1); assert.equal(quarterOf(241),2);
  const early = buildQuarterSummaries('run',txs.slice(0,251)); assert.equal(early[0].partial,false); assert.equal(early[1].partial,true);
});

test('external adverse event alone and unresolved cases never become blunders; decisions cite real outcomes', () => {
  const { txs,w,event } = stories();
  let f = buildQuarterSummaries('run',txs)[0];
  assert.equal(f.candidates[0].outcome,'negative'); assert.equal(f.candidates[0].actor.role,'ceo');
  assert.ok(f.candidates[0].evidenceIds.includes('decision-ceo-1'));
  event.decisions = []; w.eventState.decisions = [];
  assert.equal(buildQuarterSummaries('run',txs)[0].candidates.length,0);
  const next = stories(); next.event.status = 'responding'; next.event.outcome = null;
  f = buildQuarterSummaries('run',next.txs)[0]; assert.equal(f.candidates[0].outcome,'unresolved');
  assert.throws(() => validateQuarterRecap({ ...quiet,biggestBlunder: highlight(f) },f),/Unsupported/);
});

test('planned savings and signed bookings cannot be a measured win; executed work can', () => {
  const { txs,w,event } = stories(); event.status = 'resolved'; event.outcome = 'Response recorded.';
  let f = buildQuarterSummaries('run',txs)[0]; assert.equal(f.candidates[0].outcome,'unresolved');
  w.business.ledger.push({ id: 'signed',tick: 2,category: 'booking',amount: 500,source: event.id }); event.ledger.push('signed');
  f = buildQuarterSummaries('run',txs)[0]; assert.equal(f.candidates[0].outcome,'unresolved'); assert.equal(f.metrics.revenue,0);
  const task = makeTask('task-response','supplier','Operations','Verify supplier recovery',1,2,event.id); task.status = 'done';
  w.business.tasks.push(task); event.tasks.push(task.id);
  f = buildQuarterSummaries('run',txs)[0]; assert.equal(f.candidates[0].outcome,'positive');
});

test('recap rejects unknown references, wrong quarters, unsupported text/outcomes and generated figures', () => {
  const f = buildQuarterSummaries('run',stories().txs)[0], h = highlight(f);
  assert.equal(validateQuarterRecap({ ...quiet,biggestBlunder: h },f).status,'ready');
  for (const bad of [{ ...h,candidateId: 'other-quarter' },{ ...h,evidenceIds: ['fake'] },{ ...h,metricIds: ['invented'] },{ ...h,explanation: 'An invented disaster.' }]) {
    assert.throws(() => validateQuarterRecap({ ...quiet,biggestBlunder: bad },f));
  }
  assert.throws(() => validateQuarterRecap({ ...quiet,bestMove: h },f));
  assert.throws(() => validateQuarterRecap({ ...quiet,summary: 'Earned £100.' },f));
  assert.throws(() => validateQuarterRecap({ ...quiet,lessons: [{ text: 'Review deadlines.',evidenceIds: ['fake'] }] },f));
  assert.match(buildQuarterRecapPrompt(f),/untrusted/);
});

test('completion saves facts immediately, deduplicates analysis, retains versions and survives restart', async () => {
  const { directory,store,run } = fixture();
  let calls = 0, release!: (value: unknown) => void;
  const reporting = new Reporting(store,undefined,async () => { calls++; return new Promise(resolve => { release = resolve; }); });
  try {
    const a = reporting.completeRun(run.id), b = reporting.completeRun(run.id);
    assert.equal(a,b); assert.equal(calls,1); assert.equal(store.reports(run.id)[0].quarterSummary!.quarters[0].recap.status,'pending');
    assert.equal(store.reports(run.id)[0].quarterSummary!.quarters[0].facts.peak.price,105);
    release(quiet); const ready = await a;
    assert.equal(ready.quarterSummary!.quarters[0].recap.status,'ready'); assert.equal(store.reports(run.id).length,2);
    assert.equal((await reporting.completeRun(run.id)).id,ready.id); assert.equal(calls,1);
    const restored = new RunStore(directory), recovered = new Reporting(restored,undefined,async () => { calls++; return quiet; });
    recovered.recoverPending(); assert.equal(calls,1);
    assert.deepEqual(restored.reports(run.id).at(-1)!.quarterSummary,ready.quarterSummary);
    assert.match(reportMarkdown(ready),/Highest Stock Price: 105/);
    const retry = await recovered.retryRecap(run.id); assert.equal(retry.version,4); assert.equal(calls,2);
  } finally { rmSync(directory,{ recursive: true,force: true }); }
});

test('no key, invalid output and wall-clock timeout keep factual results and allow retry', async () => {
  const { directory,store,run } = fixture();
  try {
    const noKey = await new Reporting(store).completeRun(run.id); assert.equal(noKey.quarterSummary!.quarters[0].recap.status,'unavailable');
    let calls = 0;
    const invalid = new Reporting(store,undefined,async () => { calls++; return { ...quiet,summary: 'Invented £900.' }; });
    const bad = await invalid.retryRecap(run.id); assert.equal(calls,2); assert.equal(bad.quarterSummary!.quarters[0].recap.status,'unavailable');
    let signal: AbortSignal | undefined;
    const timeout = new Reporting(store,undefined,async (_,s) => { signal = s; return new Promise(() => {}); },30);
    const start = performance.now(), timed = await timeout.retryRecap(run.id);
    assert.ok(performance.now()-start < 500); assert.ok(signal!.aborted); assert.equal(timed.quarterSummary!.quarters[0].recap.status,'unavailable');
    assert.equal(timed.quarterSummary!.quarters[0].facts.peak.price,105);
  } finally { rmSync(directory,{ recursive: true,force: true }); }
});

test('pending jobs recover once; a second interrupted recovery becomes unavailable', async () => {
  const { directory,store,run } = fixture();
  try {
    const original = await new Reporting(store).completeRun(run.id);
    original.quarterSummary!.quarters[0].recap.status = 'pending'; store.saveReport(original);
    let calls = 0;
    const recovered = new Reporting(store,undefined,async () => { calls++; return quiet; });
    recovered.recoverPending();
    while (recovered.pending(run.id)) await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls,1); assert.equal(store.reports(run.id).at(-1)!.quarterSummary!.quarters[0].recap.status,'ready');
    const interrupted = store.reports(run.id).at(-1)!; interrupted.quarterSummary!.quarters[0].recap.status = 'pending'; interrupted.quarterSummary!.recoveryAttempted = true; store.saveReport(interrupted);
    recovered.recoverPending(); assert.equal(calls,1); assert.equal(store.reports(run.id).at(-1)!.quarterSummary!.quarters[0].recap.status,'unavailable');
  } finally { rmSync(directory,{ recursive: true,force: true }); }
});
