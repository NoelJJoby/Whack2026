// Company objective (the CEO's task) and business situations, in plain language for the HUD.
import type { Task } from '../shared/business';
import type { CompanyActivity, CompanyTask, CompanyTaskStatus, WorkCategory } from '../shared/companyTasks';
import type { BusinessEvent, EventStatus } from '../shared/events';

/** Work titles repeat the whole objective ("Research customer needs · <objective>"); keep the first part. */
export const shortTitle = (title: string) => title.split(' · ')[0];
/** The same, inside quoted titles in dialogue. */
export const shortenQuoted = (text: string) => text.replace(/“([^”]*?) · [^”]*”/g, '“$1”');

/** Exchanges people actually say; engine bookkeeping (progress, holds, restores) stays in the work log. */
export const SPOKEN: ReadonlySet<CompanyActivity['kind']> = new Set(['brief', 'assignment', 'message', 'priority', 'deadline', 'departure', 'outcome']);
export const isSpoken = (a: CompanyActivity) => SPOKEN.has(a.kind) && Boolean(a.actor) && Boolean(a.dialogue.trim());

export const ACTIVITY_LABEL: Record<CompanyActivity['kind'], string> = {
  brief: 'CEO brief', assignment: 'Assignment', displacement: 'Put on hold', restored: 'Back in the pool', message: 'Team chat',
  deferred_message: 'Chat postponed', priority: 'Priorities', progress: 'Progress', review: 'Review', deadline: 'Deadline', departure: 'Departure', outcome: 'Objective result',
};

export const OBJECTIVE_STATUS: Record<CompanyTaskStatus, { text: string; tone: 'mint' | 'coral' | 'gold' | '' }> = {
  queued: { text: 'Waiting for the CEO', tone: 'gold' }, delegated: { text: 'Briefed', tone: 'gold' }, in_progress: { text: 'In progress', tone: '' },
  blocked: { text: 'Blocked', tone: 'coral' }, review: { text: 'In review', tone: 'gold' }, completed: { text: 'Done', tone: 'mint' },
  failed: { text: 'Failed', tone: 'coral' }, abandoned: { text: 'Abandoned', tone: 'coral' },
};
export const CATEGORY_LABEL: Record<WorkCategory, string> = { research: 'Research', planning: 'Planning', engineering: 'Engineering', coordination: 'Coordination' };
export const isActiveObjective = (status: CompanyTaskStatus) => !['completed', 'failed', 'abandoned'].includes(status);

export type WorkState = 'waiting' | 'unassigned' | 'working' | 'review' | 'done' | 'paused';
export interface WorkRow {
  id: string; title: string; category: WorkCategory; acceptance: string;
  owner: string | null; reviewer: string | null; state: WorkState;
  /** 0-1 of the task's effort. */
  progress: number; rework: number;
  /** Titles of the work whose findings this one still needs. */
  needs: string[];
}

/** Work items of an objective, read from the presented task list so they match playback. */
export function workRows(task: Pick<CompanyTask, 'brief' | 'work' | 'findings'>, tasks: Task[]): WorkRow[] {
  return (task.brief?.workIds ?? Object.keys(task.work)).flatMap(id => {
    const meta = task.work[id]; const t = tasks.find(x => x.id === id);
    if (!meta) return [];
    const done = t?.status === 'done' || (meta.completedTick !== undefined && !t);
    // The engine lets work advance only once its assignee knows each required finding.
    const owner = t?.owner ?? null;
    const needs = done ? [] : meta.requiredInputs.filter(input => !task.findings.some(f => f.taskId === input && (!owner || f.knownBy.includes(owner))))
      .map(input => shortTitle(tasks.find(x => x.id === input)?.title ?? input));
    const state: WorkState = done ? 'done' : t?.status === 'review' ? 'review' : needs.length ? 'waiting'
      : !t?.owner ? 'unassigned' : t.status === 'active' ? 'working' : 'paused';
    return [{ id, title: shortTitle(t?.title ?? id), category: meta.category, acceptance: meta.acceptance,
      owner: t?.owner ?? null, reviewer: t?.reviewer ?? null, state, progress: done ? 1 : t ? Math.max(0, Math.min(1, 1 - t.remaining / t.effort)) : 0,
      rework: meta.rework, needs }];
  });
}
export const WORK_STATE_LABEL: Record<WorkState, string> = { waiting: 'Waiting for findings', unassigned: 'Not assigned yet', working: 'In progress', review: 'In review', done: 'Done', paused: 'On hold' };

/** Hours until (or since, negative) a deadline, as words. */
export function dueIn(deadline: number, now: number) {
  const h = deadline - now;
  return h > 0 ? `due in ${h}h` : h === 0 ? 'due now' : `${-h}h overdue`;
}

export const SITUATION_STATUS: Record<EventStatus, { text: string; tone: 'mint' | 'coral' | 'gold' | '' }> = {
  open: { text: 'Awaiting the CEO', tone: 'gold' }, responding: { text: 'Being handled', tone: '' }, monitoring: { text: 'Being watched', tone: 'gold' },
  resolved: { text: 'Resolved', tone: 'mint' }, failed: { text: 'Missed its deadline', tone: 'coral' }, cancelled: { text: 'Closed', tone: '' }, superseded: { text: 'Replaced', tone: '' },
};
export const isOpenSituation = (e: BusinessEvent) => ['open', 'responding', 'monitoring'].includes(e.status);

/** A CEO option id ("event-3-1:layoff:sam") as words. */
export function planLabel(optionId: string, name: (id: string) => string) {
  const [, kind, who] = optionId.split(':');
  return ({ respond: 'Fund the response work', monitor: 'Watch and wait', reduce_spend: 'Cut discretionary tooling', renegotiate: 'Renegotiate infrastructure costs',
    postpone: 'Postpone discretionary projects', layoff: `Lay off ${who ? name(who) : 'a team member'}` } as Record<string, string>)[kind] ?? kind;
}

/** Objective n's work items are `company-work-n-…` (n counts objectives in the run, from 1). */
export const objectiveWorkPrefix = (objectiveId: string) => `company-work-${objectiveId.split('-').at(-1)}-`;
export const isObjectiveWork = (taskId: string) => taskId.startsWith('company-work-');
