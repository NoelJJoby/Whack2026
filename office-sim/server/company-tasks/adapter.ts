import type { CompanyTask } from '../../shared/companyTasks';
import type { Department, Task } from '../../shared/business';
import type { ManagementContext, ManagementDecision } from '../../shared/events';
import { days } from '../../shared/workday';
import { makeTask } from '../business';
import type { World } from '../engine-types';
import { isPresent } from '../presence';
import { activeCompanyTask, addActivity } from './state';

const routineKinds = { Engineering: 'release', Sales: 'sales', Operations: 'process' } as const;
const isOpen = (task: Task) => task.status !== 'done' && task.status !== 'cancelled';
const isRoutine = (task: Task) => !task.eventId && !task.contractId && task.kind !== 'collection';
const supplierWait = (w: World, task: Task) =>
  task.status !== 'review' && w.tick < w.business.supplierAvailableAt && ['delivery', 'release', 'onboarding'].includes(task.kind);

export function prepareCompanySchedule(w: World) {
  const mission = activeCompanyTask(w);
  if (!mission?.brief) return;

  // The business tick clears departed owners before Ops. Keep work already submitted
  // for review in that stage, with its actual author excluded from reviewing it.
  for (const task of w.business.tasks) {
    const meta = mission.work[task.id];
    if (meta?.author && task.remaining === 0 && task.status === 'blocked' && task.reviewRequired && !task.reviewed) {
      task.status = 'review';
      task.owner = meta.author;
      task.allocated = 0;
      delete task.reviewer;
    }
  }

  const open = w.business.tasks.filter(isOpen);
  const ready = open.filter(t => !supplierWait(w, t) && t.dependencies.every(id => w.business.tasks.some(d => d.id === id && d.status === 'done')));
  for (const department of Object.keys(routineKinds) as Department[]) {
    const staff = Object.values(w.business.positions).filter(p => p.role === 'employee' && p.capabilities.includes(department) && isPresent(w, p.id));
    const available = ready.filter(t => t.department === department && staff.some(p => t.status !== 'review' || p.id !== t.owner)).length;
    const kind = routineKinds[department];
    // Main's generator counts blocked and paused tasks. Fill only a real ready-work
    // deficit and reuse a backlog even if its previous owner is unavailable.
    const fallbackKind = department === 'Engineering' && w.tick < w.business.supplierAvailableAt ? 'support' : kind;
    for (let i = available; i < staff.length; i++) {
      w.business.tasks.push(makeTask(`routine-company-${w.tick}-${department}-${i}`, fallbackKind, department,
        `Maintain ${department.toLowerCase()} service while project work waits`, 3, w.tick + days(3)));
    }
  }
}

function pendingEscalations(mission: CompanyTask, tick: number) {
  const handled = new Set(mission.activity.filter(a => a.kind === 'priority').flatMap(a => a.decision?.evidence ?? []));
  return mission.activity.filter(a => a.message?.kind === 'escalation' && a.tick < tick && !handled.has(a.id));
}

export interface CompanySchedule {
  objective: string;
  taskIds: string[];
  waitingForSupplier: string[];
  escalations: Array<{ messageId: string; sourceTaskId: string }>;
}

export function companySchedulingView(w: World, tasks: Task[]): { tasks: Task[]; schedule: CompanySchedule } | undefined {
  const mission = activeCompanyTask(w);
  if (!mission?.brief) return;
  const escalations = pendingEscalations(mission, w.tick).map(a => ({ messageId: a.id, sourceTaskId: a.message!.sourceTaskId }));
  const escalated = new Set(escalations.map(a => a.sourceTaskId));
  return {
    tasks: tasks.map(t => ({ ...t, priority: mission.work[t.id] ? (escalated.has(t.id) ? 10 : 11) : isRoutine(t) ? 20 : t.priority })),
    schedule: { objective: mission.objective, taskIds: mission.brief.workIds, waitingForSupplier: tasks.filter(t => supplierWait(w, t)).map(t => t.id), escalations },
  };
}

export function validateCompanyAssignments(ctx: ManagementContext, schedule: CompanySchedule, merged: ManagementDecision['assignments']) {
  const active = merged.filter(a => a.state === 'active' && a.allocation > 0);
  if (active.some(a => schedule.waitingForSupplier.includes(a.taskId))) throw new Error('Assignment cannot proceed before the supplier returns');
  const ready = ctx.tasks.filter(t => !schedule.waitingForSupplier.includes(t.id) && t.dependencies.every(id => !ctx.tasks.some(d => d.id === id)));
  const used = new Map(ctx.employees.map(e => [e.id, active.filter(a => a.employeeId === e.id).reduce((n, a) => n + a.allocation, 0)]));
  for (const task of ready) {
    const higherTier = task.priority < 10 ? 10 : task.priority < 20 ? 20 : null;
    if (higherTier === null) continue;
    const assigned = active.find(a => a.taskId === task.id)?.allocation ?? 0;
    if (assigned >= 1) continue;
    const eligible = ctx.employees.filter(e => e.capabilities.includes(task.department) && (task.status !== 'review' || task.owner !== e.id));
    if (!assigned && eligible.some(e => (used.get(e.id) ?? 0) < e.capacity)) throw new Error('Ready priority work needs available qualified capacity');
    if (active.some(a => {
      const lower = ctx.tasks.find(t => t.id === a.taskId)!;
      return lower.priority >= higherTier && eligible.some(e => e.id === a.employeeId);
    })) throw new Error('Higher-priority work must be staffed before discretionary work');
  }
}

