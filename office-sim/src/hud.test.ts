import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { workdayTime } from './Workday';
import { StockPrice, stockSeries } from './StockPrice';
import { mockHistory } from './mocks';

test('workday shows lunch, home time, overtime and midnight before rolling to a new day', () => {
  assert.deepEqual(workdayTime(0), { day: 1, hour: 8, progress: 0 });
  assert.equal(workdayTime(4).hour, 12);
  assert.equal(workdayTime(9).hour, 17);
  assert.equal(workdayTime(13).hour, 21);
  assert.deepEqual(workdayTime(16), { day: 1, hour: 24, progress: 100 });
  assert.deepEqual(workdayTime(17), { day: 2, hour: 9, progress: 6.25 });
});
test('stock indicator starts at 100 and projects backend prices without mutating history', () => {
  assert.deepEqual(stockSeries([]), [{ tick: 0, price: 100 }]);
  const before = JSON.stringify(mockHistory);
  const points = stockSeries(mockHistory);
  assert.equal(points.length, mockHistory.length + 1);
  assert.ok(points.every(p => Number.isFinite(p.price) && p.price >= 1));
  assert.deepEqual(stockSeries(mockHistory), points);
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
