import { z } from 'zod';
import { companyObjectiveLimits, isCompanyObjectiveText, type CompanyActivity, type CompanyTask, type CompanyTaskStatus, type CompanyTaskSummary, type SubmitCompanyTask } from '../../shared/companyTasks';
import type { World } from '../engine-types';
import { companyLimits } from './config';

export const submissionSchema = z.object({
  run_id: z.string().min(1).max(80),
  idempotency_key: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/),
  objective: z.string().trim().min(companyObjectiveLimits.minLength).max(companyObjectiveLimits.maxLength)
    .refine(isCompanyObjectiveText, 'Enter a hypothetical objective in plain text'),
  deadline_ticks: z.number().int().min(companyLimits.minDeadline).max(companyLimits.maxDeadline).optional(),
}).strict() satisfies z.ZodType<SubmitCompanyTask>;

const terminal = new Set<CompanyTaskStatus>(['completed', 'failed', 'abandoned']);
export const activeCompanyTask = (w: World) => w.companyTasks?.find(task => !terminal.has(task.status));

export function newCompanyTask(input: SubmitCompanyTask, w: World): CompanyTask {
  return {
    id: `company-${input.run_id}-${(w.companyTasks?.length ?? 0) + 1}`,
    runId: input.run_id, objective: input.objective, idempotencyKey: input.idempotency_key,
    requestedDeadline: input.deadline_ticks, submittedTick: w.tick, status: 'queued',
    work: {}, findings: [], activity: [], displaced: {},
  };
}

export function taskSummary(task: CompanyTask): CompanyTaskSummary {
  const { id, runId, objective, status, submittedTick, activatedTick, deadlineTick, missedDeadlineTick, outcome } = task;
  return { id, runId, objective, status, submittedTick, activatedTick, deadlineTick, missedDeadlineTick, outcome };
}

export function addActivity(task: CompanyTask, tick: number, event: Omit<CompanyActivity, 'id' | 'companyTaskId' | 'tick' | 'order'>) {
  const order = task.activity.length + 1;
  const activity: CompanyActivity = { ...event, id: `${task.id}-activity-${order}`, companyTaskId: task.id, tick, order };
  task.activity.push(activity);
  return activity;
}

export function tickActivity(w: World): CompanyActivity[] | undefined {
  const entries = w.companyTasks?.flatMap(task => task.activity.filter(entry => entry.tick === w.tick));
  return entries?.length ? entries : undefined;
}
