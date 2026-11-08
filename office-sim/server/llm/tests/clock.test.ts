import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { voiceParams } from '../../params';
import { workdayTime } from '../../../shared/workday';
import { clockAt, heardWhen } from '../clock';

const c = voiceParams.clock;

describe('clock', () => {
  it('reads the shared workday: eight ticks a day, 09:00 to 23:00', () => {
    for (const [tick, day, hour] of [[0, 1, 8], [1, 1, 9], [3, 1, 13], [5, 1, 17], [6, 1, 19], [8, 1, 23], [9, 2, 9], [16, 2, 23]]) {
      assert.deepEqual(clockAt(tick), { day, hour }, `tick ${tick}`);
      assert.equal(clockAt(tick).hour, workdayTime(tick).hour);
    }
  });

  it('says when something was heard', () => {
    assert.equal(heardWhen(5, 5, c), 'just now');
    assert.equal(heardWhen(5, 4, c), 'a couple of hours ago');
    assert.equal(heardWhen(4, 1, c), 'this morning');
    assert.equal(heardWhen(2, 1, c), 'a couple of hours ago');
    assert.equal(heardWhen(5, 3, c), 'this afternoon');
    assert.equal(heardWhen(9, 4, c), 'yesterday afternoon');
    assert.equal(heardWhen(20, 2, c), 'two days ago');
    assert.equal(heardWhen(9, 7, c), 'yesterday evening');
    for (let now = 1; now < 60; now++) {
      for (let then = 1; then <= now; then++) assert.doesNotMatch(heardWhen(now, then, c), /\d|tick/);
    }
  });
});
