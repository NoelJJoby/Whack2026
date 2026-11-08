import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { workdayTime } from './Workday';
import { clockAt } from '../server/llm/clock';
import { StockPrice, stockSeries } from './StockPrice';
import { mockHistory } from './mocks';

test('workday maps 8 ticks per day (09:00 to 23:00) across 30-day calendar months (2 routine filler days after 23:00) in a 240-tick quarter', () => {
  assert.deepEqual(workdayTime(0), { quarter: 1, month: 1, week: 1, day: 1, dayOfMonth: 1, fillerDays: [], hour: 8, progress: 0 });
  assert.deepEqual(workdayTime(1), { quarter: 1, month: 1, week: 1, day: 1, dayOfMonth: 1, fillerDays: [], hour: 9, progress: 12.5 });
  assert.equal(workdayTime(3).hour, 13);
  assert.deepEqual(workdayTime(5), { quarter: 1, month: 1, week: 1, day: 1, dayOfMonth: 1, fillerDays: [], hour: 17, progress: 62.5 });
  assert.deepEqual(workdayTime(8), { quarter: 1, month: 1, week: 1, day: 1, dayOfMonth: 1, fillerDays: [2, 3], hour: 23, progress: 100 });
  assert.deepEqual(workdayTime(9), { quarter: 1, month: 1, week: 1, day: 2, dayOfMonth: 4, fillerDays: [], hour: 9, progress: 12.5 });
  assert.deepEqual(workdayTime(80), { quarter: 1, month: 1, week: 2, day: 10, dayOfMonth: 28, fillerDays: [29, 30], hour: 23, progress: 100 });
  assert.deepEqual(workdayTime(81), { quarter: 1, month: 2, week: 3, day: 11, dayOfMonth: 1, fillerDays: [], hour: 9, progress: 12.5 });
  assert.deepEqual(workdayTime(240), { quarter: 1, month: 3, week: 6, day: 30, dayOfMonth: 28, fillerDays: [29, 30], hour: 23, progress: 100 });
});
test('frontend HUD and backend prompt clock share the same tick conversion through day rollover', () => {
  for (const tick of [0, 1, 5, 6, 50, 51, 150]) {
    const frontend = workdayTime(tick);
    assert.deepEqual(clockAt(tick), { day: frontend.day, hour: frontend.hour }, `tick ${tick}`);
  }
});
test('stock indicator starts at 100 and projects backend prices without mutating history', () => {
  assert.deepEqual(stockSeries([]), [{ tick: 0, price: 100 }]);
  const before = JSON.stringify(mockHistory);
  const points = stockSeries(mockHistory);
  assert.equal(points.length, mockHistory.length + 1);
  assert.ok(points.every(p => Number.isFinite(p.price) && p.price >= 1));
  assert.deepEqual(stockSeries(mockHistory), points);
  assert.equal(JSON.stringify(mockHistory), before);
  const latest = mockHistory.at(-1)!.price;
  assert.equal(stockSeries(mockHistory, 100, { ...latest, price: 63.45 }).at(-1)!.price, 63.45);
  assert.equal(stockSeries(mockHistory, 100, { ...latest, tick: latest.tick + 1, price: 70 }).length, points.length + 1);
  assert.equal(JSON.stringify(mockHistory), before);
});

test('stock chart uses backend valuation even when workforce state implies another display price', () => {
  const frames = structuredClone(mockHistory);
  frames[0].price.price = 12.345;
  const baseline = stockSeries(frames);
  assert.equal(baseline[1].price, 12.345);
  for (const frame of frames) for (const agent of Object.values(frame.state.agents)) {
    agent.stress = 100; agent.trust_mgmt = 0; agent.burnout = 100; agent.status = 'quit';
  }
  assert.deepEqual(stockSeries(frames), baseline);
});

test('existing ticker reads current server snapshot before history, and computes opening percentage', () => {
  const current = { ...mockHistory[0].price, price: 123.45 };
  const markup = renderToStaticMarkup(createElement(StockPrice, { history: [], current, initialPrice: 200 }));
  assert.ok(markup.includes('price $123.45'));
  assert.ok(markup.includes('-38.28%'));
  const reset = renderToStaticMarkup(createElement(StockPrice, { history: [], current: { ...current, tick: 0, price: 100 }, initialPrice: 100 }));
  assert.ok(reset.includes('price $100.00'));
  assert.ok(reset.includes('+0.00%'));
});

