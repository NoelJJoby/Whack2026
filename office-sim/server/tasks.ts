import { canUseCompanyWork } from './company-tasks/collaboration';
import type { Decision, EngineAgent, Proposal, TurnContext, World } from './engine-types';
import type { Task } from '../shared/business';
import { BUSINESS_PARAMS, post, signContract } from './business';
import { days } from '../shared/workday';
import { addEvidence, managementOwners, openEvent } from './events/lifecycle';
import { consumeSlot } from './events/scheduler';
import { stream } from './rng';
import { employeeSchema } from './llm/schemas';
export function workContext(w: World, agent: EngineAgent): NonNullable<TurnContext['work']> {
  const tasks = w.business.tasks;
  const assignments = tasks.filter(t => t.owner === agent.id && t.status === 'active' && canUseCompanyWork(w, t.id, agent.id));
  const reviewable = tasks.filter(t => t.status === 'review' && t.reviewer === agent.id && t.allocated > 0);
  const supportable = tasks.filter(t => t.owner && t.owner !== agent.id && t.status === 'active' && w.business.positions[agent.id].capabilities.includes(t.department) && canUseCompanyWork(w, t.id, t.owner)).map(t => ({ taskId: t.id, colleagueId: t.owner!, version: t.version }));
  const eventIds = new Set([...assignments,...reviewable].map(t => t.eventId));
  return { schemaVersion: 1, revision: w.tick, supervisor: managementOwners(w).ops, role: w.business.positions[agent.id].role,
    assignments: structuredClone(assignments), reviewable: structuredClone(reviewable), supportable,
    evidence: structuredClone(w.eventState.evidence.filter(e => e.deliveryTick <= w.tick && e.recipients.includes(agent.id) && (w.eventState.cases.some(c => c.id === e.eventId && !['resolved','failed','cancelled','superseded'].includes(c.status)) || w.tick-e.tick <= days(1)))),
    directives: structuredClone(w.eventState.directives.filter(d => d.active && eventIds.has(d.eventId))) };
}
export function validEmployeeOutput(raw: unknown, ctx: TurnContext): unknown {
  if (!ctx.work) return raw;
  const output = employeeSchema.parse(raw);
  for (const p of output.proposals) {
    if (!ctx.available.includes(p.action)) throw new Error('Unavailable employee action');
    if ('task_id' in p) {
      const task = [...ctx.work.assignments,...ctx.work.reviewable].find(t => t.id === p.task_id);
      if (p.action === 'support_colleague') {
        if (!ctx.work.supportable.some(s => s.taskId === p.task_id && s.colleagueId === p.target && s.version === p.assignment_version)) throw new Error('Invalid support reference');
      } else if (!task || task.version !== p.assignment_version || (p.action === 'review_work' ? !ctx.work.reviewable.some(t => t.id === task.id) : !ctx.work.assignments.some(t => t.id === task.id))) throw new Error('Invalid/stale assignment');
    }
    if (p.action === 'report_issue' && (!ctx.work.evidence.some(e => e.id === p.evidence_id) || ![ctx.work.supervisor,...ctx.colleagues.filter(c => ['ceo','ops'].includes(c.id)).map(c => c.id)].includes(p.target))) throw new Error('Unknown evidence or invalid recipient');
    if ('target' in p && p.target && !ctx.colleagues.some(c => c.id === p.target)) throw new Error('Unknown colleague');
    if ('claim' in p && p.claim && !ctx.claims.some(c => c.id === p.claim)) throw new Error('Unknown claim');
  }
  return output;
}
export function fallbackWork(w: World, agent: EngineAgent): Proposal | null {
  const ctx = workContext(w,agent); const review = ctx.reviewable[0]; const task = ctx.assignments[0];
  return review ? { action: 'review_work', weight: 1, task_id: review.id, assignment_version: review.version } : task ? { action: 'work', weight: 1, task_id: task.id, assignment_version: task.version } : null;
}
function completeTask(w: World, t: Task) {
  t.status = 'done'; t.allocated = 0;
  const b = w.business; const event = w.eventState.cases.find(e => e.id === t.eventId);
  const contract = b.contracts.find(c => c.id === t.contractId);
  if (contract && contract.recognised === 0) {
    const amount = contract.value; post(w,{ id: `${contract.id}-revenue`, tick: w.tick, category: 'revenue', amount, source: t.eventId ?? t.id });
    contract.recognised = amount; contract.status = 'earned'; contract.paymentTick = w.tick + days(1);
  }
  if (t.kind === 'collection' && b.receivables > 0 && !b.contracts.some(c => c.status === 'earned')) {
    post(w,{ id: `${t.id}-cash`, tick: w.tick, category: 'collection', amount: Math.min(b.receivables,3_000_000), source: t.eventId ?? t.id });
  }
  if (t.kind === 'process' || t.kind === 'support') b.controls = Math.min(0.8,b.controls+0.08);
  if (t.kind === 'optimisation') {
    const savings = Math.min(10_000,Math.max(0,b.dailyInfrastructure-20_000)); b.dailyInfrastructure -= savings;
    post(w,{ id: `${t.id}-saving`, tick: w.tick, category: 'saving', amount: savings, source: t.eventId ?? t.id });
  }
  if (t.kind === 'supplier' && event?.templateId === 'supplier_discount') {
    const savings = Math.min(10_000,Math.max(0,b.dailyDiscretionary-5_000)); b.dailyDiscretionary -= savings;
    post(w,{ id: `${t.id}-saving`, tick: w.tick, category: 'saving', amount: savings, source: event.id });
  }
  if (t.kind === 'containment' && event) event.contained = true;
  if (t.kind === 'cost_cut' && event) {
    const choice = [...w.eventState.decisions].reverse().flatMap(d => d.choices).find(c => c.eventId === event.id);
    const kind = choice?.optionId.split(':')[1]; const target = event.value;
    const rate = kind === 'renegotiate' ? 'dailyInfrastructure' : 'dailyDiscretionary';
    if (b[rate] >= target) { b[rate] -= target; post(w,{ id: `${t.id}-saving`, tick: w.tick, category: 'saving', amount: target, source: event.id }); event.outcome = 'Operating savings target met; layoffs avoided.'; }
    else { t.status = 'blocked'; event.outcome = 'Savings plan became infeasible; management review required.'; }
  }
  if (event && ['partnership','major_renewal','company_adoption','expansion','renewal'].includes(event.templateId) && !b.contracts.some(c => c.id === `contract-${event.id}`)) {
    const id = signContract(w,event.id,event.entityId);
    if (id) {
      const delivery: Task = { ...t, id: `delivery-${event.id}`, kind: 'delivery', department: 'Engineering', title: 'Deliver signed client obligations', contractId: id, owner: null, status: 'pending', effort: 5, remaining: 5, reviewed: false, reviewRequired: true, error: false, allocated: 1, deadline: w.tick+days(3.6), dependencies: [], version: 1 };
      b.tasks.push(delivery); event.tasks.push(delivery.id); event.deadline = Math.max(event.deadline,delivery.deadline);
      event.value = b.contracts.find(c => c.id === id)!.value;
    }
  }
  if (event) event.milestones.push({ tick: w.tick, text: `Completed ${t.id}: ${t.title}` });
  // Material, attributable release outcomes become one causal root and replace a scheduled slot.
  if (!t.eventId && t.kind === 'release' && t.reviewed && !t.error && !(w.eventState.cooldowns.release_success > w.tick)) {
    const e = openEvent(w,'release_success','employee',true,undefined,false,t.id);
    e.tasks.push(t.id); e.status = 'resolved'; e.outcome = 'Reviewed release completed successfully.';
    consumeSlot(w,'common','replaced_by_work_outcome',e.id);
  }
}
export function executeWork(w: World, agent: EngineAgent, decision: Decision, remainingAttention?: number): string {
  const b = w.business; const ctx = workContext(w,agent); let progress = 0; let outcome = 'Time spent away from assigned delivery';
  const t = b.tasks.find(t => t.id === decision.task_id);
  const current = t && t.version === decision.assignment_version;
  if (remainingAttention !== undefined && (
    (decision.action === 'report_issue' || decision.action === 'support_colleague') && remainingAttention < 1
    || decision.action === 'review_work' && t && remainingAttention < t.allocated
  )) {
    outcome = 'Task coordination left insufficient time for a full-turn action';
  } else if (decision.action === 'report_issue') {
    const evidence = w.eventState.evidence.find(e => e.id === decision.evidence_id && e.recipients.includes(agent.id));
    const event = w.eventState.cases.find(e => e.id === evidence?.eventId);
    if (event && evidence && decision.target && w.agents[decision.target]?.status === 'active') {
      addEvidence(w,event,evidence.text,agent.id,[decision.target],evidence.certainty,w.tick+1); outcome = 'Known evidence reported to management';
    } else outcome = 'Report rejected: no known evidence';
  } else if (decision.action === 'review_work' && current && t.status === 'review' && t.reviewer === agent.id && t.owner !== agent.id) {
    t.reviewed = true; delete t.reviewer; progress = t.allocated; b.used += progress;
    if (t.error) { t.error = false; t.remaining = 1; t.status = 'pending'; outcome = 'Review caught a defect; rework required'; }
    else { completeTask(w,t); outcome = 'Independent review passed'; }
  } else if (decision.action === 'support_colleague' && current && t.status === 'active' && t.owner === decision.target && ctx.supportable.some(s => s.taskId === t.id)) {
    // Support consumes this employee's turn, improves controls, and cannot add free delivery progress.
    b.controls = Math.min(0.8,b.controls+0.01); b.used += 1; outcome = 'Colleague support improved preventive controls';
  } else if ((decision.action === 'work' || decision.action === 'overwork') && current && t.owner === agent.id && t.status === 'active' && agent.status === 'active') {
    if (t.dependencies.some(id => b.tasks.find(t => t.id === id)?.status !== 'done')) outcome = 'Blocked by incomplete dependency';
    else if (!canUseCompanyWork(w, t.id, agent.id)) outcome = 'Blocked until the required finding is delivered';
    else if (w.tick < b.supplierAvailableAt && ['delivery','release','onboarding'].includes(t.kind)) outcome = 'Blocked by supplier; work remains outstanding';
    else {
      progress = Math.min(t.remaining,Math.min(t.allocated, remainingAttention ?? t.allocated)*(decision.action === 'overwork' ? 1.2 : 1));
      t.remaining = Math.max(0,Number((t.remaining-progress).toFixed(4))); b.used += Math.min(remainingAttention ?? 1,progress);
      outcome = 'Assigned work advanced';
      if (t.remaining === 0) {
        const risk = Math.max(0.002,Math.min(BUSINESS_PARAMS.errorMax,(BUSINESS_PARAMS.errorBase + agent.state.burnout/100*BUSINESS_PARAMS.fatigueError + Math.max(0,agent.state.workload-70)/30*BUSINESS_PARAMS.overloadError)*(1-b.controls)*(t.reviewed ? 1-BUSINESS_PARAMS.reviewReduction : 1)));
        t.error = stream(w.seed,w.tick,`${t.id}-quality`,'event').chance(risk);
        if (t.reviewRequired && !t.reviewed) { t.status = 'review'; t.allocated = 0; outcome = 'Work awaits independent review'; }
        else { completeTask(w,t); outcome = 'Acceptance work completed'; }
        if (t.error && ['release','delivery'].includes(t.kind) && !w.eventState.cases.some(e => e.domain === 'security' && !e.contained && e.truth)) {
          const e = openEvent(w,'configuration_error','employee',true,undefined,true,agent.id);
          addEvidence(w,e,'An access configuration check found a possible exposure.',agent.id,[agent.id],'suspected');
          consumeSlot(w,'common','replaced_by_employee_error',e.id);
        }
      }
    }
  } else if (['work','overwork','review_work','support_colleague'].includes(decision.action)) outcome = 'No eligible current assignment; no productive output';
  const result = { id: `work-${w.tick}-${agent.id}`, tick: w.tick, agent: agent.id, taskId: t?.id ?? null, action: decision.action, progress, outcome, directiveVersion: t?.directiveId ? w.eventState.directives.find(d => d.id === t.directiveId)?.version ?? null : null };
  b.work.push(result);
  return outcome;
}
