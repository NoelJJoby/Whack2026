import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockHistory } from './mocks';
import { finishPresentation, initialPresentation, presentedPresence, reconcilePresentation } from './presentation';
import type { TickFrame } from '../shared/api';

const frame = (tick: number): TickFrame => ({ ...mockHistory[0], tick, records: [], events: [], state: { ...mockHistory[0].state, tick } });

test('buffers every computed hour until the current round finishes; one completion advances one hour', () => {
  const f0 = frame(0), f1 = frame(1), f2 = frame(2), f3 = frame(3);
  let p = reconcilePresentation(initialPresentation, [], 1, f0.state);
  p = reconcilePresentation(p, [f1], 1, f1.state);
  assert.equal(p.tick, 1); assert.ok(p.active);
  assert.equal(reconcilePresentation(p, [f1, f2, f3], 1, f3.state), p);
  assert.equal(finishPresentation(p, 2), p, 'a stale/future completion cannot release the hour');
  p = reconcilePresentation(finishPresentation(p, 1), [f1, f2, f3], 1, f3.state);
  assert.equal(p.tick, 2); assert.ok(p.active);
  p = reconcilePresentation(finishPresentation(p, 2), [f1, f2, f3], 1, f3.state);
  assert.equal(p.tick, 3);
});

test('reconnect skips historical playback and reset discards queued hours', () => {
  let p = reconcilePresentation(initialPresentation, [frame(1), frame(2)], 1, frame(2).state);
  assert.equal(p.tick, 2); assert.equal(p.active, false);
  p = reconcilePresentation(p, [frame(1), frame(2), frame(3)], 1, frame(3).state);
  assert.equal(p.tick, 3); assert.equal(p.active, true);
  p = reconcilePresentation(p, [], 2, frame(0).state);
  assert.equal(p.tick, 0); assert.equal(p.active, false);
});

test('17:00 leavers remain visible through the round; late workers leave before the report and return at 09:00', () => {
  const [id] = Object.keys(mockHistory[0].state.agents);
  const prev = frame(4), close = frame(5), end = frame(8), morning = frame(9);
  for (const f of [prev, close, end, morning]) f.state = structuredClone(f.state);
  for (const f of [prev, close, end, morning]) { f.state.agents[id].status = 'active'; f.state.agents[id].present = false; }
  prev.state.agents[id].present = true;
  assert.equal(presentedPresence(close, prev, id, false), true);
  assert.equal(presentedPresence(close, prev, id, true), false);
  assert.equal(presentedPresence(end, undefined, id, true), false);
  assert.equal(presentedPresence(morning, end, id, false), true);
  morning.state.agents[id].status = 'quit';
  assert.equal(presentedPresence(morning, end, id, false), false);
});
