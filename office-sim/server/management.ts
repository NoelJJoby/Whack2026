import { companySchedulingView, prepareCompanySchedule, recordCompanySchedule, validateCompanyAssignments, type CompanySchedule } from './company-tasks/adapter';
import type { BusinessOption, ManagementContext, ManagementDecision } from '../shared/events';
import type { World, TurnProvider, TurnContext } from './engine-types';
import { ceoSchema, opsSchema } from './llm/schemas';
import { CATALOG } from './events/catalog';
import { addEvidence, ensureResponseTasks, managementOwners, terminal } from './events/lifecycle';
import { post } from './business';
import { days } from '../shared/workday';
import { withRequestMetrics } from './llm/telemetry';
import type { CallMetrics } from './llm/client';

export function optionsFor(w: World, eventId: string): BusinessOption[] {
  const e = w.eventState.cases.find(e => e.id === eventId)!;
  const d = CATALOG.find(d => d.id === e.templateId)!;
  const base = { eventId, department: d.department, effort: d.effort };
  if (!e.truth) return [{ ...base, id: `${eventId}:monitor`, label: 'Verify information without factual changes', kind: 'monitor', cost: 0, savings: 0 }];
  if (d.id === 'cost_review') {
    const target = e.value;
    const options: BusinessOption[] = [
      { ...base, id: `${eventId}:reduce_spend`, label: 'Reduce discretionary tooling spend', kind: 'reduce_spend' as const, cost: 0, savings: Math.min(target, w.business.dailyDiscretionary) },
      { ...base, id: `${eventId}:renegotiate`, label: 'Renegotiate infrastructure costs', kind: 'renegotiate' as const, cost: 50_000, savings: Math.min(target, Math.max(0,w.business.dailyInfrastructure-10_000)) },
      { ...base, id: `${eventId}:postpone`, label: 'Postpone discretionary projects', kind: 'postpone' as const, cost: 0, savings: Math.min(target,w.business.dailyDiscretionary) },
    ].filter(o => o.savings >= target);
    if (!managementOwners(w).acting) for (const p of Object.values(w.business.positions).filter(p => p.role === 'employee' && w.agents[p.id].status === 'active' && p.dailySalary >= target))
      options.push({ ...base, id: `${eventId}:layoff:${p.id}`, label: `Lay off ${w.agents[p.id].profile.name}; lose their capacity`, kind: 'layoff', employeeId: p.id, cost: p.dailySalary * 5, savings: p.dailySalary });
    options.push({ ...base, id: `${eventId}:monitor`, label: 'Monitor; savings target remains unmet', kind: 'monitor', cost: 0, savings: 0 });
    return options;
  }
  return [
    { ...base, id: `${eventId}:respond`, label: e.domain === 'security' ? 'Contain, investigate, review recovery and communicate known impact' : 'Fund required acceptance work', kind: 'respond', cost: d.cost, savings: 0 },
    { ...base, id: `${eventId}:monitor`, label: 'Monitor with existing obligations still active', kind: 'monitor', cost: 0, savings: 0 },
  ];
}
export function managementContext(w: World, kind: 'ceo' | 'ops', actor: string): ManagementContext {
  const known = w.eventState.evidence.filter(e => e.recipients.includes(actor) && e.deliveryTick <= w.tick);
  const cases = w.eventState.cases.filter(e => !terminal(e) && known.some(k => k.eventId === e.id)).map(e => ({ ...structuredClone(e), truth: true }));
  // Hidden truth is deliberately absent from the rendered payload (including false rumours).
  for (const e of cases) delete (e as Partial<typeof e>).truth;
  return { schemaVersion: 1, kind, revision: w.tick, actor, authority: managementOwners(w).acting ? 'acting' : 'full', cases,
    evidence: structuredClone(known), options: cases.flatMap(e => optionsFor(w,e.id)),
    directives: structuredClone(w.eventState.directives.filter(d => d.active)),
    finances: { cash: w.business.cash, committed: w.business.committed, revenue: w.business.revenue, bookings: w.business.bookings, costs: w.business.costs, target: w.business.quarters.at(-1)!.salesTarget },
    employees: Object.values(w.business.positions).filter(p => p.role === 'employee' && w.agents[p.id].status === 'active').map(p => ({ id: p.id, department: p.department, capabilities: p.capabilities, capacity: p.capacity })),
    tasks: structuredClone(w.business.tasks.filter(t => !['done','cancelled'].includes(t.status))),
  };
}
function contextForProvider(w: World, ctx: ManagementContext, companySchedule?: CompanySchedule): TurnContext {
  return { tick: w.tick, mode: 'llm_bias', state: structuredClone(w.agents[ctx.actor].state), available: [], colleagues: [], claims: [], events: [], management: ctx, ...(companySchedule ? { companySchedule } : {}) };
}
export function fallbackCeo(ctx: ManagementContext) {
  let cash = ctx.finances.cash - ctx.finances.committed;
  return { schemaVersion: 1 as const, kind: 'ceo' as const, revision: ctx.revision,
    choices: ctx.cases.map(e => {
      const options = ctx.options.filter(o => o.eventId === e.id);
      const option = options.find(o => !['layoff','monitor'].includes(o.kind) && o.cost <= cash) ?? options.find(o => o.kind === 'monitor')!;
      cash -= option.cost;
      return { eventId: e.id, optionId: option.id, priority: e.domain === 'security' ? 1 : e.valence === 'negative' ? 2 : 3, budget: option.cost,
        deadline: Math.max(ctx.revision+1,e.deadline), acceptance: 'Completed acceptance work and verified business conditions.', communicate: [] as string[], reviewTick: Math.max(ctx.revision+1,Math.min(e.deadline,ctx.revision+days(1))) };
    }), rationale: 'Preserve delivery, address urgent risks and use feasible non-layoff measures.' };
}
export function fallbackOps(ctx: ManagementContext, schedule?: CompanySchedule) {
  const remaining = new Map(ctx.employees.map(e => [e.id,e.capacity]));
  const assignments: ManagementDecision['assignments'] = [];
  for (const t of [...ctx.tasks].sort((a,b) => a.priority-b.priority || a.deadline-b.deadline || a.id.localeCompare(b.id))) {
    const employees = ctx.employees.filter(e => (remaining.get(e.id) ?? 0) > 0 && e.capabilities.includes(t.department) && (t.status !== 'review' || e.id !== t.owner) && t.dependencies.every(id => !ctx.tasks.some(d => d.id === id)));
    const preferred = t.status === 'review' ? t.reviewer : t.owner;
    const employee = schedule?.waitingForSupplier.includes(t.id) ? undefined
      : (schedule ? employees.find(e => e.id === preferred) : undefined) ?? employees[0];
    if (employee) { const allocation = Math.min(1,remaining.get(employee.id) ?? 0); remaining.set(employee.id,(remaining.get(employee.id) ?? 0)-allocation); assignments.push({ taskId: t.id, employeeId: employee.id, state: 'active', allocation }); }
    else assignments.push({ taskId: t.id, employeeId: t.owner, state: 'paused', allocation: 0 });
  }
  return { schemaVersion: 1 as const, kind: 'ops' as const, revision: ctx.revision, assignments, infeasible: assignments.filter(a => a.state === 'paused').map(a => a.taskId), rationale: 'Allocate urgent work within actual capacity and pause displaced work.' };
}
function validateCeo(w: World, ctx: ManagementContext, raw: unknown) {
  const v = ceoSchema.parse(raw);
  if (v.revision !== w.tick) throw new Error('Stale executive revision');
  const seen = new Set<string>(); let spend = 0;
  for (const c of v.choices) {
    const e = ctx.cases.find(e => e.id === c.eventId); const option = ctx.options.find(o => o.id === c.optionId && o.eventId === c.eventId);
    if (!e || !option || seen.has(e.id)) throw new Error('Unknown or duplicate choice'); seen.add(e.id);
    if (c.budget !== option.cost || c.deadline < w.tick+1 || c.deadline > e.deadline || c.reviewTick < w.tick+1 || c.reviewTick > c.deadline) throw new Error('Invalid budget/deadline/review');
    if (c.communicate.some(id => id !== 'public' && w.agents[id]?.status !== 'active')) throw new Error('Invalid communication recipient');
    spend += c.budget;
  }
  if (spend > Math.max(0, ctx.finances.cash-ctx.finances.committed)) throw new Error('Unaffordable decision');
  return v;
}
function validateOps(w: World, ctx: ManagementContext, raw: unknown, schedule?: CompanySchedule) {
  const v = opsSchema.parse(raw); if (v.revision !== w.tick) throw new Error('Stale operations revision');
  const used = new Map<string,number>(); const seen = new Set<string>();
  // Include preserved allocations so a partial response cannot overbook.
  const merged = ctx.tasks.map(t => v.assignments.find(a => a.taskId === t.id) ?? { taskId: t.id, employeeId: schedule && t.status === 'review' ? t.reviewer ?? null : t.owner, state: t.status === 'active' || (t.status === 'review' && (!schedule || t.allocated > 0)) ? 'active' as const : 'paused' as const, allocation: t.allocated });
  for (const a of v.assignments) { if (!ctx.tasks.some(t => t.id === a.taskId) || seen.has(a.taskId)) throw new Error('Unknown/duplicate task'); seen.add(a.taskId); }
  for (const a of merged) {
    if (a.state === 'paused') { if (seen.has(a.taskId) && a.allocation !== 0) throw new Error('Paused work consumes no allocation'); continue; }
    const t = w.business.tasks.find(t => t.id === a.taskId)!;
    const p = ctx.employees.find(e => e.id === a.employeeId);
    if (!p || !p.capabilities.includes(t.department) || a.allocation <= 0 || (t.status === 'review' && t.owner === p.id) || t.dependencies.some(id => w.business.tasks.find(t => t.id === id)?.status !== 'done')) throw new Error('Invalid assignment, dependency or reviewer');
    used.set(p.id,(used.get(p.id) ?? 0)+a.allocation);
    if (used.get(p.id)! > p.capacity) throw new Error('Overbooked employee');
  }
  if (schedule) validateCompanyAssignments(ctx, schedule, merged);
  return v;
}
/** Scheduling only changes when work, capacity or directives change, not on each progress increment. */
export function opsInputSignature(ctx: ManagementContext): string {
  return JSON.stringify({
    actor: ctx.actor,
    employees: ctx.employees,
    directives: ctx.directives.map(d => [d.id,d.version,d.priority,d.deadline]),
    tasks: ctx.tasks.map(t => [t.id,t.owner,t.reviewer,t.status,t.allocated,t.priority,t.deadline,t.dependencies]),
  });
}
function scheduleSignature(ctx: ManagementContext, company?: CompanySchedule) {
  const signature = opsInputSignature(ctx);
  return company ? JSON.stringify([signature, company.waitingForSupplier, company.escalations]) : signature;
}

