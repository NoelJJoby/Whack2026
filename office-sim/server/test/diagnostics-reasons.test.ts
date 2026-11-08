// One minimal scenario per inbox reason code: set up the smallest world state that triggers it,
// run the real engine decision point, and check the code, stage and key details it records.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Task } from '../../shared/business';
import type { CompanyTask } from '../../shared/companyTasks';
import type { TaskEvent } from '../../shared/inbox';
import { makeTask, openBusinessTick } from '../business';
import { beginDiagnostics, takeDiagnostics } from '../diagnostics/collector';
import { scanTasks } from '../diagnostics/details';
import type { Action, Decision, TurnProvider, World } from '../engine-types';
import { openEvent, updateLifecycle } from '../events/lifecycle';
import { fallbackCeo, managementPhase } from '../management';
import { DEFAULT_PARAMS } from '../params';
import { fixtureCast } from '../scripts/fixture';
import { executeWork } from '../tasks';
import { createWorld } from '../tick';

// Fixture cast: Tom, Sam, Chris are Engineering; Jules, Wren Sales; Tessa Operations; ceo/ops manage.
const TOM = 'loyalist', SAM = 'skeptic', CHRIS = 'flight', JULES = 'gossip';

function world(): World {
  const w = createWorld(fixtureCast(7), 7);
  w.tick = 2;
  return w;
}
function collect(w: World, run: () => void | Promise<void>): Promise<TaskEvent[]> | TaskEvent[] {
  beginDiagnostics(w, DEFAULT_PARAMS);
  const result = run();
  return result instanceof Promise ? result.then(() => takeDiagnostics(w)) : takeDiagnostics(w);
}
function task(w: World, id: string): Task { return w.business.tasks.find(t => t.id === id)!; }
function assign(t: Task, owner: string, status: Task['status'] = 'active') { t.owner = owner; t.status = status; t.allocated = 1; }
function decision(w: World, agentId: string, action: Action, t?: Task, version = t?.version): Decision {
  const s = w.agents[agentId].state;
  return { action, target: null, claim: null, task_id: t?.id, assignment_version: version, probs: { [action]: 0.25 }, public_line: '', inner_monologue: '',
    log: { state: { stress: s.stress, burnout: s.burnout, loyalty: s.loyalty, trust_mgmt: s.trust_mgmt }, fresh: false, explain: 'test explain' } } as unknown as Decision;
}
const find = (events: TaskEvent[], code: TaskEvent['code'], taskId?: string) => {
  const e = events.find(e => e.code === code && (!taskId || e.taskId === taskId));
  assert.ok(e, `expected ${code}; got ${events.map(e => e.code).join(', ')}`);
  return e!;
};
/** An ops "LLM" that returns a fixed plan, and the CEO's rules plan. */
const opsProvider = (assignments: Array<{ taskId: string; employeeId: string | null; state: 'active' | 'paused'; allocation: number }>): TurnProvider =>
  async (_profile, ctx) => ctx.management?.kind === 'ceo' ? fallbackCeo(ctx.management)
    : { schemaVersion: 1, kind: 'ops', revision: ctx.management!.revision, assignments, infeasible: [], rationale: 'test plan' };

