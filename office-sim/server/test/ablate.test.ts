import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MODES } from '../engine-types';
import { band, runAblation } from '../scripts/ablate';

describe('ablation runner', () => {
  it('runs every mode over N seeds and produces all summaries', async () => {
    const r = await runAblation({ seeds: 2, ticks: 6, calm: false });
    for (const mode of MODES) assert.equal(r.runs[mode].length, 2);
    assert.deepEqual(Object.keys(r.files).sort(), ['action_mix.csv', 'crack_order.csv', 'runs.csv', 'summary.json']);
    assert.equal(r.files['runs.csv'].trim().split('\n').length, 1 + 2 * MODES.length);
    const summary = JSON.parse(r.files['summary.json']);
    assert.deepEqual(Object.keys(summary.modes), [...MODES]);
    assert.equal(summary.checks.length, 5);
  });

  it('is deterministic', async () => {
    const a = await runAblation({ seeds: 2, ticks: 4, calm: false });
    const b = await runAblation({ seeds: 2, ticks: 4, calm: false });
    assert.deepEqual(a.files, b.files);
  });

  it('stress bands match the brief templates', () => {
    assert.deepEqual([band(0), band(39), band(40), band(69), band(70), band(100)], ['0-39', '0-39', '40-69', '40-69', '70-100', '70-100']);
  });
});