export async function managementPhase(w: World, provider: TurnProvider | null, mode: string, phase?: (phase: string) => void) {
  const owners = managementOwners(w);
  for (const kind of ['ceo','ops'] as const) {
    const actor = owners[kind]; if (!actor) continue;
    if (kind === 'ops') prepareCompanySchedule(w);
    const ctx = managementContext(w,kind,actor);
    const company = kind === 'ops' ? companySchedulingView(w, ctx.tasks) : undefined;
    if (company) ctx.tasks = company.tasks;
    const materialReport = ctx.evidence.some(e => e.tick === w.tick && e.certainty === 'observed' && ctx.cases.some(c => c.id === e.eventId));
    const needsCeo = materialReport || ctx.cases.some(e => e.deadline > w.tick && (!w.eventState.directives.some(d => d.eventId === e.id && d.active) || w.eventState.directives.some(d => d.eventId === e.id && d.active && d.reviewTick <= w.tick)));
    const needsOps = Boolean(company) || ctx.tasks.some(t => !t.owner || t.status === 'review' || t.status === 'blocked' || t.status === 'pending' || (t.status === 'paused' && ctx.employees.some(e => e.capabilities.includes(t.department) && !ctx.tasks.some(a => a.owner === e.id && a.status === 'active')))) || w.eventState.decisions.some(d => d.tick === w.tick && d.kind === 'ceo');
    const opsChanged = scheduleSignature(ctx, company?.schedule) !== w.eventState.lastOpsInput;
    if (kind === 'ceo' ? !needsCeo : !needsOps || !opsChanged) continue;
    phase?.(kind === 'ceo' ? 'CEO deciding' : 'Ops assigning');
    let value: ReturnType<typeof fallbackCeo> | ReturnType<typeof fallbackOps> | null = null; let fallback: string | null = null;
    const metrics: CallMetrics[] = [];
    if (mode.startsWith('llm') && provider) for (let attempt = 0; attempt < 2; attempt++) {
      let rejectedIntent: unknown = null;
      try {
        const raw = await withRequestMetrics(metrics, () => provider(w.agents[actor].profile,contextForProvider(w,ctx,company?.schedule)));
        rejectedIntent = raw;
        value = kind === 'ceo' ? validateCeo(w,ctx,raw) : validateOps(w,ctx,raw,company?.schedule); break;
      } catch (error) { w.eventState.diagnostics.push({ tick: w.tick, phase: kind, reason: error instanceof Error ? error.message : 'Invalid response', intent: JSON.stringify(rejectedIntent)?.slice(0,4000) }); }
    }
    if (!value) { fallback = mode.startsWith('llm') ? 'role_response_unavailable' : 'rules'; value = kind === 'ceo' ? fallbackCeo(ctx) : fallbackOps(ctx,company?.schedule); }
    const id = `decision-${kind}-${w.tick}`;
    const d: ManagementDecision = { id, tick: w.tick, revision: w.tick, author: actor, kind, rationale: value.rationale, fallback,
      choices: value.kind === 'ceo' ? value.choices : [], assignments: value.kind === 'ops' ? value.assignments : [] };
    w.eventState.decisions.push(d);
    w.eventState.diagnostics.push({ tick: w.tick, phase: kind, reason: fallback ?? 'validated', intent: { decision: value, metrics } });
    if (value.kind === 'ceo') for (const choice of value.choices) {
      const e = w.eventState.cases.find(e => e.id === choice.eventId)!;
      const option = ctx.options.find(o => o.id === choice.optionId)!;
      const previous = w.eventState.directives.filter(d => d.eventId === e.id).at(-1);
      if (previous) previous.active = false;
      const directive = { id: `directive-${e.id}-${(previous?.version ?? 0)+1}`, eventId: e.id, decisionId: id, author: actor, recipient: owners.ops,
        version: (previous?.version ?? 0)+1, priority: choice.priority, budget: 0, deadline: choice.deadline, acceptance: choice.acceptance,
        effectiveTick: w.tick, expiryTick: choice.deadline, reviewTick: choice.reviewTick, supersedes: previous?.id ?? null, active: true };
      w.eventState.directives.push(directive); e.decisions.push(id); e.status = option.kind === 'monitor' ? 'monitoring' : 'responding';
      // A response is charged once per case, not once per scheduled review.
      if (choice.budget) post(w,{ id: `response-${e.id}`, tick: w.tick, category: 'response', amount: choice.budget, source: e.id });
      if (option.kind === 'layoff' && option.employeeId) {
        const a = w.agents[option.employeeId]; if (a.status !== 'active' || owners.acting) throw new Error('Invalid layoff authority');
        a.status = 'laid_off'; a.quitTick = w.tick;
        for (const t of w.business.tasks.filter(t => t.owner === a.id && !['done','cancelled'].includes(t.status))) { t.owner = null; t.status = 'blocked'; t.version++; }
        e.status = 'resolved'; e.outcome = `${a.profile.name} laid off by CEO decision; payroll and delivery capacity reduced prospectively.`; directive.active = false;
        addEvidence(w,e,e.outcome,actor,w.ids.filter(id => w.agents[id].status === 'active'));
      } else ensureResponseTasks(w,e,option.kind);
      for (const t of w.business.tasks.filter(t => t.eventId === e.id && !['done','cancelled'].includes(t.status))) { t.priority = choice.priority; t.deadline = choice.deadline; t.directiveId = directive.id; t.version++; }
      if (choice.communicate.includes('public') && e.publicTick === undefined) e.publicTick = w.tick;
      if (choice.communicate.length) addEvidence(w,e,`Management response: ${option.label}. ${choice.acceptance}`,actor,choice.communicate);
    }
    else for (const assignment of value.assignments) {
      const t = w.business.tasks.find(t => t.id === assignment.taskId)!;
      // Review ownership remains the author; reviewer allocation is recorded separately.
      if (t.status === 'review') {
        if (assignment.state === 'active') { t.allocated = assignment.allocation; (t as typeof t & { reviewer?: string }).reviewer = assignment.employeeId ?? undefined; }
        else { t.allocated = 0; delete (t as typeof t & { reviewer?: string }).reviewer; }
      } else {
        if (t.owner !== assignment.employeeId || t.status !== assignment.state || t.allocated !== assignment.allocation) t.version++;
        t.owner = assignment.employeeId; t.status = assignment.state; t.allocated = assignment.allocation;
      }
    }
    if (kind === 'ops') {
      if (company) recordCompanySchedule(w, ctx.tasks, d);
      const next = managementContext(w,'ops',actor);
      const view = company ? companySchedulingView(w, next.tasks) : undefined;
      if (view) next.tasks = view.tasks;
      w.eventState.lastOpsInput = scheduleSignature(next, view?.schedule);
    }
  }
}