export function recordCompanySchedule(w: World, prior: Task[], decision: ManagementDecision) {
  const mission = activeCompanyTask(w);
  if (!mission?.brief) return;
  const current = w.business.tasks.filter(isOpen);
  const source = decision.fallback === 'rules' ? 'rules' : decision.fallback ? 'fallback' : 'model';
  const common = { round: 0, actor: decision.author, location: 'office' as const };
  const escalation = pendingEscalations(mission, w.tick);
  for (const task of current) {
    const old = prior.find(t => t.id === task.id);
    if (!old) continue;
    const assignee = task.status === 'review' ? task.reviewer : task.status === 'active' ? task.owner : null;
    const previous = old.status === 'review' ? old.reviewer : old.status === 'active' ? old.owner : null;
    if (!mission.work[task.id]) {
      const replaced = isRoutine(task) && !assignee && (old.status === 'pending' || previous) &&
        current.some(t => mission.work[t.id] && t.department === task.department && t.allocated > 0);
      if (replaced && !(task.id in mission.displaced)) {
        mission.displaced[task.id] = { status: old.status, owner: old.owner, allocated: old.allocated };
        addActivity(mission, w.tick, { ...common, recipients: previous ? [previous] : [], taskId: task.id, kind: 'displacement',
          dialogue: `Put “${task.title}” on hold to free capacity for the company objective.` });
      }
      continue;
    }
    const initial = !mission.activity.some(a => a.kind === 'assignment' && a.taskId === task.id);
    if (!initial && assignee === previous && task.status === old.status && task.allocated === old.allocated) continue;
    const blockers = task.dependencies.filter(id => w.business.tasks.some(d => d.id === id && d.status !== 'done'));
    const incident = previous ? current.find(t => t.eventId && t.id !== task.id && (t.owner === previous && t.status === 'active' || t.reviewer === previous)) : undefined;
    const reason = incident ? `Reassigned capacity to incident work “${incident.title}”.`
      : blockers.length ? 'Waiting on required work and its handoff.'
      : supplierWait(w, task) ? 'Waiting for supplier availability.'
      : task.status === 'review' ? 'Waiting for an available independent reviewer.' : 'No qualified capacity assigned this tick.';
    addActivity(mission, w.tick, {
      ...common, recipients: [...new Set([assignee, previous].filter((id): id is string => Boolean(id)))], taskId: task.id, kind: 'assignment',
      dialogue: assignee ? `${w.agents[assignee].profile.name}, please ${task.status === 'review' ? 'review' : 'take'} “${task.title}”.` : `“${task.title}” is waiting. ${reason}`,
      result: assignee ? (previous && previous !== assignee ? 'reassigned' : 'assigned') : reason,
      allocation: { previous: previous ?? null, assignee: assignee ?? null, effortPerTick: task.allocated, role: task.status === 'review' ? 'reviewer' : 'owner' },
      decision: {
        authority: w.business.positions[decision.author].role === 'ops' ? 'ops' : 'acting',
        question: `Who has capacity for “${task.title}”?`, options: ['Assign qualified capacity', 'Keep the work waiting'],
        explanation: assignee && !incident ? decision.rationale : reason,
        evidence: [...blockers, ...(incident?.eventId ? [incident.eventId] : []), ...escalation.map(a => a.id)],
        workIds: [task.id], briefVersion: mission.brief.version, source,
        ...(decision.fallback && source === 'fallback' ? { fallback: decision.fallback } : {}),
      },
    });
  }
  for (const message of escalation) {
    const sourceTask = w.business.tasks.find(t => t.id === message.message!.sourceTaskId);
    const explanation = sourceTask?.status === 'done'
      ? 'The prerequisite is complete. Arrange the verified handoff to the next owner.'
      : sourceTask?.allocated
      ? 'Keep qualified staff on the prerequisite and reserve dependent work until the handoff.'
      : 'Protect binding obligations and incident response. Recheck prerequisite staffing when capacity changes.';
    addActivity(mission, w.tick, { ...common, recipients: [message.actor!], kind: 'priority', taskId: message.taskId,
      dialogue: explanation, decision: { authority: w.business.positions[decision.author].role === 'ops' ? 'ops' : 'acting',
        question: 'How should we resolve the dependency delay?', options: ['Prioritize prerequisite work', 'Wait for capacity'],
        explanation, evidence: [message.id], workIds: [message.message!.sourceTaskId, ...(message.taskId ? [message.taskId] : [])],
        briefVersion: mission.brief.version, source },
    });
  }
}
