import { z } from 'zod';
import type { Department } from '../../shared/business';
import type { CompanySource, CompanyTask } from '../../shared/companyTasks';
import { makeTask } from '../business';
import type { Mode, TurnProvider, World } from '../engine-types';
import { managementOwners } from '../events/lifecycle';
import type { CallMetrics } from '../llm/client';
import { withRequestMetrics } from '../llm/telemetry';
import { isPresent } from '../presence';
import { companyLimits } from './config';
import { activeCompanyTask, addActivity } from './state';

const briefLine = z.string().trim().min(4).max(240);
const planSchema = z.object({
  assumptions: z.array(briefLine).min(1).max(4),
  constraints: z.array(briefLine).min(1).max(4),
  rationale: briefLine,
  effect: z.enum(['ordinary_work', 'reviewed_release']),
  work: z.array(z.object({
    title: z.string().trim().min(4).max(140),
    category: z.enum(['research', 'planning', 'engineering', 'coordination']),
    department: z.enum(['Sales', 'Engineering', 'Operations']),
    effort: z.number().int().min(1).max(5),
    dependsOn: z.array(z.number().int().min(1).max(5)).max(4),
    acceptance: briefLine,
  }).strict()).min(3).max(6),
}).strict();
type Plan = z.infer<typeof planSchema>;
type Staffing = Record<Department, number>;

const isRelease = (objective: string) => /\b(launch|release|rollout|roll out|ship)\b/i.test(objective);

function validatePlan(raw: unknown, task: CompanyTask, staffing: Staffing): Plan {
  const plan = planSchema.parse(raw);
  const ancestors = new Set<number>();
  for (const [index, work] of plan.work.entries()) {
    if (new Set(work.dependsOn).size !== work.dependsOn.length || work.dependsOn.some(i => i > index)) throw new Error('Invalid dependency order');
    if (work.category === 'research' && work.department !== 'Sales' || work.category === 'engineering' && work.department !== 'Engineering' || work.category === 'coordination' && work.department !== 'Operations') throw new Error('Invalid department capability');
  }
  const visit = (index: number) => {
    if (ancestors.has(index)) return;
    ancestors.add(index);
    plan.work[index - 1].dependsOn.forEach(visit);
  };
  visit(plan.work.length);
  if (ancestors.size !== plan.work.length) throw new Error('Final acceptance must depend on all work');
  const final = plan.work[plan.work.length - 1];
  if (staffing[final.department] < 2 && Object.values(staffing).some(count => count >= 2)) throw new Error('Final acceptance needs an independent qualified reviewer');
  if (plan.effect === 'reviewed_release' && (!isRelease(task.objective) || plan.work.at(-1)?.category !== 'engineering')) throw new Error('Release effect requires an engineering release objective');
  return plan;
}

function rulesPlan(objective: string, staffing: Staffing): Plan {
  const release = isRelease(objective);
  const market = release || /\b(demand|customer|market|sales|pricing|research|partner|positioning|survey)\b/i.test(objective);
  const technical = release || /\b(build|implement|prototype|software|engineering|system|code|migration|migrate|security|performance|website|app)\b/i.test(objective);
  const finalDepartment = technical || staffing.Sales < 2 && staffing.Engineering >= 2 ? 'Engineering' : 'Sales';
  const label = objective.replace(/\s+/g, ' ').replace(/[.!?]+$/, '').slice(0, 76);
  return {
    assumptions: [market ? 'Customer evidence comes from a synthetic set of buyer scenarios.' : 'The current service and staffing are the starting point.', 'The company may narrow delivery to a testable pilot within existing capacity.'],
    constraints: ['Protect signed client obligations and urgent incident response.', 'Use simulated evidence and delivery only.'],
    rationale: 'Stage the work so the delivery team can validate its assumptions before independent acceptance.',
    effect: release ? 'reviewed_release' : 'ordinary_work',
    work: [
      { title: `${market ? 'Research customer needs' : 'Identify operating constraints'} · ${label}`, category: market ? 'research' : 'coordination', department: market ? 'Sales' : 'Operations', effort: 2, dependsOn: [], acceptance: market ? 'Record a simulated priority segment, buying constraint and pilot signal.' : 'Identify the most consequential operating constraint and a testable mitigation.' },
      { title: `${technical ? 'Design a pilot' : 'Plan a response'} · ${label}`, category: technical ? 'engineering' : 'planning', department: technical ? 'Engineering' : market ? 'Sales' : 'Operations', effort: 2, dependsOn: [1], acceptance: 'Use the received findings to choose a bounded approach and define an acceptance check.' },
      { title: `${release ? 'Validate the launch pilot' : 'Validate the proposed outcome'} · ${label}`, category: technical ? 'engineering' : 'planning', department: finalDepartment, effort: 2, dependsOn: [2], acceptance: 'Pass independent review against the proposed approach and the original objective.' },
    ],
  };
}

