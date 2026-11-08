// Accountability: the ops manager chases late work at stand-up; an owner who misses through their own
// choices is warned once by the CEO, and fired if it happens again. Rules decide; the LLM only writes lines.
// Additive contract: TickFrame.accountability (shared/api.ts).

export type MeetingOutcome = 'warning' | 'fired';
export const OUTCOME_LABEL: Record<MeetingOutcome, string> = { warning: 'Warning', fired: 'Fired' };

/** A manager chasing a task's owner at stand-up. */
export interface ChaseNotice {
  id: string;
  tick: number;
  taskId: string;
  taskTitle: string;
  chaser: string;
  owner: string;
  /** End of the next working day (17:00). */
  dueBy: number;
  /** Remaining effort the task must be down to by then (0 = done). */
  expectRemaining: number;
  /** The chaser's line to the owner (templated). */
  line: string;
}

/** A meeting with the boss: the outcome is decided by rules; the lines are written by the LLM or templates. */
export interface MeetingScene {
  id: string;
  tick: number;
  boss: string;
  agent: string;
  taskId: string;
  taskTitle: string;
  outcome: MeetingOutcome;
  /** Why they were called in, in words. */
  reason: string;
  /** Played as a cutscene (at most one a day, except firings, which always play). */
  cutscene: boolean;
  source: 'llm' | 'template';
  lines: { boss: string; reply: string; inner: string };
}

export interface AccountabilityFrame {
  chases: ChaseNotice[];
  meetings: MeetingScene[];
}
