// Folds per-tick task events into one inbox thread per task. Pure: (state, events, world) -> state.
// Runs outside the simulation (server/index.ts), so it can never affect a run.
import type { Task } from '../../shared/business';
import {
  SEVERITY_RANK, STAGE_RANK,
  type InboxDelta, type InboxMessage, type InboxThread, type ReasonCode, type Severity, type Stage, type TaskEvent,
} from '../../shared/inbox';
import type { World } from '../engine-types';
import type { Params } from '../params';
import { isRoutine } from './details';
import { CLEARED, plural, render } from './templates';

interface Blocker {
  code: ReasonCode; stage: Stage; severity: Severity;
  details: Record<string, string | number>;
  agentId?: string;
  since: number; turn: number;
}

export interface InboxState {
  threads: Record<string, InboxThread>;
  /** Current blockers per task. Server-only. */
  blockers: Record<string, Partial<Record<ReasonCode, Blocker>>>;
  /** The message the current primary blocker is shown in, per task. Server-only. */
  current: Record<string, { code: ReasonCode; severity: Severity; messageId: string } | undefined>;
  /** Hidden security cases caused by finished work, revealed only once detected. Server-only, never sent. */
  links: Record<string, { taskId: string; agentId: string; tick: number }>;
}

export const emptyInbox = (): InboxState => ({ threads: {}, blockers: {}, current: {}, links: {} });
export const inboxThreads = (s: InboxState): InboxThread[] => Object.values(s.threads);

/** Re-derived from engine state at the end of every tick: absent this tick means cleared. */
const STATE = new Set<ReasonCode>(['UNASSIGNED', 'AWAITING_REVIEWER', 'INPUT_NOT_RECEIVED', 'AT_RISK', 'OVERDUE']);
/** Set by the owner's turn: replaced by their next turn on the task. */
const TURN = new Set<ReasonCode>(['CHOSE_OTHER_ACTION', 'WORK_NOT_OFFERED', 'STALE_ASSIGNMENT', 'DEPENDENCY_PENDING', 'SUPPLIER_OUTAGE', 'NO_TIME_AFTER_COORDINATION', 'PARTIAL_PROGRESS', 'PROGRESS_MADE']);
/** Held until the engine state that caused them changes. */
const STICKY = new Set<ReasonCode>(['ON_HOLD', 'OWNER_LEFT', 'REWORK_AFTER_REVIEW', 'CASE_FAILED', 'SAVINGS_TARGET_MISSED',
  'REJECTED_NO_CAPABILITY', 'REJECTED_OVER_CAPACITY', 'REJECTED_SELF_REVIEW', 'REJECTED_DEPS_NOT_DONE', 'REJECTED_INVALID']);
/** Shown once in the timeline, never a blocker. */
const ONE_SHOT = new Set<ReasonCode>(['HIGH_DEFECT_RISK', 'COMPLETED', 'DEFECT_SURFACED',
  'DEADLINE_INFEASIBLE', 'CHASED', 'CHASE_MISSED', 'BLOCKER_FIXED_BY_MANAGER', 'MEETING_OUTCOME']);
const isRejection = (code: ReasonCode) => code.startsWith('REJECTED_');

const assigned = (t: Task) => t.status === 'review' ? Boolean(t.reviewer) : Boolean(t.owner) && t.status === 'active';

/** Whether a held blocker still holds in the engine's current state. */
function holds(w: World, t: Task, b: Blocker): boolean {
  if (t.status === 'done' || t.status === 'cancelled') return false;
  switch (b.code) {
    case 'ON_HOLD': return t.status === 'paused';
    case 'OWNER_LEFT': return !t.owner;
    case 'REWORK_AFTER_REVIEW': return t.status === 'pending';
    case 'SAVINGS_TARGET_MISSED': return t.status === 'blocked';
    case 'CASE_FAILED': return true;
    case 'SUPPLIER_OUTAGE': return w.tick < w.business.supplierAvailableAt && t.status === 'active';
    case 'DEPENDENCY_PENDING': return w.business.tasks.find(x => x.id === b.details.dependencyId)?.status !== 'done' && t.status === 'active';
    case 'WORK_NOT_OFFERED': return t.owner === b.agentId && (t.status === 'pending' || t.status === 'paused');
    default:
      if (isRejection(b.code)) return !assigned(t);
      if (TURN.has(b.code)) return t.status === 'active' && t.owner === b.agentId;
      return true;
  }
}

