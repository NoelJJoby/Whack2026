import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TickFrame } from '../shared/api';
import type { CompanyActivity } from '../shared/companyTasks';
import { COMPANY_LINE_CAP, companyLines } from './dialogueQueue';
import { shortenQuoted, workRows } from './companyModel';

test('quoted work titles drop the repeated objective', () => {
  assert.equal(shortenQuoted('Please take “Research needs · Plan a launch”.'), 'Please take “Research needs”.');
});

test('work waits until its assignee knows the required finding', () => {
  const meta = (id: string, inputs: string[] = []) => ({ taskId: id, category: 'research' as const, acceptance: '', requiredInputs: inputs, producesFinding: true, consumedFindings: {}, rework: 0 });
  const t = { title: 'b', owner: 'ben', status: 'active', remaining: 2, effort: 2 } as never;
  const rows = workRows({ work: { b: meta('b', ['a']) }, findings: [] }, [{ ...(t as object), id: 'b' } as never]);
  assert.equal(rows[0].state, 'waiting');
});

test('objective exchanges are spoken by the employee; brief always, others capped', () => {
  const act = (order: number, kind: CompanyActivity['kind']) => ({ id: `a${order}`, companyTaskId: 'c', tick: 1, round: 0, order, actor: 'nia', recipients: [], kind, location: 'office', dialogue: 'Hi.' }) as CompanyActivity;
  const frame = { tick: 1, state: { agents: {} }, company_activity: [act(0, 'brief'), act(1, 'progress'), ...[2, 3, 4, 5, 6].map(o => act(o, 'message'))] } as unknown as TickFrame;
  const lines = companyLines(frame);
  assert.equal(lines.length, 1 + COMPANY_LINE_CAP);
  assert.ok(lines.every(l => l.kind === 'agent' && l.agent === 'nia'));
});
