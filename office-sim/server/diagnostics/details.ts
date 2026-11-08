// Detail builders for task diagnostics. Each is called from an engine decision point, only while
// a collector is registered (server/diagnostics/collector.ts). They read the world and never
// write to it, and never draw from an RNG stream, so diagnostics cannot change a run.
import type { Task } from '../../shared/business';
import type { BusinessEvent, ManagementContext, ManagementDecision } from '../../shared/events';
import type { ReasonCode, Severity, Stage } from '../../shared/inbox';
import { isOfficeHour } from '../../shared/workday';
import { actionDrivers, GERUND, scale } from '../bias';
import type { CompanySchedule } from '../company-tasks/adapter';
import { canUseCompanyWork, knownInputs } from '../company-tasks/collaboration';
import { companyLimits } from '../company-tasks/config';
import type { Decision, EngineAgent, TurnContext, World } from '../engine-types';
import { pendingDependency, type defectRisk } from '../tasks';
import { diagnosticsParams, note } from './collector';

export type WorkReason = 'no_time' | 'rework' | 'review_passed' | 'dependency' | 'input' | 'supplier' | 'progress' | 'ineligible';
type Details = Record<string, string | number>;

export const isRoutine = (t: Pick<Task, 'id'>) => t.id.startsWith('routine-');
const PRODUCTIVE = new Set<string>(['work', 'overwork', 'review_work', 'support_colleague', 'report_issue']);
/** Turns of history needed before the projection trusts an owner's work rate. */
const MIN_RATE_TURNS = 3;
/** Backlog waiting is normal for routine work: these stay info-only there. Real damage never does. */
const ROUTINE_EXEMPT = new Set<ReasonCode>(['OWNER_LEFT', 'HIGH_DEFECT_RISK', 'REWORK_AFTER_REVIEW', 'CASE_FAILED', 'SAVINGS_TARGET_MISSED', 'DEFECT_SURFACED', 'COMPLETED']);

function objectiveOf(w: World, taskId: string) {
  return w.companyTasks?.find(c => c.work[taskId]);
}
function emit(w: World, t: Task, stage: Stage, code: ReasonCode, severity: Severity, details: Details = {}, agentId?: string | null) {
  const caseId = t.eventId ?? objectiveOf(w, t.id)?.id;
  note(w, {
    taskId: t.id, ...(caseId ? { caseId } : {}), ...(agentId ? { agentId } : {}),
    stage, code, severity: isRoutine(t) && !ROUTINE_EXEMPT.has(code) ? 'info' : severity, details,
  });
}
const pct = (t: Task) => t.effort > 0 ? Math.round(Math.max(0, Math.min(1, 1 - t.remaining / t.effort)) * 100) : 0;

function dependencyDetails(w: World, t: Task): Details {
  const id = pendingDependency(w.business, t) ?? '';
  const dep = w.business.tasks.find(x => x.id === id);
  return { dependencyId: id, dependencyTitle: dep?.title ?? id, dependencyOwner: dep?.owner ?? '', dependencyStatus: dep?.status ?? 'missing', dependencyProgress: dep ? pct(dep) : 0 };
}

/** The first required objective input this owner hasn't received, and where it is coming from. */
export function inputDetails(w: World, t: Task, actor: string): Details {
  const mission = objectiveOf(w, t.id);
  const meta = mission?.work[t.id];
  if (!mission || !meta) return {};
  const known = knownInputs(mission, t.id, actor).map(f => f.taskId);
  const missing = meta.requiredInputs.filter(id => !known.includes(id));
  const id = missing[0] ?? '';
  const input = w.business.tasks.find(x => x.id === id);
  const finding = [...mission.findings].reverse().find(f => f.taskId === id);
  return { inputId: id, inputTitle: input?.title ?? id, producer: finding?.producer ?? input?.owner ?? '', inputState: finding ? 'not_shared' : 'not_produced', inputStatus: input?.status ?? 'missing', missing: missing.length };
}

