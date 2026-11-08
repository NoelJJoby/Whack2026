// Accountability loop (business mode). Rules decide everything here; the LLM only writes meeting lines.
//   1. Internal deadlines: each open task gets an internal due time ahead of its real deadline.
//   2. Stand-up (09:00): the ops manager chases the owner of every task that is behind.
//   3. Turns: each office-hour turn of a chased owner is counted as progress, own choice, blocked, or neutral.
//   4. Due-by (17:00 the next working day): a missed expectation is the owner's fault only if most counted
//      turns were their own choice. Fault -> the CEO warns them; fault again while warned -> fired.
//      Not their fault -> the manager fixes the blocker instead, and nobody is punished.
// Every input is engine state, never the diagnostics collector, so the inbox can be off without changing a run.
import type { Task } from '../shared/business';
import type { ChaseNotice, MeetingOutcome, MeetingScene } from '../shared/accountability';
import { clockLabel, type ReasonCode } from '../shared/inbox';
import { dayIndexOf, days, isDayStart, isOfficeClose, isOfficeHour, OFFICE_TICKS_PER_DAY, TICKS_PER_DAY } from '../shared/workday';
import type { Situational } from './bias';
import { canUseCompanyWork } from './company-tasks/collaboration';
import { note } from './diagnostics/collector';
import { inputDetails, isRoutine, projection } from './diagnostics/details';
import type { Action, Decision, EngineAgent, Mode, TurnContext, TurnProvider, World } from './engine-types';
import { managementOwners } from './events/lifecycle';
import { describeVoice } from './llm/voice';
import { templateMeetingLines, validMeetingLines, type MeetingBrief, type MeetingLines } from './llm/meeting-prompt';
import type { Params } from './params';
import { applyDelta } from './rules';
import { pendingDependency, supplierBlocks } from './tasks';

/** Turn reasons outside the owner's control (inbox reason codes). */
export type BlockCode = Extract<ReasonCode, 'DEPENDENCY_PENDING' | 'INPUT_NOT_RECEIVED' | 'SUPPLIER_OUTAGE' | 'STALE_ASSIGNMENT' | 'AWAITING_REVIEWER' | 'WORK_NOT_OFFERED'>;

export interface Chase {
  id: string; taskId: string; owner: string; chaser: string;
  tick: number; dueBy: number; expectRemaining: number; why: string;
  status: 'open' | 'met' | 'missed' | 'void';
  /** Office-hour turns since the chase, by class. */
  progress: number; own: number; neutral: number; blocked: Partial<Record<BlockCode, number>>;
}

export interface AccountabilityState {
  /** Internal due tick per task, the task deadline it was planned against, and when it was first planned. */
  internal: Record<string, { due: number; basis: number; feasible: boolean; since: number }>;
  chases: Chase[];
  /** Agents on a CEO warning, until `expires`. */
  warnings: Record<string, { tick: number; taskId: string; expires: number }>;
  meetings: MeetingScene[];
  /** Non-firing meeting cutscenes played, per workday index. */
  cutscenes: Record<number, number>;
  stats: { chases: number; met: number; missed: number; fixes: number; warnings: number; firings: number };
}

export const emptyAccountability = (): AccountabilityState => ({
  internal: {}, chases: [], warnings: {}, meetings: [], cutscenes: {},
  stats: { chases: 0, met: 0, missed: 0, fixes: 0, warnings: 0, firings: 0 },
});
const stateOf = (w: World) => (w.accountability ??= emptyAccountability());

const CLOSED: Task['status'][] = ['done', 'cancelled'];
/** Still company work: reviewing, supporting and reporting are not the owner slacking. */
const PRODUCTIVE = new Set<Action>(['review_work', 'support_colleague', 'report_issue']);
const BLOCK_TEXT: Record<BlockCode, string> = {
  DEPENDENCY_PENDING: 'waiting on other work', INPUT_NOT_RECEIVED: 'waiting for an input', SUPPLIER_OUTAGE: 'a supplier outage',
  STALE_ASSIGNMENT: 'an assignment change', AWAITING_REVIEWER: 'no reviewer', WORK_NOT_OFFERED: 'the task being on hold',
};
const round4 = (x: number) => Number(x.toFixed(4));
const short = (t: Task) => t.title.split(':')[0].trim();
const nameOf = (w: World, id: string | null | undefined) => (id && w.agents[id]?.profile.name) || id || 'nobody';
const isEmployee = (w: World, id: string | null | undefined) => Boolean(id && w.business.positions[id]?.role === 'employee' && w.agents[id]?.status === 'active');

