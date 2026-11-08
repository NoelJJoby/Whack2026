import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FAST_FORWARD_SPEED } from '../../shared/playback';
import { TICKS_PER_QUARTER } from '../../shared/workday';

// Isolate both the imported API singleton and the measured run from real run history.
const directory = mkdtempSync(join(tmpdir(), 'quarter-benchmark-'));
process.env.SIM_STORE_DIR = join(directory, 'singleton');
// Benchmark simulation and factual reporting independently of the optional AI recap.
process.env.ANTHROPIC_API_KEY = '';
const { OfficeSimManager } = await import('../index');
let calls = 0;
const manager = new OfficeSimManager(join(directory, 'run'), {
  provider: async () => { calls++; throw new Error('Fast-forward must not call AI'); },
  reportProvider: async () => { calls++; return null; },
});
const unpaced = process.argv.includes('--unpaced');
try {
  manager.reseed(42);
  manager.setSpeed({ speed: FAST_FORWARD_SPEED });
  let streamed = 0, bytes = 0;
  manager.subscribe(message => {
    bytes += Buffer.byteLength(JSON.stringify(message)); // Include SSE serialization work.
    if (message.type === 'tick') streamed++;
  });
  const started = performance.now();
  if (unpaced) {
    for (let i = 0; i < TICKS_PER_QUARTER; i++) await manager.step();
  } else {
    manager.play(); // Deliberately send no viewer acknowledgements.
  }
  while (manager.response().state.tick < TICKS_PER_QUARTER || manager.response().report_status === 'pending') {
    assert.ok(performance.now() - started < 120_000, 'Quarter exceeded the two-minute budget');
    assert.equal(manager.response().storage_error, null);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const elapsedMs = Math.round(performance.now() - started);
  await new Promise(resolve => setImmediate(resolve));
  const response = manager.response();
  assert.equal(response.report_status, 'factual_fallback');
  assert.equal(streamed, TICKS_PER_QUARTER);
  assert.equal(manager.history().history.length, TICKS_PER_QUARTER);
  const journal = manager.store.read(response.run_id!);
  assert.equal(journal.filter(tx => tx.kind === 'tick').length, TICKS_PER_QUARTER);
  assert.equal(journal.at(-1)!.kind, 'complete');
  assert.equal(calls, 0);
  assert.ok(elapsedMs < 120_000);
  console.log(JSON.stringify({ mode: unpaced ? 'unpaced' : 'paced', ticks: streamed, elapsedMs, aiCalls: calls, streamedBytes: bytes, report: response.report_status }, null, 2));
} finally {
  manager.pause();
  rmSync(directory, { recursive: true, force: true });
}
