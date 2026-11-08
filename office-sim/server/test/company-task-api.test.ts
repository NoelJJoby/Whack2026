import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { StreamMessage } from '../../shared/api';
import type { CompanyTaskSummary } from '../../shared/companyTasks';
import type { TurnProvider } from '../engine-types';
import { createStubProvider } from '../stub-provider';

process.env.ANTHROPIC_API_KEY = '';
const { app, OfficeSimManager } = await import('../index');
const temp = () => mkdtempSync(join(tmpdir(), 'company-task-api-'));
const objective = 'Review supplier handover and plan a better support process.';
const input = (run_id: string, idempotency_key = 'request-1') => ({ run_id, idempotency_key, objective, deadline_ticks: 32 });

function gatedProvider(shouldHold: (ctx: Parameters<TurnProvider>[1]) => boolean) {
  let release!: () => void;
  let entered!: () => void;
  const reached = new Promise<void>(r => { entered = r; });
  const held = new Promise<void>(r => { release = r; });
  const fixed = createStubProvider(42);
  let used = false;
  const provider: TurnProvider = async (agent, ctx) => {
    if (!used && shouldHold(ctx)) {
      used = true;
      entered();
      await held;
    }
    return fixed(agent, ctx);
  };
  return { provider, reached, release };
}