// --- Office-hour arithmetic ---------------------------------------------------

/** Office-hour ticks in (from, to]. */
export function officeTurns(from: number, to: number): number {
  let n = 0;
  for (let t = from + 1; t <= to; t++) if (isOfficeHour(t)) n++;
  return n;
}
/** The tick of the n-th office hour after `from` (n >= 1). */
export function nthOfficeTick(from: number, n: number): number {
  let t = from;
  for (let left = Math.max(1, Math.ceil(n)); left > 0;) { t++; if (isOfficeHour(t)) left--; }
  return t;
}
/** 17:00 on the working day after `tick`'s. */
export const nextDayClose = (tick: number) => (dayIndexOf(tick) + 1) * TICKS_PER_DAY + OFFICE_TICKS_PER_DAY;

/** Office turns this task still needs at its allocation (plus a review turn if it still needs one). */
function need(t: Task): number {
  if (t.status === 'review') return 1;
  const allocation = t.allocated > 0 ? t.allocated : 1;
  return t.remaining / allocation + (t.reviewRequired && !t.reviewed ? 1 : 0);
}

function emit(w: World, t: Task, stage: TaskStage, code: ReasonCode, severity: 'info' | 'warning' | 'critical', details: Record<string, string | number>, agentId?: string) {
  const caseId = t.eventId ?? w.companyTasks?.find(c => c.work[t.id])?.id;
  note(w, { taskId: t.id, ...(caseId ? { caseId } : {}), ...(agentId ? { agentId } : {}), stage, code, severity, details });
}
type TaskStage = Parameters<typeof note>[1]['stage'];

// --- 1. Internal deadlines ------------------------------------------------------

/**
 * Plan each group (a case, an objective, or a lone task) along its dependency chain:
 * finish_i = max(finish of dependencies) + need_i, in office turns from now. If the group has more time
 * than its longest chain needs, the plan is stretched to `strictness` of that time; then a small buffer.
 * Never later than the task's own deadline. Replanned when the deadline changes.
 */
export function planDeadlines(w: World, p: Params): void {
  const st = stateOf(w); const P = p.accountability;
  const open = w.business.tasks.filter(t => !CLOSED.includes(t.status) && !isRoutine(t));
  // Groups: tasks of one case or objective, joined with anything they depend on (union-find).
  const parent = new Map(open.map(t => [t.id, t.id]));
  const root = (id: string): string => { const p = parent.get(id)!; if (p === id) return id; const r = root(p); parent.set(id, r); return r; };
  const join = (a: string, b: string) => { if (parent.has(a) && parent.has(b)) parent.set(root(a), root(b)); };
  const keyed = new Map<string, string>();
  for (const t of open) {
    const key = t.eventId ?? w.companyTasks?.find(c => c.work[t.id])?.id;
    if (key) { if (keyed.has(key)) join(t.id, keyed.get(key)!); else keyed.set(key, t.id); }
    for (const d of t.dependencies) join(t.id, d);
  }
  const groupOf = (t: Task) => root(t.id);
  const stale = new Set(open.filter(t => st.internal[t.id]?.basis !== t.deadline).map(groupOf));
  if (!stale.size) return;
  for (const group of stale) {
    const tasks = open.filter(t => groupOf(t) === group);
    const finish = new Map<string, number>();
    const finishOf = (t: Task, seen = new Set<string>()): number => {
      if (finish.has(t.id)) return finish.get(t.id)!;
      seen.add(t.id);
      const start = Math.max(0, ...t.dependencies.map(id => {
        const d = w.business.tasks.find(x => x.id === id);
        return d && !CLOSED.includes(d.status) && !seen.has(d.id) ? finishOf(d, seen) : 0;
      }));
      const f = start + need(t); finish.set(t.id, f); return f;
    };
    const longest = Math.max(...tasks.map(t => finishOf(t)));
    const available = officeTurns(w.tick, Math.max(...tasks.map(t => t.deadline)));
    const stretch = longest > 0 ? Math.max(1, P.strictness * available / longest) : 1;
    for (const t of tasks) {
      const own = officeTurns(w.tick, t.deadline);
      const planned = Math.min(own, Math.ceil(finishOf(t) * stretch - 1e-9) + P.bufferTurns);
      const feasible = finishOf(t) <= own;
      const first = st.internal[t.id] === undefined;
      st.internal[t.id] = { due: planned > 0 ? Math.min(t.deadline, nthOfficeTick(w.tick, planned)) : t.deadline, basis: t.deadline, feasible, since: st.internal[t.id]?.since ?? w.tick };
      if (!feasible && first) emit(w, t, 'deadline', 'DEADLINE_INFEASIBLE', 'critical', { needed: Math.ceil(finishOf(t)), available: own, deadline: t.deadline }, t.owner ?? undefined);
    }
  }
}