import { createAnnouncements, type Announcement } from './announcement';
import { feedEntries, metricState, playerText, timeLabel } from './hudModel';
import { MetricBar } from './GamePanel';

test('announcement queue uses elapsed time and keeps simultaneous arrivals until dismissal', () => {
  let now = 0;
  let id = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  let visible: Announcement | null = null;
  const announcements = createAnnouncements(value => { visible = value; }, (callback, delay) => {
    const handle = ++id;
    pending.set(handle, { at: now + delay, callback });
    return handle as unknown as ReturnType<typeof setTimeout>;
  }, timer => { pending.delete(timer as unknown as number); });
  const advance = (elapsed: number) => {
    now += elapsed;
    for (const [handle, task] of pending) if (task.at <= now) { pending.delete(handle); task.callback(); }
  };
  const first = mockHistory[1].events[0];
  const next = mockHistory[4].events[0];
  announcements.receive([first]);
  advance(9_999);
  assert.equal((visible as Announcement | null)?.event, first);
  announcements.receive([next]);
  assert.equal(pending.size, 1);
  advance(1);
  assert.equal((visible as Announcement | null)?.event, next);
  advance(9_999);
  assert.equal((visible as Announcement | null)?.event, next);
  advance(1);
  assert.equal(visible, null);
  assert.equal(pending.size, 0);
  announcements.receive([first]);
  announcements.clear();
  assert.equal(visible, null);
  assert.equal(pending.size, 0);
  announcements.receive([next]);
  announcements.dispose();
  assert.equal(pending.size, 0);
});

test('empty announcement batches do not reset the timer and simultaneous events remain ordered', () => {
  const values: Array<Announcement | null> = [];
  let scheduled = 0;
  const announcements = createAnnouncements(value => values.push(value), () => {
    scheduled++;
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }, () => {});
  announcements.receive([]);
  assert.equal(scheduled, 0);
  const events = [mockHistory[1].events[0], mockHistory[4].events[0]];
  announcements.receive(events);
  assert.equal(values.at(-1)?.event, events[0]);
  announcements.dismiss();
  assert.equal(values.at(-1)?.event, events[1]);
  announcements.receive([]);
  assert.equal(scheduled, 2);
});

test('wire preserves history newest-first and each resignation appears only once', () => {
  const frames = structuredClone(mockHistory);
  const record = frames.at(-1)!.records[0];
  record.quit = true;
  record.summary = 'Marcus resigned at tick 7.';
  const entries = feedEntries(frames);
  assert.equal(entries.length, frames.reduce((n, frame) => n + frame.events.length + frame.records.length, 0));
  assert.equal(entries[0].label, 'Resignation');
  assert.equal(entries.filter(e => e.key === '7-marcus').length, 1);
  assert.equal(entries[0].text, 'Marcus resigned at work period 7.');
  assert.equal(entries.at(-1)!.time, timeLabel(2));
  assert.equal(entries.filter(e => e.label === 'Announcement').length, 2);
});

test('metric states use strict simulation boundaries and trust has the favourable direction', () => {
  assert.equal(metricState('Stress', 39, 80).text, 'Recovery range');
  assert.equal(metricState('Stress', 40, 80).text, 'Burnout steady');
  assert.equal(metricState('Stress', 60, 80).text, 'Burnout steady');
  assert.equal(metricState('Stress', 61, 80).text, 'Burnout rising');
  assert.equal(metricState('Stress', 60.1, 80).text, 'Burnout rising');
  assert.equal(metricState('Workload', 45.1, 80).tone, 'coral');
  assert.equal(metricState('Trust in management', 34.9, 80).tone, 'coral');
  assert.equal(metricState('Burnout', 80.1, 80).tone, 'coral');
  assert.equal(metricState('Workload', 45, 80).tone, 'mint');
  assert.equal(metricState('Workload', 46, 80).tone, 'coral');
  assert.equal(metricState('Trust in management', 34, 80).tone, 'coral');
  assert.equal(metricState('Trust in management', 35, 80).tone, 'mint');
  assert.equal(metricState('Burnout', 80, 80).text, 'Within base exit threshold');
  assert.equal(metricState('Burnout', 81, 80).text, 'Above base exit threshold');
  assert.equal(metricState('Burnout', 61, 60).tone, 'coral');
});