describe('assignment stage', () => {
  it('UNASSIGNED: an open task with no owner, from the end-of-tick scan', () => {
    const w = world();
    const e = find(collect(w, () => scanTasks(w)) as TaskEvent[], 'UNASSIGNED', 'service-0');
    assert.equal(e.stage, 'assignment');
    assert.equal(e.severity, 'warning');
    assert.equal(e.details.department, 'Engineering');
  });

  it('UNASSIGNED with the reason ops gave: everyone capable is fully booked', async () => {
    const w = world();
    const events = await collect(w, () => managementPhase(w, null, 'rules'));
    // Four Engineering tasks, three engineers: one is left over.
    const left = events.filter(e => e.code === 'UNASSIGNED' && task(w, e.taskId).department === 'Engineering');
    assert.equal(left.length, 1);
    assert.equal(left[0].details.reason, 'booked');
    assert.match(String(left[0].details.staff), /loyalist:1\/1/);
  });

  it('ON_HOLD: ops paused a task that has an owner', async () => {
    const w = world();
    const release = task(w, 'initial-release');
    assign(release, TOM, 'paused'); release.allocated = 0; release.priority = 9;
    const e = find(await collect(w, () => managementPhase(w, null, 'rules')), 'ON_HOLD', 'initial-release');
    assert.equal(e.stage, 'assignment');
    assert.equal(e.details.reason, 'booked');
    assert.equal(e.agentId, TOM);
  });

  it('REJECTED_NO_CAPABILITY: ops gives Engineering work to a salesperson', async () => {
    const w = world();
    const e = find(await collect(w, () => managementPhase(w, opsProvider([{ taskId: 'service-0', employeeId: JULES, state: 'active', allocation: 1 }]), 'llm_bias')), 'REJECTED_NO_CAPABILITY');
    assert.equal(e.stage, 'assignment');
    assert.equal(e.details.employee, JULES);
    assert.equal(e.details.employeeDepartment, 'Sales');
    assert.equal(e.details.department, 'Engineering');
  });

  it('REJECTED_OVER_CAPACITY: ops books one engineer twice', async () => {
    const w = world();
    const e = find(await collect(w, () => managementPhase(w, opsProvider([
      { taskId: 'service-0', employeeId: TOM, state: 'active', allocation: 1 },
      { taskId: 'service-1', employeeId: TOM, state: 'active', allocation: 1 },
    ]), 'llm_bias')), 'REJECTED_OVER_CAPACITY');
    assert.equal(e.details.employee, TOM);
    assert.equal(e.details.booked, 2);
    assert.equal(e.details.capacity, 1);
  });

  it('REJECTED_SELF_REVIEW: ops asks the author to review their own work', async () => {
    const w = world();
    const t = task(w, 'service-0'); t.owner = TOM; t.status = 'review'; t.allocated = 0; t.remaining = 0;
    const e = find(await collect(w, () => managementPhase(w, opsProvider([{ taskId: 'service-0', employeeId: TOM, state: 'active', allocation: 1 }]), 'llm_bias')), 'REJECTED_SELF_REVIEW');
    assert.equal(e.details.employee, TOM);
    assert.equal(e.details.owner, TOM);
  });

  it('REJECTED_DEPS_NOT_DONE: assigned before its dependency is done', async () => {
    const w = world();
    task(w, 'service-0').dependencies = ['initial-release'];
    const e = find(await collect(w, () => managementPhase(w, opsProvider([{ taskId: 'service-0', employeeId: TOM, state: 'active', allocation: 1 }]), 'llm_bias')), 'REJECTED_DEPS_NOT_DONE');
    assert.equal(e.details.dependencyId, 'initial-release');
    assert.equal(e.details.dependencyStatus, 'pending');
  });
});

describe('choice stage', () => {
  it('CHOSE_OTHER_ACTION: the owner had work and gossiped, with the drivers for gossip', () => {
    const w = world();
    const t = task(w, 'service-0'); assign(t, TOM);
    w.agents[TOM].state.stress = 90;
    const e = find(collect(w, () => { executeWork(w, w.agents[TOM], decision(w, TOM, 'gossip')); }) as TaskEvent[], 'CHOSE_OTHER_ACTION', 'service-0');
    assert.equal(e.stage, 'choice');
    assert.equal(e.agentId, TOM);
    assert.equal(e.details.action, 'gossip');
    assert.equal(e.details.probability, 25);
    assert.match(String(e.details.drivers), /stress/);
    assert.equal(e.details.explain, 'test explain');
  });

  it('CHOSE_OTHER_ACTION becomes a warning at 3 of the last 4 idle turns', () => {
    const w = world();
    assign(task(w, 'service-0'), TOM);
    let last: TaskEvent | undefined;
    for (let i = 0; i < 3; i++) { w.tick++; last = find(collect(w, () => { executeWork(w, w.agents[TOM], decision(w, TOM, 'slack_off')); }) as TaskEvent[], 'CHOSE_OTHER_ACTION'); }
    assert.equal(last!.severity, 'warning');
    assert.equal(last!.details.topTurns, 3);
  });

  it('WORK_NOT_OFFERED: the owner has only paused work', () => {
    const w = world();
    const t = task(w, 'service-0'); assign(t, TOM, 'paused');
    const e = find(collect(w, () => { executeWork(w, w.agents[TOM], decision(w, TOM, 'slack_off')); }) as TaskEvent[], 'WORK_NOT_OFFERED', 'service-0');
    assert.equal(e.stage, 'choice');
    assert.equal(e.details.status, 'paused');
  });
});