// --- Turn classification -----------------------------------------------------------

/** Why the owner can't work on the task right now, if it is out of their control. `inReview` = their part is done. */
export function blockedBy(w: World, t: Task, owner: string, decision?: Pick<Decision, 'action' | 'task_id' | 'assignment_version'> | null): BlockCode | 'inReview' | null {
  if (t.status === 'review') return t.reviewer ? 'inReview' : 'AWAITING_REVIEWER';
  if (t.owner !== owner || t.status !== 'active') return 'WORK_NOT_OFFERED';
  if (pendingDependency(w.business, t) !== undefined) return 'DEPENDENCY_PENDING';
  if (!canUseCompanyWork(w, t.id, owner)) return 'INPUT_NOT_RECEIVED';
  if (supplierBlocks(w, t)) return 'SUPPLIER_OUTAGE';
  if (decision && (decision.action === 'work' || decision.action === 'overwork') && decision.task_id === t.id && decision.assignment_version !== t.version) return 'STALE_ASSIGNMENT';
  return null;
}

/** Before the agent's work resolves: count this office-hour turn against each open chase on them. */
export function recordTurn(w: World, agentId: string, decision: Decision): void {
  if (!w.accountability || !isOfficeHour(w.tick)) return;
  for (const c of w.accountability.chases) {
    if (c.status !== 'open' || c.owner !== agentId) continue;
    const t = w.business.tasks.find(x => x.id === c.taskId);
    if (!t || CLOSED.includes(t.status)) continue;
    // Handed to someone else: their later turns say nothing about this task.
    if (t.owner !== agentId && t.status !== 'review') continue;
    const block = blockedBy(w, t, agentId, decision);
    if (block === 'inReview') c.neutral++;
    else if (block) c.blocked[block] = (c.blocked[block] ?? 0) + 1;
    else if ((decision.action === 'work' || decision.action === 'overwork') && decision.task_id === t.id) c.progress++;
    else if (decision.action === 'work' || decision.action === 'overwork' || PRODUCTIVE.has(decision.action)) c.neutral++;
    else c.own++;
  }
}

/** The fault rule: most counted turns were the owner's own choice, out of enough turns to judge. */
export function ownerAtFault(c: Pick<Chase, 'own' | 'blocked'>, p: Params): boolean {
  const blocked = Object.values(c.blocked).reduce((n, x) => n + (x ?? 0), 0);
  const counted = c.own + blocked;
  return counted >= p.accountability.minFaultTurns && c.own / counted >= p.accountability.faultShare;
}
const dominantBlock = (c: Chase): BlockCode | null =>
  (Object.entries(c.blocked) as Array<[BlockCode, number]>).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

// --- 2. Stand-up and chases ------------------------------------------------------------

function openChase(w: World, t: Task, owner: string, chaser: string, why: string, p: Params): ChaseNotice {
  const st = stateOf(w); const P = p.accountability;
  const allocation = t.allocated > 0 ? t.allocated : 1;
  const expectRemaining = t.status === 'review' ? 0 : Math.max(0, round4(t.remaining - allocation * OFFICE_TICKS_PER_DAY * P.expectDays));
  const dueBy = nextDayClose(w.tick);
  const c: Chase = { id: `chase-${w.tick}-${t.id}`, taskId: t.id, owner, chaser, tick: w.tick, dueBy, expectRemaining, why,
    status: 'open', progress: 0, own: 0, neutral: 0, blocked: {} };
  st.chases.push(c); st.stats.chases++;
  const agent = w.agents[owner];
  applyDelta(agent, { stress: P.chased.stress + agent.profile.traits.impulsivity / 100 * P.chased.impulsivityStress }, p);
  emit(w, t, 'deadline', 'CHASED', 'warning', { chaser, owner, dueBy, expectRemaining, why }, owner);
  const expect = expectRemaining > 0 ? 'real progress on it' : 'it finished';
  return { id: c.id, tick: w.tick, taskId: t.id, taskTitle: t.title, chaser, owner, dueBy, expectRemaining,
    line: `${nameOf(w, owner)}, “${short(t)}” is behind. I need ${expect} by ${clockLabel(dueBy)}.` };
}