test('display adapters remove engine hour terminology from errors and accessible metric text', () => {
  assert.equal(playerText('A tick is running. Try again in 2 ticks. max_ticks'), 'A work period is running. Try again in 2 work periods. duration');
  assert.equal(timeLabel(9), 'Day 4 (M1), 09:00');
  assert.equal(timeLabel(6), 'Day 1 (M1), 19:00');
  const markup = renderToStaticMarkup(createElement(MetricBar, { label: 'Trust in management', value: 82, threshold: 80 }));
  assert.ok(markup.includes('82 out of 100, Outside low-trust range'));
  assert.ok(markup.includes('Trust in management'));
  assert.ok(!/\bticks?\b/i.test(markup));
});

test('the engine badge names the decision-maker for each mode and reason', async () => {
  const { engineLabel } = await import('./hudModel');
  assert.equal(engineLabel('llm_bias', 'configured'), 'LLM + bias engine');
  assert.equal(engineLabel('rules', 'no_api_key'), 'Rules mode · No API key');
  assert.equal(engineLabel('rules', 'llm_failed'), 'Rules mode · LLM unavailable');
  assert.equal(engineLabel('rules', 'configured'), 'Rules mode');
  assert.equal(engineLabel('rules', 'fast_forward'), 'Fast-forward · Rules mode');
});

test('a failed case shows its reason in the event detail, not just the status word', async () => {
  const { EventDetail } = await import('./EventDetail');
  const reason = 'No active CEO or operations manager to respond; the case lapsed without a decision.';
  const event = { id: 'e1', rootId: 'e1', parentId: null, templateId: 'delivery_concern', headline: 'Client concern', rarity: 'common', valence: 'negative', domain: 'delivery', severity: 'medium', origin: 'external', entityId: 'x', openedTick: 1, deadline: 5, owner: null, status: 'failed', truth: true, detected: true, evidence: [], decisions: [], tasks: [], ledger: [], milestones: [], outcome: reason, quarter: 1, target: 0, value: 0, exposure: false, contained: false } as never;
  const events = { cases: [event], evidence: [], decisions: [], directives: [], scheduler: { common: { index: 0, nominal: 0, due: 0 }, rare: { index: 0, nominal: 0, due: 0 } }, scheduling: [], cooldowns: {}, incidents: [], diagnostics: [] } as never;
  const business = { tasks: [], contracts: [], work: [], ledger: [], currency: 'GBP' } as never;
  const html = renderToStaticMarkup(createElement(EventDetail, { event, events, business, cast: [], onPerson: undefined }));
  assert.match(html, /Missed its deadline/);
  assert.match(html, /<h4>Result<\/h4>/);
  assert.match(html, /No active CEO or operations manager/);
});

test('the CEO panel offers a mock model dropdown; other employees do not', async () => {
  const { EmployeePanel } = await import('./GamePanel');
  const { CEO_MODEL_OPTIONS } = await import('./hudModel');
  const base = { id: 'x', name: 'Ada', role: 'Engineer', color: '#fff', action: 'Working', says: '', thinks: '', stress: 10, burnout: 10, workload: 40, trust: 60, quit: false, present: true } as import('./people').Person;
  const anchor = null as unknown as HTMLElement;
  const ceo = renderToStaticMarkup(createElement(EmployeePanel, { person: { ...base, id: 'ceo', name: 'Pat', role: 'CEO' }, threshold: 80, anchor, onClose: () => {} }));
  assert.match(ceo, /id="ceo-model"/);
  for (const o of CEO_MODEL_OPTIONS) assert.match(ceo, new RegExp(`value="${o.id}"`));
  const staff = renderToStaticMarkup(createElement(EmployeePanel, { person: base, threshold: 80, anchor, onClose: () => {} }));
  assert.doesNotMatch(staff, /ceo-model/);
});