describe('execution stage', () => {
  it('STALE_ASSIGNMENT: the agent read an older version', () => {
    const w = world();
    const t = task(w, 'service-0'); assign(t, TOM); t.version = 3;
    const e = find(collect(w, () => { executeWork(w, w.agents[TOM], decision(w, TOM, 'work', t, 2)); }) as TaskEvent[], 'STALE_ASSIGNMENT');
    assert.equal(e.details.readVersion, 2);
    assert.equal(e.details.version, 3);
  });

  it('DEPENDENCY_PENDING: names the dependency, its owner, status and progress', () => {
    const w = world();
    const dep = task(w, 'initial-release'); assign(dep, SAM); dep.remaining = 1; // 75% done
    const t = task(w, 'service-0'); assign(t, TOM); t.dependencies = ['initial-release'];
    const e = find(collect(w, () => { executeWork(w, w.agents[TOM], decision(w, TOM, 'work', t)); }) as TaskEvent[], 'DEPENDENCY_PENDING');
    assert.equal(e.stage, 'execution');
    assert.deepEqual([e.details.dependencyId, e.details.dependencyOwner, e.details.dependencyStatus, e.details.dependencyProgress], ['initial-release', SAM, 'active', 75]);
  });

  it('INPUT_NOT_RECEIVED: objective work whose required finding has not reached the owner', () => {
    const w = world();
    const input = makeTask('company-x-research', 'process', 'Operations', 'Research the pilot', 2, 40);
    const t = makeTask('company-x-plan', 'process', 'Operations', 'Plan the pilot', 2, 40);
    w.business.tasks.push(input, t); assign(t, 'breadwinner');
    w.companyTasks = [{ id: 'company-x', runId: 'r', objective: 'Pilot', idempotencyKey: 'k', submittedTick: 1, status: 'in_progress', findings: [], activity: [], displaced: {},
      work: { [t.id]: { taskId: t.id, category: 'planning', acceptance: 'x', requiredInputs: [input.id], producesFinding: false, consumedFindings: {}, rework: 0 } } } as unknown as CompanyTask];
    const e = find(collect(w, () => scanTasks(w)) as TaskEvent[], 'INPUT_NOT_RECEIVED', t.id);
    assert.equal(e.stage, 'execution');
    assert.equal(e.caseId, 'company-x');
    assert.equal(e.details.inputId, input.id);
    assert.equal(e.details.inputState, 'not_produced');
  });

  it('SUPPLIER_OUTAGE: includes when the outage ends', () => {
    const w = world();
    const t = task(w, 'service-0'); assign(t, TOM);
    w.business.supplierAvailableAt = w.tick + 6;
    const e = find(collect(w, () => { executeWork(w, w.agents[TOM], decision(w, TOM, 'work', t)); }) as TaskEvent[], 'SUPPLIER_OUTAGE');
    assert.equal(e.details.until, w.tick + 6);
    assert.equal(e.details.kind, 'delivery');
  });

  it('NO_TIME_AFTER_COORDINATION: coordination left less than a full review turn', () => {
    const w = world();
    const t = task(w, 'service-0'); t.owner = TOM; t.status = 'review'; t.reviewer = SAM; t.allocated = 1;
    const e = find(collect(w, () => { executeWork(w, w.agents[SAM], decision(w, SAM, 'review_work', t), 0.5); }) as TaskEvent[], 'NO_TIME_AFTER_COORDINATION');
    assert.equal(e.agentId, SAM);
  });

  it('PARTIAL_PROGRESS: progress made but the allocation is small against what is left', () => {
    const w = world();
    const t = task(w, 'service-0'); assign(t, TOM); t.effort = 10; t.remaining = 10;
    const e = find(collect(w, () => { executeWork(w, w.agents[TOM], decision(w, TOM, 'work', t)); }) as TaskEvent[], 'PARTIAL_PROGRESS');
    assert.equal(e.severity, 'info');
    assert.equal(e.details.remaining, 9);
    assert.equal(e.details.turns, 9);
  });
});

