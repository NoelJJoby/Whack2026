import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { voiceParams } from '../../params';
import { clockAt, clockPhrase, heardWhen } from '../clock';

const c = voiceParams.clock;

describe('clock', () => {
  it('matches src/Workday.tsx: tick 1 is Day 1 09:00, 16 ticks a day', () => {
    // Same table as workdayTime(tick) in src/Workday.tsx.
    for (const [tick, day, hour] of [[0, 1, 8], [1, 1, 9], [4, 1, 12], [16, 1, 24], [17, 2, 9], [33, 3, 9]]) {
      assert.deepEqual(clockAt(tick, c), { day, hour }, `tick ${tick}`);
    }
  });

  it('phrases the time without tick numbers', () => {
    assert.equal(clockPhrase(1, c), 'Day 1, 09:00');
    assert.equal(clockPhrase(16, c), 'Day 1, midnight');
    assert.equal(clockPhrase(18, c), 'Day 2, 10:00');
  });

  it('says when something was heard', () => {
    assert.equal(heardWhen(5, 5, c), 'just now');
    assert.equal(heardWhen(5, 4, c), 'an hour ago');
    assert.equal(heardWhen(3, 1, c), 'earlier this morning');
    assert.equal(heardWhen(8, 2, c), 'this morning');
    assert.equal(heardWhen(18, 6, c), 'yesterday afternoon');
    assert.equal(heardWhen(40, 2, c), 'two days ago');
    for (let now = 1; now < 60; now++) {
      for (let then = 1; then <= now; then++) assert.doesNotMatch(heardWhen(now, then, c), /\d|tick/);
    }
  });
});
