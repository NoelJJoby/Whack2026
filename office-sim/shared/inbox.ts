// Task diagnostics: why a task isn't progressing (server/diagnostics/*), and the inbox
// threads built from them. Additive contract: TickFrame.inbox and HistoryResponse.inbox_base.
import { workdayTime } from './workday';

export type Stage = 'assignment' | 'choice' | 'execution' | 'quality' | 'review' | 'deadline' | 'disruption' | 'completion';
export type Severity = 'info' | 'warning' | 'critical';

export const REASON_CODES = [
  // assignment
  'UNASSIGNED', 'ON_HOLD', 'REJECTED_NO_CAPABILITY', 'REJECTED_OVER_CAPACITY', 'REJECTED_SELF_REVIEW', 'REJECTED_DEPS_NOT_DONE', 'REJECTED_INVALID',
  // choice
  'CHOSE_OTHER_ACTION', 'WORK_NOT_OFFERED',
  // execution
  'STALE_ASSIGNMENT', 'DEPENDENCY_PENDING', 'INPUT_NOT_RECEIVED', 'SUPPLIER_OUTAGE', 'NO_TIME_AFTER_COORDINATION', 'PARTIAL_PROGRESS', 'PROGRESS_MADE',
  // quality
  'HIGH_DEFECT_RISK', 'DEFECT_LINKED', 'DEFECT_SURFACED',
  // review
  'AWAITING_REVIEWER', 'REWORK_AFTER_REVIEW',
  // deadline
  'AT_RISK', 'OVERDUE', 'CASE_FAILED',
  // disruption
  'OWNER_LEFT', 'SAVINGS_TARGET_MISSED',
  // completion
  'COMPLETED',
  // accountability (server/accountability.ts): timeline entries, never blockers
  'DEADLINE_INFEASIBLE', 'CHASED', 'CHASE_MISSED', 'BLOCKER_FIXED_BY_MANAGER', 'MEETING_OUTCOME',
] as const;
export type ReasonCode = typeof REASON_CODES[number];

/** One engine decision about a task, recorded at the point the engine made it. */
export interface TaskEvent {
  /** Internal tick; the UI shows days and clock times. */
  turn: number;
  taskId: string;
  caseId?: string;
  agentId?: string;
  stage: Stage;
  code: ReasonCode;
  details: Record<string, string | number>;
  severity: Severity;
}

export interface InboxMessage {
  id: string;
  tick: number;
  /** Last tick the same reason was seen; `count` is how many ticks it has held. */
  lastTick: number;
  count: number;
  stage: Stage;
  code: ReasonCode;
  severity: Severity;
  headline: string;
  why: string[];
  unblock: string | null;
}

export type ThreadStatus = 'blocked' | 'at_risk' | 'resolved';

export interface InboxThread {
  id: string;
  taskId: string;
  title: string;
  /** Business case (event) id, when the task belongs to one. */
  caseId?: string;
  /** Company objective id, when the task is objective work. */
  objectiveId?: string;
  ownerId: string | null;
  /** People named in the thread, owner first (portraits and focus buttons). */
  agentIds: string[];
  deadline: number;
  contractLinked: boolean;
  status: ThreadStatus;
  severity: Severity;
  primary: { stage: Stage; code: ReasonCode } | null;
  /** Other current blockers, one line each, in pipeline order. */
  also: string[];
  messages: InboxMessage[];
  openedTick: number;
  updatedTick: number;
  resolution?: { tick: number; summary: string };
}

export interface InboxToast { threadId: string; messageId: string; headline: string }

/** Threads changed this tick, plus new critical alerts. */
export interface InboxDelta { threads: InboxThread[]; toasts: InboxToast[] }

/** Pipeline order for the primary blocker: the earliest failing stage is the bottleneck. */
export const STAGE_RANK: Record<Stage, number> = {
  disruption: 0, assignment: 1, choice: 2, execution: 3, quality: 4, review: 5, deadline: 6, completion: 7,
};
export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

/** Same format as the HUD's timeLabel: "Day 16 (M1), 09:00". */
export function clockLabel(tick: number): string {
  const { month, dayOfMonth, hour } = workdayTime(tick);
  return `Day ${dayOfMonth} (M${month}), ${String(hour).padStart(2, '0')}:00`;
}

/** Fold a delta onto a thread list (client playback and the server's history base). */
export function applyInboxDelta(threads: InboxThread[], delta: InboxDelta | undefined): InboxThread[] {
  if (!delta?.threads.length) return threads;
  const byId = new Map(threads.map(t => [t.id, t]));
  for (const t of delta.threads) byId.set(t.id, t);
  return [...byId.values()];
}
