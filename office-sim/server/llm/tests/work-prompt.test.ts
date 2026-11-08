import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureCast } from '../../scripts/fixture';
import { buildContext, createWorld } from '../../tick';
import { workContext, validEmployeeOutput } from '../../tasks';
import { DEFAULT_PARAMS } from '../../params';
import { buildTurnPrompt, restoreIds } from '../prompt';
import { createTurnProvider } from '../../llm';

test('business prompt keys survive the real provider and employee validation', async () => {
  const w = createWorld(fixtureCast(42), 42); w.tick = 3;
  const a = w.agents.loyalist, colleague = w.agents.skeptic;
  const task = w.business.tasks.find(t => t.department === 'Engineering')!;
  task.owner = a.id; task.status = 'active'; task.version = 7;
  const ctx = buildContext(w, a, { mode: 'llm_bias', gossip: true }, [], DEFAULT_PARAMS);
  ctx.work = workContext(w, a);
  ctx.available = ['work', 'report_issue'];
  ctx.work.evidence = [{ id: 'evidence-private-3', eventId: 'event-3', tick: 2, deliveryTick: 2, source: colleague.id, recipients: [a.id], text: 'A client needs a revised delivery plan.', certainty: 'rumour' }];
  const prompt = buildTurnPrompt(a.profile, ctx);
  assert.match(prompt, /key: t1/); assert.match(prompt, /key: e1/); assert.match(prompt, /unconfirmed/);
  assert.doesNotMatch(prompt, /\btick|event-3|evidence-private|task-|assignment_version|"supervisor"/i);
  assert.ok(!prompt.includes(`"${colleague.id}"`));
  const raw = { proposals: [{ action: 'work', weight: 1, task_id: 't1' }], public_line: 'The client deadline needs a clearer plan.', inner_monologue: 'I need time to review this.', beliefs: {} };
  const expected = { ...raw, proposals: [{ action: 'work', weight: 1, task_id: task.id, assignment_version: 7 }] };
  assert.deepEqual(validEmployeeOutput(restoreIds(raw, ctx), ctx), expected);
  const report = restoreIds({ ...raw, proposals: [{ action: 'report_issue', weight: 1, evidence_id: 'e1', target: w.agents.ops.profile.name }] }, ctx) as typeof raw;
  assert.doesNotThrow(() => validEmployeeOutput(report, ctx));
  assert.throws(() => validEmployeeOutput(restoreIds({ ...raw, proposals: [{ action: 'work', weight: 1, task_id: 't99' }] }, ctx), ctx));
  const key = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-only';
  try {
    const provider = createTurnProvider({ fetch: async () => Response.json({ id: 'm', type: 'message', role: 'assistant', model: 'fake', content: [{ type: 'text', text: JSON.stringify(raw) }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }) });
    assert.deepEqual(validEmployeeOutput(await provider(a.profile, ctx), ctx), expected);
  } finally { if (key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = key; }
});
