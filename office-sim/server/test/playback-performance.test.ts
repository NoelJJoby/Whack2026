import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../tick';
import { fixtureCast } from '../scripts/fixture';
import { createStubProvider } from '../stub-provider';
import { managementPhase } from '../management';
import type { TurnProvider } from '../engine-types';

it('does not repeat Ops calls for unchanged backlog, but replans for review and lost capacity',async () => {
  const w = createWorld(fixtureCast(42),42); w.tick = 1;
  let calls = 0;
  const provider: TurnProvider = async (agent,ctx) => {
    if (ctx.management?.kind === 'ops') calls++;
    return createStubProvider(42)(agent,ctx);
  };
  await managementPhase(w,provider,'llm_bias'); assert.equal(calls,1);
  w.tick++;
  for (const task of w.business.tasks) task.remaining = Math.max(0,task.remaining-0.25);
  await managementPhase(w,provider,'llm_bias'); assert.equal(calls,1);
  const task = w.business.tasks.find(t => t.status === 'active' && t.department === 'Engineering')!;
  task.status = 'review'; task.allocated = 0;
  await managementPhase(w,provider,'llm_bias'); assert.equal(calls,2);
  w.agents.breadwinner.status = 'quit';
  await managementPhase(w,provider,'llm_bias'); assert.equal(calls,3);
});