describe('company task submission and journal', () => {
  it('validates HTTP submissions and provides idempotent run-scoped reads', async () => {
    const route = '/api/sim/company-tasks';
    const state = (await app.inject('/api/sim/state')).json();
    const post = (payload: unknown) => app.inject({ method: 'POST', url: route, payload: payload as object });
    assert.equal((await app.inject(route)).json().tasks.length, 0);
    assert.equal((await post({ ...input(state.run_id), objective: '  ' })).statusCode, 400);
    assert.equal((await post({ ...input(state.run_id), deadline_ticks: 0 })).statusCode, 400);
    assert.equal((await post(input('stale'))).json().error.code, 'run_changed');
    const payload = input(state.run_id);
    const created = await post(payload);
    assert.equal(created.statusCode, 202);
    const task = created.json<CompanyTaskSummary>();
    assert.equal(task.status, 'queued');
    const retry = await post(payload);
    assert.equal(retry.statusCode, 200);
    assert.deepEqual(retry.json(), task);
    assert.equal((await post({ ...payload, deadline_ticks: 12 })).json().error.code, 'idempotency_conflict');
    assert.equal((await post(input(state.run_id, 'different'))).json().error.code, 'company_task_active');
    const detail = (await app.inject(`${route}/${task.id}`)).json();
    assert.equal(detail.objective, objective);
    assert.equal(detail.brief, undefined);
    assert.equal(detail.idempotencyKey, undefined);
    assert.deepEqual((await app.inject(route)).json().tasks, [task]);
    await app.inject({ method: 'POST', url: '/api/sim/reset' });
    assert.equal((await app.inject(`${route}/${task.id}`)).statusCode, 404);
    const archived = (await app.inject(`/api/runs/${state.run_id}`)).json();
    assert.equal(archived.world.companyTasks[0].id, task.id);
  });

  it('journals a submission during inference and applies it once at the next boundary', async () => {
    const gate = gatedProvider(ctx => Boolean(ctx.work));
    const m = new OfficeSimManager(temp(), { provider: gate.provider });
    const run = m.response().run_id!;
    const pending = m.step();
    await gate.reached;
    const { task } = m.submitCompanyTask(input(run));
    assert.equal(m.store.read(run).at(-1)?.kind, 'input');
    assert.equal(m.store.recover(run).companyTasks?.[0].status, 'queued');
    gate.release();
    await pending;
    assert.equal(m.companyTask(task.id).status, 'queued');
    assert.equal(m.history().history[0].company_activity, undefined);
    await m.step();
    const detail = m.companyTask(task.id);
    assert.equal(detail.activatedTick, 2);
    assert.ok(detail.activity.some(a => a.kind === 'brief'));
    assert.equal(m.submitCompanyTask(input(run)).created, false);
    assert.equal(m.store.read(run).filter(t => t.kind === 'input').length, 1);
  });

  it('discards a CEO inference on reset and keeps the old queued record in its archived run', async () => {
    const gate = gatedProvider(ctx => ctx.companyTurn?.kind === 'brief');
    const m = new OfficeSimManager(temp(), { provider: gate.provider });
    const oldRun = m.response().run_id!;
    m.submitCompanyTask(input(oldRun));
    const pending = m.step();
    await gate.reached;
    m.reset();
    gate.release();
    await pending;
    assert.notEqual(m.response().run_id, oldRun);
    assert.equal(m.response().revision, 0);
    assert.deepEqual(m.listCompanyTasks().tasks, []);
    assert.equal(m.store.metadata(oldRun).status, 'partial');
    const saved = m.store.recover(oldRun).companyTasks![0];
    assert.equal(saved.status, 'queued');
    assert.deepEqual(saved.activity, []);
  });

  it('recovers queued inputs, then restores committed activity on its original reconnect frames', async () => {
    const directory = temp();
    const m = new OfficeSimManager(directory);
    await m.step();
    const run = m.response().run_id!;
    const { task } = m.submitCompanyTask(input(run));
    const resumed = new OfficeSimManager(directory);
    assert.equal(resumed.response().state.running, false);
    assert.equal(resumed.companyTask(task.id).status, 'queued');
    const emitted: StreamMessage[] = [];
    resumed.subscribe(event => emitted.push(event));
    await resumed.step();
    await resumed.step();
    const live = emitted.filter(event => event.type === 'tick');
    assert.ok(live[0].frame.company_activity?.length);
    assert.ok(live.every(event => event.frame.company_activity?.every(a => a.tick === event.frame.tick) ?? true));
    const reopened = new OfficeSimManager(directory);
    assert.equal(reopened.response().state.running, false);
    assert.deepEqual(reopened.history().history.map(frame => frame.tick), [1, 2, 3]);
    assert.deepEqual(reopened.history().history.slice(1).map(frame => frame.company_activity), live.map(event => event.frame.company_activity));
    assert.deepEqual(reopened.companyTask(task.id).activity, resumed.companyTask(task.id).activity);
    assert.equal(reopened.submitCompanyTask(input(run)).created, false);
    await reopened.step();
    assert.deepEqual(reopened.history().history.map(frame => frame.tick), [1, 2, 3, 4]);
  });

  it('keeps the last committed objective if the tick transaction fails', async () => {
    const m = new OfficeSimManager(temp());
    const run = m.response().run_id!;
    const { task } = m.submitCompanyTask(input(run));
    const commit = m.store.commit.bind(m.store);
    m.store.commit = () => { throw new Error('disk unavailable'); };
    const emitted: StreamMessage[] = [];
    m.subscribe(event => emitted.push(event));
    await assert.rejects(m.step(), /disk unavailable/);
    assert.equal(m.companyTask(task.id).status, 'queued');
    assert.ok(!emitted.some(event => event.type === 'tick'));
    m.store.commit = commit;
    await m.step();
    assert.equal(m.companyTask(task.id).activity.filter(a => a.kind === 'brief').length, 1);
  });

  it('closes unfinished work when the run ends and preserves duplicate submission responses', async () => {
    const m = new OfficeSimManager(temp());
    const run = m.response().run_id!;
    m.settings({ max_ticks: 1 });
    const { task } = m.submitCompanyTask(input(run));
    await m.step();
    assert.equal(m.companyTask(task.id).outcome?.state, 'abandoned');
    assert.ok(m.companyTask(task.id).canonicalWork.every(work => work.status === 'cancelled' || work.status === 'done'));
    assert.equal(m.submitCompanyTask(input(run)).task.status, 'abandoned');
    await m.reporting.generate(run);
  });
});