function pickPrimary(blockers: Blocker[]): Blocker | undefined {
  const ranked = [...blockers].filter(b => b.code !== 'PROGRESS_MADE')
    .sort((a, b) => STAGE_RANK[a.stage] - STAGE_RANK[b.stage] || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return ranked.find(b => b.severity !== 'info') ?? ranked[0];
}

export function foldInbox(prev: InboxState, events: TaskEvent[], w: World, params: Params): { state: InboxState; delta: InboxDelta } {
  const p = params.diagnostics;
  const state: InboxState = structuredClone(prev);
  const tick = w.tick;
  const toasts: InboxDelta['toasts'] = [];
  const oneShots: Record<string, Array<Omit<TaskEvent, 'turn'> & { turn: number }>> = {};
  const byTask = new Map<string, TaskEvent[]>();
  const seen = new Set<string>();
  for (const e of events) {
    // An ops retry can repeat the same rejection within one tick.
    const key = `${e.taskId}|${e.code}|${JSON.stringify(e.details)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byTask.set(e.taskId, [...byTask.get(e.taskId) ?? [], e]);
  }

  // Hidden defects: surface only when the engine has detected the security case.
  for (const e of events.filter(e => e.code === 'DEFECT_LINKED')) state.links[String(e.details.eventId)] = { taskId: e.taskId, agentId: e.agentId ?? '', tick: e.turn };
  for (const [caseId, link] of Object.entries(state.links)) {
    const c = w.eventState.cases.find(x => x.id === caseId);
    if (!c) continue;
    if (c.detected) {
      (oneShots[link.taskId] ??= []).push({ turn: tick, taskId: link.taskId, caseId, agentId: link.agentId, stage: 'quality', code: 'DEFECT_SURFACED', severity: 'critical', details: { headline: c.headline, agent: link.agentId, finished: link.tick, securityCase: caseId } });
      delete state.links[caseId];
    }
  }

  const touched = new Set<string>([...byTask.keys(), ...Object.keys(state.blockers), ...Object.keys(oneShots)]);
  for (const taskId of touched) {
    const t = w.business.tasks.find(x => x.id === taskId);
    if (!t) { delete state.blockers[taskId]; continue; }
    const list = byTask.get(taskId) ?? [];
    const blockers = state.blockers[taskId] ??= {};
    const put = (e: TaskEvent) => {
      const old = blockers[e.code];
      // Ops records the reason; the end-of-tick scan only re-confirms the condition.
      const details = old && e.details.reason === undefined && old.details.reason !== undefined ? { ...old.details, ...e.details, reason: old.details.reason, staff: old.details.staff ?? '' } : e.details;
      blockers[e.code] = { code: e.code, stage: e.stage, severity: e.severity, details, agentId: e.agentId, since: old?.since ?? e.turn, turn: e.turn };
    };
    // Turn events: the owner's latest turn replaces their previous turn's reasons.
    const turnEvents = list.filter(e => TURN.has(e.code));
    if (turnEvents.length) for (const code of Object.keys(blockers) as ReasonCode[]) if (TURN.has(code) && !turnEvents.some(e => e.code === code)) delete blockers[code];
    for (const e of turnEvents) if (e.code !== 'PROGRESS_MADE') put(e);
    // State codes: exactly this tick's set.
    for (const code of Object.keys(blockers) as ReasonCode[]) if (STATE.has(code) && !list.some(e => e.code === code)) delete blockers[code];
    for (const e of list.filter(e => STATE.has(e.code))) put(e);
    for (const e of list.filter(e => STICKY.has(e.code))) {
      if (isRejection(e.code) && assigned(t)) (oneShots[taskId] ??= []).push({ ...e, severity: 'info' });
      else put(e);
    }
    for (const e of list.filter(e => ONE_SHOT.has(e.code))) (oneShots[taskId] ??= []).push(e);
    // Clear what no longer holds; escalate an owner loss that ops has had a chance to fix.
    for (const b of Object.values(blockers)) {
      if (!b) continue;
      if (!holds(w, t, b)) { delete blockers[b.code]; continue; }
      if (b.code === 'OWNER_LEFT' && !isRoutine(t) && w.eventState.decisions.some(d => d.kind === 'ops' && d.tick >= b.since)) b.severity = 'critical';
    }
    if (!Object.keys(blockers).length) delete state.blockers[taskId];
  }

  // Render threads (after every task's blockers are settled, so why-chains see upstream state).
  const changed: InboxThread[] = [];
  for (const taskId of touched) {
    const t = w.business.tasks.find(x => x.id === taskId);
    if (!t) continue;
    const blockers = Object.values(state.blockers[taskId] ?? {}).filter((b): b is Blocker => Boolean(b));
    const shots = oneShots[taskId] ?? [];
    let thread = state.threads[taskId];
    // A rejected ops plan is always recorded, even when the fallback then assigned the task.
    const worth = blockers.some(b => b.severity !== 'info' && b.code !== 'PROGRESS_MADE') || shots.some(s => s.severity !== 'info' || isRejection(s.code));
    if (!thread && !worth) continue;
    const before = thread ? JSON.stringify(thread) : '';
    thread ??= state.threads[taskId] = {
      id: taskId, taskId, title: t.title, ownerId: t.owner, agentIds: [], deadline: t.deadline, contractLinked: Boolean(t.contractId),
      status: 'blocked', severity: 'info', primary: null, also: [], messages: [], openedTick: tick, updatedTick: tick,
      ...(t.eventId ? { caseId: t.eventId } : {}),
    };
    const objective = w.companyTasks?.find(c => c.work[taskId]);
    if (objective) thread.objectiveId = objective.id;
    thread.title = t.title; thread.ownerId = t.owner; thread.deadline = t.deadline;
    const add = (m: Omit<InboxMessage, 'id'>) => {
      const message = { ...m, id: `${taskId}-${tick}-${thread!.messages.length}` };
      thread!.messages.push(message);
      if (message.severity === 'critical') toasts.push({ threadId: taskId, messageId: message.id, headline: message.headline });
      return message;
    };
    for (const s of shots) {
      const r = render(s.code, { w, task: t, details: s.details, count: 1, turn: s.turn });
      if (isRejection(s.code)) r.why.push(t.status === 'review' ? `${w.agents[t.reviewer ?? '']?.profile.name ?? 'Someone else'} was assigned to review it instead.` : `It went to ${w.agents[t.owner ?? '']?.profile.name ?? 'someone else'} instead.`);
      add({ tick, lastTick: tick, count: 1, stage: s.stage, code: s.code, severity: s.severity, ...r });
    }
    const primary = pickPrimary(blockers);
    // A critical blocker behind an earlier one still gets its own message (and toast) when it first appears.
    for (const b of blockers) if (b !== primary && b.severity === 'critical' && b.since === tick && !thread.messages.some(m => m.code === b.code && m.tick === tick)) {
      add({ tick, lastTick: tick, count: 1, stage: b.stage, code: b.code, severity: b.severity, ...render(b.code, { w, task: t, details: b.details, count: 1, turn: b.turn }) });
    }
    const current = state.current[taskId];
    if (primary && primary.severity !== 'info' || primary && thread.status !== 'resolved') {
      const count = tick - primary.since + 1;
      const r = render(primary.code, { w, task: t, details: primary.details, count, turn: primary.turn });
      r.why.push(...chain(state, w, primary, 1));
      const existing = current && current.code === primary.code && SEVERITY_RANK[primary.severity] <= SEVERITY_RANK[current.severity] && thread.status !== 'resolved'
        ? thread.messages.find(m => m.id === current.messageId) : undefined;
      if (existing) Object.assign(existing, { lastTick: tick, count, headline: r.headline, why: r.why, unblock: r.unblock, severity: SEVERITY_RANK[primary.severity] > SEVERITY_RANK[existing.severity] ? primary.severity : existing.severity });
      else state.current[taskId] = { code: primary.code, severity: primary.severity, messageId: add({ tick, lastTick: tick, count, stage: primary.stage, code: primary.code, severity: primary.severity, ...r }).id };
      thread.primary = { stage: primary.stage, code: primary.code };
      thread.status = primary.stage === 'deadline' ? 'at_risk' : 'blocked';
      thread.severity = blockers.reduce<Severity>((max, b) => SEVERITY_RANK[b.severity] > SEVERITY_RANK[max] ? b.severity : max, primary.severity);
      delete thread.resolution;
    } else if (thread.status !== 'resolved') {
      const last = current?.code;
      const done = t.status === 'done' || t.status === 'cancelled';
      const completed = [...thread.messages].reverse().find(m => m.code === 'COMPLETED');
      const rescheduled = !last && thread.messages.at(-1) && isRejection(thread.messages.at(-1)!.code) ? thread.messages.at(-1)!.why.at(-1) : undefined;
      thread.status = 'resolved'; thread.primary = null; thread.severity = 'info';
      thread.resolution = { tick, summary: done
        ? (t.status === 'cancelled' ? 'Cancelled.' : `Done. ${completed?.why[0] ?? ''}`.trim())
        : rescheduled ? `Ops rescheduled it. ${rescheduled}` : `Unblocked after ${plural(Math.max(1, tick - thread.openedTick), 'hour')}: ${last ? CLEARED[last] ?? 'the blocker cleared' : 'the blocker cleared'}.` };
      delete state.current[taskId];
    }
    // An owner who left already explains why the task has no owner.
    thread.also = blockers.filter(b => b !== primary && b.severity !== 'info' && !(b.code === 'UNASSIGNED' && blockers.some(x => x.code === 'OWNER_LEFT')))
      .sort((a, b) => STAGE_RANK[a.stage] - STAGE_RANK[b.stage])
      .map(b => render(b.code, { w, task: t, details: b.details, count: tick - b.since + 1, turn: b.turn }).headline);
    thread.agentIds = [...new Set([t.owner, ...blockers.map(b => b.agentId), ...blockers.flatMap(b => [b.details.dependencyOwner, b.details.producer, b.details.reviewer, b.details.employee, b.details.agent])]
      .filter((id): id is string => typeof id === 'string' && Boolean(w.agents[id])))];
    if (thread.messages.length > p.maxMessagesPerThread) thread.messages = thread.messages.slice(-p.maxMessagesPerThread);
    if (JSON.stringify(thread) !== before) { thread.updatedTick = tick; changed.push(thread); }
  }
  return { state, delta: { threads: structuredClone(changed), toasts } };
}

/** Follow a dependency or input upstream: what that task is stuck on, up to two levels. */
function chain(state: InboxState, w: World, b: Blocker, depth: number): string[] {
  const upstreamId = b.details.dependencyId ?? b.details.inputId;
  if (!upstreamId || depth > 2) return [];
  const upstream = w.business.tasks.find(x => x.id === upstreamId);
  const ub = pickPrimary(Object.values(state.blockers[String(upstreamId)] ?? {}).filter((x): x is Blocker => Boolean(x)));
  if (!upstream || !ub || ub.severity === 'info') return [];
  const r = render(ub.code, { w, task: upstream, details: ub.details, count: w.tick - ub.since + 1, turn: ub.turn });
  return [`Upstream, ${r.headline.charAt(0).toLowerCase()}${r.headline.slice(1)}: ${r.why[0] ?? ''}`.trim(), ...chain(state, w, ub, depth + 1)];
}