/** Why this task is behind, or null. */
export function behind(w: World, t: Task, p: Params): string | null {
  const internal = w.accountability?.internal[t.id];
  if (internal && w.tick > internal.due) return `It is past its internal deadline of ${clockLabel(internal.due)}`;
  const f = projection(w, t, p.diagnostics.workRateTurns);
  if (f.turnsNeeded > f.available) return 'At the current pace it will miss its deadline';
  // Stalled: the owner had a full working day of office turns, and nobody advanced it.
  const dayAgo = w.tick - TICKS_PER_DAY;
  const turns = w.business.work.filter(r => r.agent === t.owner && r.tick > dayAgo && isOfficeHour(r.tick)).length;
  if (internal && w.tick - internal.since >= TICKS_PER_DAY && turns >= p.accountability.stallTurns
    && !w.business.work.some(r => r.taskId === t.id && r.progress > 0 && r.tick > dayAgo)) return 'It made no progress for a full working day';
  return null;
}

/** 09:00: expire old warnings, then the ops manager reviews every active task and chases the late ones. */
export function standup(w: World, p: Params): ChaseNotice[] {
  if (!p.accountability.enabled || !isDayStart(w.tick)) return [];
  const st = stateOf(w);
  for (const [id, warning] of Object.entries(st.warnings)) if (warning.expires <= w.tick || w.agents[id]?.status !== 'active') delete st.warnings[id];
  // Closed chases are only needed for a day of triggers and tests; the world is journalled every tick.
  st.chases = st.chases.filter(c => c.status === 'open' || c.dueBy > w.tick - days(2));
  const chaser = managementOwners(w).ops;
  if (!chaser) return [];
  const notices: ChaseNotice[] = [];
  for (const t of w.business.tasks) {
    // Finished work stuck waiting for a reviewer is the manager's to fix, not the owner's: assign one.
    if (!isRoutine(t) && t.status === 'review' && !t.reviewer && (st.internal[t.id]?.due ?? t.deadline) < w.tick) {
      const who = assignFree(w, t, t.owner ? [t.owner] : []);
      if (who) {
        st.stats.fixes++;
        emit(w, t, 'assignment', 'BLOCKER_FIXED_BY_MANAGER', 'info', { manager: chaser, owner: t.owner ?? '', fix: `Assigned ${nameOf(w, who)} to review it`, blocker: 'AWAITING_REVIEWER' }, chaser);
      }
      continue;
    }
    if (isRoutine(t) || t.status !== 'active' || !isEmployee(w, t.owner)) continue;
    if (st.chases.some(c => c.status === 'open' && c.taskId === t.id)) continue;
    // A task only counts as stalled once it has had a full working day.
    const why = behind(w, t, p);
    if (why) notices.push(openChase(w, t, t.owner!, chaser, why, p));
  }
  return notices;
}

// --- Effects on the chased owner ---------------------------------------------------------

/** The bias engine's situational push for an agent with an open chase: toward what is in their control. */
export function chaseSituation(w: World, agentId: string, p: Params): Situational | null {
  const st = w.accountability;
  const chases = st?.chases.filter(c => c.status === 'open' && c.owner === agentId) ?? [];
  if (!chases.length) return null;
  const P = p.accountability.chased;
  const modifiers = { ...P.modifiers };
  const warned = Boolean(st!.warnings[agentId]);
  if (warned) { modifiers.work = (modifiers.work ?? 1) * P.warnedBoost; modifiers.overwork = (modifiers.overwork ?? 1) * P.warnedBoost; }
  const blocked = chases.every(c => { const t = w.business.tasks.find(x => x.id === c.taskId); return !t || blockedBy(w, t, agentId) !== null; });
  if (blocked) modifiers.report_issue = P.blockedReportIssue;
  return { source: warned ? 'warned' : 'chased', label: warned ? "the CEO's warning" : 'being chased', modifiers };
}