/** After executeWork: what this turn meant for the agent's own work (execution and choice stages). */
export function noteWork(w: World, agent: EngineAgent, decision: Decision, t: Task | undefined, reason: WorkReason | null, progress: number, ctx: NonNullable<TurnContext['work']>) {
  const p = diagnosticsParams(w)!.diagnostics;
  const b = w.business;
  const workTurn = decision.action === 'work' || decision.action === 'overwork';
  if (t && reason === 'ineligible' && t.version !== decision.assignment_version) {
    emit(w, t, 'execution', 'STALE_ASSIGNMENT', 'info', { readVersion: decision.assignment_version ?? 0, version: t.version }, agent.id);
  }
  if (t && workTurn && reason) {
    if (reason === 'dependency') emit(w, t, 'execution', 'DEPENDENCY_PENDING', 'warning', dependencyDetails(w, t), agent.id);
    else if (reason === 'input') emit(w, t, 'execution', 'INPUT_NOT_RECEIVED', 'warning', inputDetails(w, t, agent.id), agent.id);
    else if (reason === 'supplier') emit(w, t, 'execution', 'SUPPLIER_OUTAGE', 'warning', { until: b.supplierAvailableAt, kind: t.kind }, agent.id);
    else if (reason === 'progress') {
      const turns = t.allocated > 0 ? t.remaining / t.allocated : 0;
      if (t.status === 'active' && t.remaining > 0 && turns > p.partialTurnsWarn) emit(w, t, 'execution', 'PARTIAL_PROGRESS', 'info', { progress, allocated: t.allocated, remaining: t.remaining, turns: Math.ceil(turns) }, agent.id);
      else emit(w, t, 'execution', 'PROGRESS_MADE', 'info', { progress, remaining: t.remaining }, agent.id);
    }
  }
  if (t && reason === 'rework') {
    const meta = objectiveOf(w, t.id)?.work[t.id];
    emit(w, t, 'review', 'REWORK_AFTER_REVIEW', 'warning', { reviewer: agent.id, owner: t.owner ?? '', ...(meta ? { rework: meta.rework + 1, maxRework: companyLimits.maxRework } : {}) }, t.owner);
  }
  if (t && reason === 'no_time' && decision.action === 'review_work') emit(w, t, 'execution', 'NO_TIME_AFTER_COORDINATION', 'info', {}, agent.id);

  // Choice: the owner had usable assigned work and spent the turn on something else.
  const worked = workTurn && t && ctx.assignments.some(a => a.id === t.id);
  if (!worked && ctx.assignments.length) {
    const recent = b.work.filter(r => r.agent === agent.id).slice(-p.choiceWindow);
    // Reviewing, supporting and reporting are still work for the company; only idle turns count against the owner.
    const others = recent.filter(r => !PRODUCTIVE.has(r.action));
    const counts = new Map<string, number>();
    for (const r of others) counts.set(r.action, (counts.get(r.action) ?? 0) + 1);
    const [topAction, topTurns] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] === decision.action ? -1 : 1))[0] ?? [decision.action, 1];
    const s = scale({ ...agent, state: { ...agent.state, ...decision.log.state } });
    const drivers = actionDrivers(decision.action, s, decision.log.fresh, diagnosticsParams(w)!);
    const severity: Severity = !PRODUCTIVE.has(decision.action) && others.length >= p.choiceWarnTurns ? 'warning' : 'info';
    for (const a of ctx.assignments) {
      const task = b.tasks.find(x => x.id === a.id);
      if (task) emit(w, task, 'choice', 'CHOSE_OTHER_ACTION', severity, {
        action: decision.action, actionLabel: GERUND[decision.action], probability: Math.round((decision.probs[decision.action] ?? 0) * 100),
        drivers: drivers.join(', '), explain: decision.log.explain, otherTurns: others.length, window: recent.length,
        topAction, topLabel: GERUND[topAction as keyof typeof GERUND] ?? topAction, topTurns,
      }, agent.id);
    }
  }
  if (!ctx.assignments.length && !ctx.reviewable.length) {
    for (const task of b.tasks.filter(x => x.owner === agent.id && (x.status === 'pending' || x.status === 'paused'))) {
      emit(w, task, 'choice', 'WORK_NOT_OFFERED', 'info', { status: task.status }, agent.id);
    }
  }
}

/** When work finishes: the risk and its main factor. Never reads the roll (`t.error`). */
export function noteQuality(w: World, agent: EngineAgent, t: Task, q: ReturnType<typeof defectRisk>) {
  if (q.risk < diagnosticsParams(w)!.diagnostics.defectRiskWarn) return;
  const factor = q.fatigue >= q.overload && q.fatigue > 0.02 ? 'burnout' : q.overload > 0.02 ? 'workload' : 'controls';
  emit(w, t, 'quality', 'HIGH_DEFECT_RISK', 'warning', {
    risk: Math.round(q.risk * 1000) / 10, factor, burnout: Math.round(agent.state.burnout), workload: Math.round(agent.state.workload),
    controls: Math.round(q.controls * 100), review: t.reviewRequired && !t.reviewed ? 'pending' : t.reviewed ? 'done' : 'none',
  }, agent.id);
}