export async function prepareCompanyTask(w: World, provider: TurnProvider | null, mode: Mode, onPhase: (phase: string) => void, assertCurrent: () => void) {
  const task = activeCompanyTask(w);
  if (task?.status !== 'queued') return;
  const actor = managementOwners(w).ceo;
  if (!actor || !isPresent(w, actor)) return;

  onPhase('CEO briefing the company');
  const staffing: Staffing = { Sales: 0, Engineering: 0, Operations: 0 };
  for (const position of Object.values(w.business.positions)) {
    if (position.role === 'employee' && w.agents[position.id].status === 'active') {
      for (const department of position.capabilities) staffing[department]++;
    }
  }
  const deadlineTick = w.tick + (task.requestedDeadline ?? companyLimits.defaultDeadline) - 1;
  let plan: Plan | undefined;
  let source: CompanySource = mode.startsWith('llm') ? 'fallback' : 'rules';
  let attempts = 0;
  const metrics: CallMetrics[] = [];
  if (mode.startsWith('llm') && provider) {
    for (let i = 0; i < 2; i++) {
      attempts++;
      try {
        const raw = await withRequestMetrics(metrics, () => provider(w.agents[actor].profile, {
          tick: w.tick, mode, state: structuredClone(w.agents[actor].state), available: [], colleagues: [], claims: [], events: [],
          companyTurn: { kind: 'brief', objective: task.objective, deadlineTick, staffing },
        }));
        plan = validatePlan(raw, task, staffing);
        source = 'model';
      } catch {
        // Unusable proposals fall back to the same bounded canonical work contract.
      }
      assertCurrent();
      if (plan) break;
    }
  }
  plan ??= rulesPlan(task.objective, staffing);

  // Work IDs stay seed-replayable across runs. The public objective ID remains run-scoped.
  const missionIndex = w.companyTasks!.indexOf(task) + 1;
  const workIds = plan.work.map((_, i) => `company-work-${missionIndex}-${i + 1}`);
  const duration = deadlineTick - w.tick + 1;
  for (const [index, spec] of plan.work.entries()) {
    const id = workIds[index];
    const final = index === plan.work.length - 1;
    const kind = final && plan.effect === 'reviewed_release' ? 'release' : spec.department === 'Engineering' ? 'delivery' : spec.department === 'Sales' ? 'sales' : 'process';
    const deadline = w.tick + Math.ceil(duration * (index + 1) / plan.work.length) - 1;
    const work = makeTask(id, kind, spec.department, spec.title, spec.effort, deadline);
    work.priority = 2;
    work.reviewRequired = final;
    work.dependencies = spec.dependsOn.map(i => workIds[i - 1]);
    work.allocated = 0;
    w.business.tasks.push(work);
    task.work[id] = {
      taskId: id, category: spec.category, acceptance: spec.acceptance, requiredInputs: work.dependencies.slice(),
      producesFinding: plan.work.some(next => next.dependsOn.includes(index + 1)), consumedFindings: {}, rework: 0,
    };
  }
  task.brief = { version: 1, author: actor, objective: task.objective, assumptions: plan.assumptions, constraints: plan.constraints,
    successCriteria: plan.work.map(work => work.acceptance), deadlineTick, effect: plan.effect, workIds };
  task.deadlineTick = deadlineTick;
  task.activatedTick = w.tick;
  task.status = 'delegated';
  const recipients = w.ids.filter(id => id !== actor && isPresent(w, id));
  addActivity(task, w.tick, {
    round: 0, actor, recipients, kind: 'brief', location: 'executive office',
    dialogue: `Our objective is “${task.objective}”. ${plan.assumptions.join(' ')} Ops, assign the acceptance work by tick ${deadlineTick}.`,
    decision: {
      authority: w.business.positions[actor].role === 'ceo' ? 'ceo' : 'acting', question: 'How should the company pursue this objective?',
      options: ['Stage a scoped pilot', 'Commit to a broader delivery', 'Defer until more capacity is available'],
      explanation: plan.rationale, evidence: [], workIds, briefVersion: 1, source,
      ...(source === 'fallback' ? { fallback: 'No validated CEO plan' } : {}),
      ...(attempts ? { inference: {
        attempts, latencyMs: metrics.length ? metrics.reduce((n, m) => n + m.latencyMs, 0) : null,
        inputTokens: metrics.reduce((n, m) => n + (m.usage?.promptTokens ?? 0), 0),
        outputTokens: metrics.reduce((n, m) => n + (m.usage?.completionTokens ?? 0), 0),
      } } : {}),
    },
  });
}