/** Prompt triggers: the agent knows they have been chased or warned, by when, and what to do. */
export function chaseTriggers(w: World, agent: EngineAgent): Array<{ id: string; kind: 'task'; text: string; sourceId?: string; severity: 2 | 3 }> {
  const st = w.accountability;
  if (!st) return [];
  return st.chases.filter(c => c.status === 'open' && c.owner === agent.id).flatMap(c => {
    const t = w.business.tasks.find(x => x.id === c.taskId);
    if (!t) return [];
    const block = blockedBy(w, t, agent.id);
    const warned = st.warnings[agent.id];
    const head = warned
      ? `the CEO formally warned you over “${short(t)}”: miss ${clockLabel(c.dueBy)} through your own choices and you are fired`
      : `${nameOf(w, c.chaser)} chased you: “${short(t)}” is needed by ${clockLabel(c.dueBy)}`;
    const tail = block && block !== 'inReview' ? `; it is blocked by ${BLOCK_TEXT[block]}, so raise that with management` : '; do whatever is in your control to finish it';
    return [{ id: `chase-${t.id}`, kind: 'task' as const, text: head + tail, sourceId: warned ? managementOwners(w).ceo ?? c.chaser : c.chaser, severity: warned ? 3 as const : 2 as const }];
  });
}

// --- 4. Due-by: fault, fixes and meetings --------------------------------------------------

/** Spare booked capacity per active employee (active owners and reviewers). */
function spare(w: World): Map<string, number> {
  const used = new Map<string, number>();
  for (const t of w.business.tasks) {
    const who = t.status === 'active' ? t.owner : t.status === 'review' ? t.reviewer : null;
    if (who) used.set(who, (used.get(who) ?? 0) + t.allocated);
  }
  return new Map(Object.values(w.business.positions).filter(p => p.role === 'employee' && w.agents[p.id]?.status === 'active')
    .map(p => [p.id, round4(p.capacity - (used.get(p.id) ?? 0))]));
}

/** Give the task (or its review) to someone in its department with capacity, `prefer` first. Returns their id, or null. */
function assignFree(w: World, t: Task, exclude: string[], prefer?: string | null): string | null {
  if (t.status !== 'review' && pendingDependency(w.business, t) !== undefined) return null;
  const free = spare(w);
  const able = w.ids.filter(id => (free.get(id) ?? 0) > 0 && !exclude.includes(id) && w.business.positions[id].capabilities.includes(t.department));
  const pick = prefer && able.includes(prefer) ? prefer : able.sort((a, b) => (free.get(b)! - free.get(a)!) || w.ids.indexOf(a) - w.ids.indexOf(b))[0];
  if (!pick) return null;
  const allocation = Math.min(1, free.get(pick)!);
  if (t.status === 'review') { t.reviewer = pick; t.allocated = allocation; }
  else { t.owner = pick; t.status = 'active'; t.allocated = allocation; t.version++; }
  return pick;
}

function extend(w: World, t: Task, extraTurns: number, p: Params): string {
  const st = stateOf(w);
  const due = Math.min(t.deadline, nthOfficeTick(w.tick, Math.ceil(need(t) + extraTurns) + p.accountability.bufferTurns));
  const entry = st.internal[t.id] ?? { due, basis: t.deadline, feasible: true, since: w.tick };
  entry.due = Math.max(entry.due, due); st.internal[t.id] = entry;
  return `Moved the internal deadline to ${clockLabel(entry.due)}`;
}