/** Server-only link from a hidden security case to the work that caused it. Revealed only on detection. */
export function noteDefectCase(w: World, eventId: string, t: Task, agentId: string) {
  emit(w, t, 'quality', 'DEFECT_LINKED', 'info', { eventId }, agentId);
}

export function completionSnapshot(w: World, t: Task) {
  const b = w.business;
  return { ledger: b.ledger.length, tasks: b.tasks.length, controls: b.controls, infra: b.dailyInfrastructure, disc: b.dailyDiscretionary,
    contained: w.eventState.cases.find(e => e.id === t.eventId)?.contained ?? false };
}

export function noteCompletion(w: World, t: Task, before: ReturnType<typeof completionSnapshot>) {
  const b = w.business; const event = w.eventState.cases.find(e => e.id === t.eventId);
  if (t.status === 'blocked' && t.kind === 'cost_cut' && event) {
    const choice = [...w.eventState.decisions].reverse().flatMap(d => d.choices).find(c => c.eventId === event.id);
    const rate = choice?.optionId.split(':')[1] === 'renegotiate' ? 'dailyInfrastructure' : 'dailyDiscretionary';
    emit(w, t, 'disruption', 'SAVINGS_TARGET_MISSED', 'warning', { target: event.value, rate, available: rate === 'dailyInfrastructure' ? before.infra : before.disc }, t.owner);
    return;
  }
  const sum = (category: string) => b.ledger.slice(before.ledger).filter(l => l.category === category).reduce((n, l) => n + l.amount, 0);
  const contract = b.contracts.find(c => c.id === t.contractId);
  emit(w, t, 'completion', 'COMPLETED', 'info', {
    revenue: sum('revenue'), collection: sum('collection'), saving: sum('saving'),
    controls: Math.round((b.controls - before.controls) * 100), contained: event?.contained && !before.contained ? 1 : 0,
    client: contract?.client ?? '', followOn: b.tasks.slice(before.tasks).map(x => x.title).join(' | '),
  }, t.owner);
}

export function noteRejection(w: World, t: Task, a: ManagementDecision['assignments'][number], code: ReasonCode, extra: Details = {}) {
  const employee = a.employeeId ?? '';
  emit(w, t, 'assignment', code, 'warning', {
    employee, department: t.department, employeeDepartment: w.business.positions[employee]?.department ?? '', owner: t.owner ?? '',
    ...(code === 'REJECTED_DEPS_NOT_DONE' ? dependencyDetails(w, t) : {}), ...extra,
  }, employee || null);
}

/** Booked hours per employee as the engine now holds them: active work plus review allocations. */
function bookings(w: World) {
  const used = new Map<string, number>();
  for (const t of w.business.tasks) {
    const who = t.status === 'active' ? t.owner : t.status === 'review' ? t.reviewer : null;
    if (who) used.set(who, (used.get(who) ?? 0) + t.allocated);
  }
  return used;
}

/** After an ops decision is applied: why each paused task or review was left without anyone. */
export function noteOpsOutcome(w: World, ctx: ManagementContext, d: ManagementDecision, schedule?: CompanySchedule) {
  const used = bookings(w);
  for (const a of d.assignments.filter(a => a.state === 'paused')) {
    const t = w.business.tasks.find(x => x.id === a.taskId);
    if (!t || ['done', 'cancelled'].includes(t.status)) continue;
    const review = t.status === 'review';
    const capable = ctx.employees.filter(e => e.capabilities.includes(t.department) && (!review || e.id !== t.owner));
    const free = capable.filter(e => (used.get(e.id) ?? 0) < e.capacity);
    const dep = pendingDependency(w.business, t);
    const reason = schedule?.waitingForSupplier.includes(t.id) ? 'supplier' : dep !== undefined ? 'dependency'
      : !capable.length ? 'no_staff' : !free.length ? 'booked' : 'ops_decision';
    const details: Details = {
      reason, department: t.department, fallback: d.fallback ?? 'none', owner: t.owner ?? '',
      staff: capable.map(e => `${e.id}:${used.get(e.id) ?? 0}/${e.capacity}`).join(','),
      ...(reason === 'supplier' ? { until: w.business.supplierAvailableAt } : {}),
      ...(reason === 'dependency' ? dependencyDetails(w, t) : {}),
    };
    if (review) emit(w, t, 'review', 'AWAITING_REVIEWER', 'warning', details, t.owner);
    else emit(w, t, 'assignment', t.owner ? 'ON_HOLD' : 'UNASSIGNED', 'warning', details, t.owner);
  }
}

