// Diagnostics must not change behaviour: the same seed gives identical worlds, records and logs
// with the inbox on or off, in rules mode and with a (stub) LLM, including business injections.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PARAMS } from '../params';
import { emptyInbox, foldInbox } from '../diagnostics/inbox';
import type { QueuedEvent } from '../engine-types';
import { buildScenario, fixtureCast } from '../scripts/fixture';
import { createStubProvider } from '../stub-provider';
import { createWorld, runTick } from '../tick';

const TICKS = 80;
const INJECT: Record<number, string> = { 10: 'supplier_interruption', 24: 'cost_review', 40: 'client_win' };

async function run(seed: number, mode: 'rules' | 'llm_bias', diagnostics: boolean) {
  const cast = fixtureCast(seed);
  const scenario = buildScenario(seed, TICKS, cast.map(c => c.profile.id));
  const provider = mode === 'rules' ? null : createStubProvider(seed);
  let world = createWorld(cast, seed);
  let inbox = emptyInbox();
  const frames: string[] = []; const codes = new Set<string>();
  for (let i = 0; i < TICKS; i++) {
    if (INJECT[i]) world = { ...world, queue: [...world.queue, { type: 'new_management', templateId: INJECT[i], isTrue: true } as QueuedEvent] };
    const r = await runTick(world, provider, { mode, scenario, gossip: true, billboard: true, business: true, diagnostics });
    world = r.world;
    for (const e of r.taskEvents ?? []) codes.add(e.code);
    // Folding the inbox runs on the committed world and must not touch it: the next tick starts from it.
    if (diagnostics) {
      const before = JSON.stringify(r.world);
      inbox = foldInbox(inbox, r.taskEvents ?? [], r.world, DEFAULT_PARAMS).state;
      assert.equal(JSON.stringify(r.world), before, `fold changed the world at tick ${i + 1}`);
    }
    frames.push(JSON.stringify([r.world, r.records, r.log]));
  }
  return { frames, codes, threads: Object.keys(inbox.threads).length };
}

describe('diagnostics determinism', () => {
  for (const mode of ['rules', 'llm_bias'] as const) {
    it(`identical results with the inbox on or off (${mode})`, async () => {
      const off = await run(11, mode, false);
      const on = await run(11, mode, true);
      assert.equal(off.codes.size, 0, 'no events are collected with diagnostics off');
      assert.ok(on.codes.size >= 5, `diagnostics actually ran: ${[...on.codes].join(', ')}`);
      assert.ok(on.threads > 0);
      assert.equal(on.frames.length, off.frames.length);
      for (let i = 0; i < on.frames.length; i++) assert.equal(on.frames[i], off.frames[i], `tick ${i + 1} differs`);
    });
  }
});
