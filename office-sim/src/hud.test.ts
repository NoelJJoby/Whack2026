import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workdayTime } from './Workday';
import { stockSeries } from './StockPrice';
import { mockHistory } from './mocks';

test('workday shows lunch, home time, overtime and midnight before rolling to a new day', () => {
  assert.deepEqual(workdayTime(0), { day: 1, hour: 8, progress: 0 });
  assert.equal(workdayTime(4).hour, 12);
  assert.equal(workdayTime(9).hour, 17);
  assert.equal(workdayTime(13).hour, 21);
  assert.deepEqual(workdayTime(16), { day: 1, hour: 24, progress: 100 });
  assert.deepEqual(workdayTime(17), { day: 2, hour: 9, progress: 6.25 });
});
test('stock indicator starts at 100 and derives reproducibly from history without mutating it', () => {
  assert.deepEqual(stockSeries([]), [{ tick: 0, price: 100 }]);
  const before = JSON.stringify(mockHistory);
  const points = stockSeries(mockHistory);
  assert.equal(points.length, mockHistory.length + 1);
  assert.ok(points.every(p => Number.isFinite(p.price) && p.price >= 1));
  assert.deepEqual(stockSeries(mockHistory), points);
  assert.equal(JSON.stringify(mockHistory), before);
});