export function noteOwnerLost(w: World, t: Task, agentId: string) {
  emit(w, t, 'disruption', 'OWNER_LEFT', 'warning', { agent: agentId, how: w.agents[agentId]?.status ?? 'quit', department: t.department, status: t.status }, agentId);
}

export function noteCaseFailed(w: World, e: BusinessEvent, tasks: Task[]) {
  const open = tasks.filter(t => !['done', 'cancelled'].includes(t.status));
  const contracts = w.business.contracts.filter(c => c.status === 'at_risk' && tasks.some(t => t.contractId === c.id)).map(c => c.client).join(', ');
  for (const t of open.length ? open : tasks.slice(-1)) {
    emit(w, t, 'deadline', 'CASE_FAILED', 'critical', { caseId: e.id, headline: e.headline, deadline: e.deadline, contracts, status: t.status }, t.owner);
  }
}

/** Office-hour ticks in (from, to]: the turns an owner can still work before a deadline. */
function officeTurns(from: number, to: number) {
  let n = 0;
  for (let tick = from + 1; tick <= to; tick++) if (isOfficeHour(tick)) n++;
  return n;
}
/** The tick of the `turns`-th office hour after `from`, or -1 if it can't be reached. */
function nthOfficeTick(from: number, turns: number) {
  if (!Number.isFinite(turns)) return -1;
  let tick = from;
  for (let left = Math.max(1, turns); left > 0 && tick < from + 5000;) { tick++; if (isOfficeHour(tick)) left--; }
  return tick;
}

/** Projected finish: remaining ÷ (allocation × the owner's recent work rate), counted in office hours. */
export function projection(w: World, t: Task, window: number) {
  const recent = w.business.work.filter(r => r.agent === t.owner).slice(-window);
  const worked = recent.filter(r => r.action === 'work' || r.action === 'overwork').length;
  // No history yet: assume they work, so a fresh assignment isn't flagged before anyone has had a turn.
  const rate = recent.length >= MIN_RATE_TURNS ? worked / recent.length : 1;
  const perTurn = t.allocated * rate;
  const turnsNeeded = perTurn > 0 ? Math.ceil(t.remaining / perTurn - 1e-9) : Infinity;
  return { rate, worked, window: recent.length, turnsNeeded, available: officeTurns(w.tick, t.deadline), finish: nthOfficeTick(w.tick, turnsNeeded) };
}

/** End of tick: conditions that hold in engine state rather than at one decision. Refreshed every tick. */
export function scanTasks(w: World) {
  const p = diagnosticsParams(w);
  if (!p) return;
  for (const t of w.business.tasks) {
    if (t.status === 'done' || t.status === 'cancelled') continue;
    if (!t.owner && t.status !== 'review') emit(w, t, 'assignment', 'UNASSIGNED', 'warning', { status: t.status, department: t.department });
    if (t.status === 'review' && !t.reviewer) emit(w, t, 'review', 'AWAITING_REVIEWER', 'warning', { owner: t.owner ?? '', department: t.department }, t.owner);
    if (t.owner && t.status === 'active' && !canUseCompanyWork(w, t.id, t.owner)) emit(w, t, 'execution', 'INPUT_NOT_RECEIVED', 'warning', inputDetails(w, t, t.owner), t.owner);
    if (w.tick > t.deadline) emit(w, t, 'deadline', 'OVERDUE', 'warning', { deadline: t.deadline, remaining: t.remaining }, t.owner);
    else if (t.owner && t.status === 'active') {
      const f = projection(w, t, p.diagnostics.workRateTurns);
      if (f.turnsNeeded > f.available) emit(w, t, 'deadline', 'AT_RISK', t.contractId ? 'critical' : 'warning', {
        remaining: t.remaining, allocated: t.allocated, worked: f.worked, window: f.window, finish: f.finish, deadline: t.deadline,
        client: w.business.contracts.find(c => c.id === t.contractId)?.client ?? '',
      }, t.owner);
    }
  }
}