/** Not the owner's fault: fix what blocked them. Returns a description of the fix (and any new chases). */
function fixBlocker(w: World, c: Chase, t: Task, block: BlockCode | null, p: Params, notices: ChaseNotice[]): string {
  const st = stateOf(w);
  const upstream = (id: string | undefined, label: string): string | null => {
    const u = w.business.tasks.find(x => x.id === id);
    if (!u) return null;
    const upNeed = need(u);
    if (u.status === 'active' && isEmployee(w, u.owner) && !st.chases.some(x => x.status === 'open' && x.taskId === u.id)) {
      notices.push(openChase(w, u, u.owner!, c.chaser, `“${short(t)}” is ${label} it`, p));
      return `Chased ${nameOf(w, u.owner)} about “${short(u)}” instead. ${extend(w, t, upNeed, p)}`;
    }
    if (!u.owner || !['active', 'review'].includes(u.status)) {
      const who = assignFree(w, u, u.status === 'review' && u.owner ? [u.owner] : []);
      if (who) return `${u.status === 'review' ? 'Assigned' : 'Gave'} ${nameOf(w, who)} “${short(u)}”, which it is ${label}. ${extend(w, t, upNeed, p)}`;
    }
    return extend(w, t, upNeed, p);
  };
  switch (block) {
    case 'DEPENDENCY_PENDING': return upstream(pendingDependency(w.business, t), 'waiting on') ?? extend(w, t, 0, p);
    case 'INPUT_NOT_RECEIVED': return upstream(String(inputDetails(w, t, c.owner).inputId ?? ''), 'waiting for an input from') ?? extend(w, t, 0, p);
    case 'SUPPLIER_OUTAGE': return extend(w, t, officeTurns(w.tick, w.business.supplierAvailableAt), p);
    case 'AWAITING_REVIEWER': {
      const who = assignFree(w, t, t.owner ? [t.owner] : []);
      return who ? `Assigned ${nameOf(w, who)} to review it` : extend(w, t, 0, p);
    }
    case 'WORK_NOT_OFFERED': {
      const who = assignFree(w, t, [], isEmployee(w, t.owner) ? t.owner : null);
      return who ? (who === c.owner ? 'Put it back on the active schedule' : `Reassigned it to ${nameOf(w, who)}`) : extend(w, t, 0, p);
    }
    default: return extend(w, t, 0, p);
  }
}

function meetingReason(w: World, c: Chase, t: Task): string {
  const counted = c.own + Object.values(c.blocked).reduce((n, x) => n + (x ?? 0), 0);
  return `missed the ${clockLabel(c.dueBy)} deadline on “${short(t)}”, spending ${c.own} of ${counted} working hours on other things while the work was there to do`;
}

function brief(w: World, boss: string, agent: string, outcome: MeetingOutcome, t: Task, reason: string, p: Params): MeetingBrief {
  const voice = (id: string) => { const card = w.speech?.voices[id]; return card ? describeVoice(card, null, false, p.voice) : ''; };
  return { outcome, boss: { name: nameOf(w, boss), voice: voice(boss) }, agent: { name: nameOf(w, agent), voice: voice(agent) },
    task: short(t), reason, limits: { publicMax: p.voice.words.publicMax, innerMax: p.voice.words.innerMax } };
}

async function writeLines(w: World, boss: string, b: MeetingBrief, provider: TurnProvider | null, mode: Mode): Promise<{ lines: MeetingLines; source: 'llm' | 'template' }> {
  if (provider && mode.startsWith('llm')) {
    const ctx: TurnContext = { tick: w.tick, mode, state: structuredClone(w.agents[boss].state), available: [], colleagues: [], claims: [], events: [], meeting: b };
    try {
      const lines = validMeetingLines(await provider(w.agents[boss].profile, ctx), b);
      if (lines) return { lines, source: 'llm' };
    } catch { /* templates below */ }
  }
  return { lines: templateMeetingLines(b), source: 'template' };
}

export interface ReviewResult { chases: ChaseNotice[]; meetings: MeetingScene[] }

/**
 * 17:00, after turns and the quit check: settle every chase due now. At most one meeting per person.
 * Cutscenes: every firing; otherwise `cutscenesPerDay` a day, the rest are summarised in the inbox.
 */