describe('quality and review stages', () => {
  it('HIGH_DEFECT_RISK: names the main factor when work finishes', () => {
    const w = world();
    const t = task(w, 'service-0'); assign(t, TOM); t.remaining = 1;
    w.agents[TOM].state.burnout = 90; w.agents[TOM].state.workload = 95;
    const e = find(collect(w, () => { executeWork(w, w.agents[TOM], decision(w, TOM, 'work', t)); }) as TaskEvent[], 'HIGH_DEFECT_RISK');
    assert.equal(e.stage, 'quality');
    assert.equal(e.details.factor, 'burnout');
    assert.ok(Number(e.details.risk) >= 8);
    assert.equal(e.details.review, 'pending');
  });

  it('AWAITING_REVIEWER: finished work in review with nobody assigned', () => {
    const w = world();
    const t = task(w, 'service-0'); t.owner = TOM; t.status = 'review'; t.allocated = 0;
    const e = find(collect(w, () => scanTasks(w)) as TaskEvent[], 'AWAITING_REVIEWER', 'service-0');
    assert.equal(e.stage, 'review');
    assert.equal(e.details.owner, TOM);
  });

  it('REWORK_AFTER_REVIEW: the reviewer caught a defect', () => {
    const w = world();
    const t = task(w, 'service-0'); t.owner = TOM; t.status = 'review'; t.reviewer = SAM; t.allocated = 1; t.error = true; t.remaining = 0;
    const e = find(collect(w, () => { executeWork(w, w.agents[SAM], decision(w, SAM, 'review_work', t)); }) as TaskEvent[], 'REWORK_AFTER_REVIEW');
    assert.equal(e.stage, 'review');
    assert.equal(e.details.reviewer, SAM);
    assert.equal(e.agentId, TOM);
  });
});

describe('deadline stage', () => {
  it('AT_RISK: the projected finish passes the deadline', () => {
    const w = world();
    const t = task(w, 'service-0'); assign(t, TOM); t.remaining = 4; t.deadline = w.tick + 2;
    const e = find(collect(w, () => scanTasks(w)) as TaskEvent[], 'AT_RISK', 'service-0');
    assert.equal(e.stage, 'deadline');
    assert.equal(e.severity, 'critical', 'contract-linked work is critical');
    assert.equal(e.details.client, 'Northstar');
  });

  it('OVERDUE: past its own deadline', () => {
    const w = world();
    task(w, 'initial-sales').deadline = 1;
    const e = find(collect(w, () => scanTasks(w)) as TaskEvent[], 'OVERDUE', 'initial-sales');
    assert.equal(e.details.deadline, 1);
  });

  it('CASE_FAILED: the deadline passed; delivery contracts at risk', () => {
    const w = world();
    const e = openEvent(w, 'client_win');
    e.status = 'responding'; e.domain = 'delivery'; e.deadline = w.tick - 1;
    const t = task(w, e.tasks[0]);
    const failed = find(collect(w, () => updateLifecycle(w)) as TaskEvent[], 'CASE_FAILED', t.id);
    assert.equal(failed.severity, 'critical');
    assert.equal(failed.caseId, e.id);
    assert.ok(String(failed.details.contracts).length > 0);
  });
});

describe('disruption and completion', () => {
  it('OWNER_LEFT: the owner quit; the task is blocked with no owner', () => {
    const w = world();
    const t = task(w, 'service-0'); assign(t, TOM);
    w.agents[TOM].status = 'quit';
    const e = find(collect(w, () => openBusinessTick(w)) as TaskEvent[], 'OWNER_LEFT', 'service-0');
    assert.equal(e.stage, 'disruption');
    assert.equal(e.details.agent, TOM);
    assert.equal(e.details.how, 'quit');
    assert.equal(t.owner, null);
  });

  it('SAVINGS_TARGET_MISSED: a cost cut that cannot meet its target completes as blocked', () => {
    const w = world();
    const e = openEvent(w, 'cost_review'); e.value = 10_000_000;
    const t = makeTask('cut', 'cost_cut', 'Operations', 'Cut costs', 1, w.tick + 10, e.id);
    t.reviewRequired = false; w.business.tasks.push(t); assign(t, 'breadwinner');
    const missed = find(collect(w, () => { executeWork(w, w.agents.breadwinner, decision(w, 'breadwinner', 'work', t)); }) as TaskEvent[], 'SAVINGS_TARGET_MISSED');
    assert.equal(missed.details.target, 10_000_000);
    assert.equal(t.status, 'blocked');
  });

  it('COMPLETED: lists the business effects', () => {
    const w = world();
    const t = task(w, 'service-0'); t.owner = TOM; t.status = 'review'; t.reviewer = SAM; t.allocated = 1; t.remaining = 0;
    const e = find(collect(w, () => { executeWork(w, w.agents[SAM], decision(w, SAM, 'review_work', t)); }) as TaskEvent[], 'COMPLETED', 'service-0');
    assert.equal(e.details.revenue, 24_000_000);
    assert.equal(e.details.client, 'Northstar');
  });
});
