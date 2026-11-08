import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FAST_FORWARD_SPEED, FAST_QUARTER_MS, FAST_TICK_MS } from '../../shared/playback';
import { TICKS_PER_QUARTER } from '../../shared/workday';

process.env.ANTHROPIC_API_KEY = '';
const { OfficeSimManager } = await import('../index');
const waitFor = async (predicate: () => boolean) => {
  const deadline = performance.now() + 5000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, 'Timed out waiting for simulation');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

test('fast-forward advances without a viewer, honours pause, and restores the normal presentation gate', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fast-forward-'));
  let calls = 0;
  const manager = new OfficeSimManager(dir, { provider: async () => { calls++; return null; } });
  try {
    manager.setSpeed({ speed: FAST_FORWARD_SPEED });
    assert.equal(manager.response().mode, 'rules');
    assert.equal(manager.response().mode_reason, 'fast_forward');
    manager.play();
    await waitFor(() => manager.response().state.tick >= 3);
    manager.pause();
    const tick = manager.response().state.tick;
    await new Promise(resolve => setTimeout(resolve, FAST_TICK_MS + 50));
    assert.equal(manager.response().state.tick, tick);
    assert.equal(calls, 0);
    manager.setSpeed({ speed: 4 });
    assert.equal(manager.response().mode, 'llm_bias');
    assert.equal(manager.response().mode_reason, 'configured');
    manager.play();
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(manager.response().state.tick, tick, 'Ordinary speed waits for the viewer');
    manager.pause();
    manager.setSpeed({ speed: FAST_FORWARD_SPEED });
    manager.play();
    await waitFor(() => manager.response().state.tick > tick);
    manager.pause();
    const recovered = new OfficeSimManager(dir);
    assert.equal(recovered.response().state.tick, manager.response().state.tick);
    assert.equal(recovered.response().speed, FAST_FORWARD_SPEED);
    assert.equal(recovered.response().state.running, false);
  } finally { manager.pause(); rmSync(dir, { recursive: true, force: true }); }
});

test('fast-forward preserves the rules simulation and produces a factual report without AI', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fast-forward-results-'));
  let calls = 0;
  const fast = new OfficeSimManager(join(dir, 'fast'), {
    provider: async () => { calls++; return null; },
    reportProvider: async () => { calls++; return null; },
  });
  const regular = new OfficeSimManager(join(dir, 'regular'), { reportProvider: async () => null });
  try {
    fast.reseed(42); regular.reseed(42);
    fast.setSpeed({ speed: FAST_FORWARD_SPEED });
    fast.settings({ max_ticks: 16 }); regular.settings({ max_ticks: 16 });
    for (let i = 0; i < 16; i++) { await fast.step(); await regular.step(); }
    await waitFor(() => !fast.reporting.pending(fast.response().run_id!) && !regular.reporting.pending(regular.response().run_id!));
    await new Promise(resolve => setImmediate(resolve)); // Flush the report's final state notification before cleanup.
    const a = fast.store.recover(fast.response().run_id!), b = regular.store.recover(regular.response().run_id!);
    assert.deepEqual(a, b, 'Fast-forward must compute the same seeded world');
    assert.equal(calls, 0);
    assert.equal(fast.response().report_status, 'factual_fallback');
    assert.equal(fast.store.read(fast.response().run_id!).filter(tx => tx.kind === 'tick').length, 16);
    assert.equal(FAST_TICK_MS * TICKS_PER_QUARTER, FAST_QUARTER_MS);
    assert.ok(FAST_QUARTER_MS < 120_000);
  } finally { fast.pause(); regular.pause(); rmSync(dir, { recursive: true, force: true }); }
});