export async function reviewChases(w: World, provider: TurnProvider | null, mode: Mode, p: Params): Promise<ReviewResult> {
  const out: ReviewResult = { chases: [], meetings: [] };
  if (!p.accountability.enabled || !w.accountability || !isOfficeClose(w.tick)) return out;
  const st = w.accountability; const P = p.accountability;
  const called = new Map<string, { chase: Chase; task: Task; outcome: MeetingOutcome }>();
  for (const c of st.chases.filter(c => c.status === 'open' && c.dueBy <= w.tick)) {
    const t = w.business.tasks.find(x => x.id === c.taskId);
    if (!t || t.status === 'cancelled' || !isEmployee(w, c.owner)) { c.status = 'void'; continue; }
    const handedOver = t.owner !== c.owner && t.status !== 'review';
    if (!handedOver && (t.status === 'done' || t.status === 'review' || t.remaining <= c.expectRemaining + 1e-9)) { c.status = 'met'; st.stats.met++; continue; }
    // Ops gave it to someone else: judge the owner on the turns they had it; with no fault there is nothing to fix.
    if (handedOver && !ownerAtFault(c, p)) { c.status = 'void'; continue; }
    c.status = 'missed'; st.stats.missed++;
    const fault = ownerAtFault(c, p);
    const block = dominantBlock(c);
    const blockedTurns = Object.values(c.blocked).reduce((n, x) => n + (x ?? 0), 0);
    emit(w, t, 'deadline', 'CHASE_MISSED', 'warning', { owner: c.owner, dueBy: c.dueBy, ownTurns: c.own, blockedTurns, counted: c.own + blockedTurns,
      blocker: block ? BLOCK_TEXT[block] : '', fault: fault ? 'owner' : 'not_owner' }, c.owner);
    if (fault) {
      const outcome: MeetingOutcome = st.warnings[c.owner] ? 'fired' : 'warning';
      const prior = called.get(c.owner);
      if (!prior || (outcome === 'fired' && prior.outcome !== 'fired')) called.set(c.owner, { chase: c, task: t, outcome });
    } else {
      const manager = managementOwners(w).ops ?? c.chaser;
      const fix = fixBlocker(w, c, t, block, p, out.chases);
      st.stats.fixes++;
      emit(w, t, 'assignment', 'BLOCKER_FIXED_BY_MANAGER', 'info', { manager, owner: c.owner, fix, blocker: block ?? 'progress_short' }, manager);
    }
  }
  if (!called.size) return out;
  const boss = managementOwners(w).ceo;
  if (!boss) return out;
  const day = dayIndexOf(w.tick);
  // Firings first, then cast order: the order that cutscene slots are given out.
  const ordered = w.ids.filter(id => called.has(id)).sort((a, b) => Number(called.get(b)!.outcome === 'fired') - Number(called.get(a)!.outcome === 'fired'));
  const plans = ordered.map(id => {
    const { chase, task, outcome } = called.get(id)!;
    const cutscene = outcome === 'fired' || (st.cutscenes[day] ?? 0) < P.cutscenesPerDay;
    if (cutscene && outcome !== 'fired') st.cutscenes[day] = (st.cutscenes[day] ?? 0) + 1;
    const reason = meetingReason(w, chase, task);
    return { id, chase, task, outcome, cutscene, reason, brief: brief(w, boss, id, outcome, task, reason, p) };
  });
  // Lines are written before any effect, so every brief sees the same state; only cutscenes go to the model.
  const written = await Promise.all(plans.map(m => m.cutscene ? writeLines(w, boss, m.brief, provider, mode) : Promise.resolve({ lines: templateMeetingLines(m.brief), source: 'template' as const })));
  plans.forEach((m, i) => {
    const agent = w.agents[m.id];
    if (m.outcome === 'warning') {
      applyDelta(agent, P.warning, p);
      st.warnings[m.id] = { tick: w.tick, taskId: m.task.id, expires: w.tick + days(P.warningDays) };
      st.stats.warnings++;
      // The improvement they are now judged on: the same task, by tomorrow's close.
      if (m.task.status === 'active' && m.task.owner === m.id) out.chases.push(openChase(w, m.task, m.id, managementOwners(w).ops ?? boss, 'Warned by the CEO; this is the improvement expected', p));
    } else {
      agent.status = 'laid_off'; agent.quitTick = w.tick; agent.present = false;
      delete st.warnings[m.id];
      for (const c of st.chases) if (c.status === 'open' && c.owner === m.id) c.status = 'void';
      st.stats.firings++;
      for (const id of w.ids) if (id !== m.id && w.agents[id].status === 'active') applyDelta(w.agents[id], P.firingWitness, p);
    }
    const scene: MeetingScene = { id: `meeting-${w.tick}-${m.id}`, tick: w.tick, boss, agent: m.id, taskId: m.task.id, taskTitle: m.task.title,
      outcome: m.outcome, reason: m.reason, cutscene: m.cutscene, source: written[i].source, lines: written[i].lines };
    st.meetings.push(scene); out.meetings.push(scene);
    emit(w, m.task, 'disruption', 'MEETING_OUTCOME', m.outcome === 'fired' ? 'critical' : 'warning',
      { boss, agent: m.id, outcome: m.outcome, reason: m.reason.charAt(0).toUpperCase() + m.reason.slice(1), meetingId: scene.id, cutscene: m.cutscene ? 1 : 0, warningDays: P.warningDays }, m.id);
  });
  return out;
}
