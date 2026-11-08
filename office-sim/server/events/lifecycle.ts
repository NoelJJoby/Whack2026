import type { BusinessEvent, Evidence, EventState, Rarity } from '../../shared/events';
import type { World } from '../engine-types';
import { makeTask, signContract } from '../business';
import { days, workdayTime } from '../../shared/workday';
import { CATALOG, type EventDefinition } from './catalog';
import { stream } from '../rng';
export const terminal = (e: BusinessEvent) => ['resolved','failed','cancelled','superseded'].includes(e.status);
export function managementOwners(w: World) {
  const positions = Object.values(w.business.positions);
  const ceo = positions.find(p => p.role === 'ceo' && w.agents[p.id]?.status === 'active')?.id ?? null;
  const ops = positions.find(p => p.role === 'ops' && w.agents[p.id]?.status === 'active')?.id ?? null;
  return { ceo: ceo ?? ops, ops: ops ?? ceo, acting: !ceo };
}
export function interval(seed: number, rarity: Rarity, index: number) {
  // Common every 2-4 workdays, rare every 8-12 (calibrated at 5 ticks a day as 10-20 and 40-60 ticks).
  return (rarity === 'common' ? days(2) : days(8)) + stream(seed, index, `arrivals-${rarity}`, 'event').int((rarity === 'common' ? days(2) : days(4)) + 1);
}
export function initialEvents(seed: number): EventState {
  const common = interval(seed, 'common', 0); const rare = interval(seed, 'rare', 0);
  return { cases: [], evidence: [], decisions: [], directives: [], scheduler: { common: { index: 0, nominal: common, due: common }, rare: { index: 0, nominal: rare, due: rare } }, scheduling: [], cooldowns: {}, incidents: [], diagnostics: [] };
}
export function addEvidence(w: World, e: BusinessEvent, text: string, source: string, recipients: string[], certainty: Evidence['certainty'] = 'observed', deliveryTick = w.tick) {
  const id = `evidence-${e.id}-${e.evidence.length + 1}`;
  w.eventState.evidence.push({ id, eventId: e.id, tick: w.tick, deliveryTick, source, recipients: [...new Set(recipients)], text, certainty });
  e.evidence.push(id); e.milestones.push({ tick: w.tick, text }); return id;
}
export function openEvent(w: World, definition: EventDefinition | string, origin: BusinessEvent['origin'] = 'external', truth = true, text?: string, hidden = false, entityId?: string): BusinessEvent {
  const d = typeof definition === 'string' ? CATALOG.find(x => x.id === definition)! : definition;
  if (!d) throw new Error('Unknown business template');
  const b = w.business; const owners = managementOwners(w);
  const id = `event-${w.tick}-${w.eventState.cases.length + 1}`;
  const quarter = workdayTime(w.tick).quarter;
  const op = b.opportunities.find(o => o.stage === 'qualified');
  const event: BusinessEvent = { id, rootId: id, parentId: null, templateId: d.id, headline: text ?? d.headline, rarity: d.rarity,
    valence: d.valence, domain: d.domain, severity: d.rarity === 'rare' ? 'high' : 'medium', origin,
    entityId: entityId ?? (d.domain === 'sales' ? op?.id ?? 'pipeline' : d.domain === 'supplier' ? 'supplier-primary' : d.domain === 'security' ? 'production-access' : d.id),
    openedTick: w.tick, deadline: w.tick + d.deadline, owner: owners.ceo, status: 'open', truth, detected: !hidden,
    evidence: [], decisions: [], tasks: [], ledger: [], milestones: [], outcome: null,
    quarter, target: b.quarters.find(q => q.quarter === quarter)!.salesTarget, value: d.id === 'client_win' ? op?.value ?? 0 : d.benefit,
    exposure: truth && ['configuration_error','material_breach'].includes(d.id), contained: false };
  w.eventState.cases.push(event); w.eventState.cooldowns[d.id] = w.tick + d.cooldown;
  if (!hidden) addEvidence(w, event, event.headline, origin === 'employee' ? 'Ops report' : 'external source', [owners.ceo, owners.ops].filter((x): x is string => !!x), truth ? 'observed' : 'rumour');
  if (truth && d.id === 'client_win' && op) {
    const contractId = signContract(w, id, op.id)!;
    const task = makeTask(`task-${id}`, 'onboarding', 'Engineering', `Onboard ${op.client}`, 4, event.deadline, id, contractId);
    b.tasks.push(task); event.tasks.push(task.id);
    event.milestones.push({ tick: w.tick, text: `Contract booked against frozen Q${quarter} target; revenue and collection require delivery.` });
  }
  if (truth && ['supplier_interruption','supplier_withdrawal'].includes(d.id)) b.supplierAvailableAt = w.tick + (d.rarity === 'rare' ? days(1.8) : days(0.8));
  if (event.exposure) w.eventState.incidents.push({ eventId: id, detectedAt: hidden ? w.tick + 1 : w.tick, materialAt: w.tick + days(1), employee: origin === 'employee' ? entityId ?? null : null });
  return event;
}
export function ensureResponseTasks(w: World, e: BusinessEvent, optionKind: string) {
  if (e.tasks.length || !e.truth || optionKind === 'monitor' || optionKind === 'layoff') return;
  const d = CATALOG.find(d => d.id === e.templateId)!;
  const t = makeTask(`task-${e.id}`, d.kind, d.department, `${d.headline}: ${d.acceptance}`, d.effort, e.deadline, e.id);
  if (e.domain === 'security') { t.reviewRequired = true; t.priority = 1; }
  w.business.tasks.push(t); e.tasks.push(t.id);
}
export function updateLifecycle(w: World) {
  for (const e of w.eventState.cases.filter(e => !terminal(e))) {
    const tasks = w.business.tasks.filter(t => e.tasks.includes(t.id));
    if (!e.truth) { if (w.tick > e.openedTick + days(1)) { e.status = 'resolved'; e.outcome = 'Unconfirmed information archived; no factual business effects.'; } continue; }
    if (e.status === 'responding' && tasks.length && tasks.every(t => t.status === 'done')) {
      if (e.domain === 'supplier' && w.tick < w.business.supplierAvailableAt) { e.status = 'monitoring'; continue; }
      if (e.domain === 'security' && e.contained && !tasks.some(t => t.kind === 'recovery')) {
        const recovery = makeTask(`recovery-${e.id}`, 'recovery', 'Engineering', 'Verify recovery and client impact', 3, w.tick + days(2), e.id);
        recovery.priority = 1; w.business.tasks.push(recovery); e.tasks.push(recovery.id); e.status = 'monitoring';
        addEvidence(w, e, 'Exposure contained. Recovery and client impact remain under review.', 'monitoring', [managementOwners(w).ceo, managementOwners(w).ops].filter((x): x is string => !!x));
        continue;
      }
      if (e.domain !== 'security' || e.contained) {
        e.status = 'resolved'; e.outcome ??= e.templateId === 'cost_review' ? 'Required operating savings implemented; layoffs avoided.' : 'Acceptance work completed and business conditions verified.';
        e.milestones.push({ tick: w.tick, text: e.outcome });
        for (const d of w.eventState.directives.filter(d => d.eventId === e.id)) d.active = false;
      }
    } else if (e.status === 'monitoring' && tasks.length && tasks.every(t => t.status === 'done') && (e.domain !== 'supplier' || w.tick >= w.business.supplierAvailableAt)) {
      e.status = 'responding'; // verified on the next lifecycle pass, not on model assertion
    }
    if (w.tick > e.deadline && !terminal(e)) {
      e.status = 'failed'; e.outcome = 'Deadline missed; remaining work and obligations retained.';
      e.milestones.push({ tick: w.tick, text: e.outcome });
      if (e.domain === 'delivery') for (const t of tasks) { const c = w.business.contracts.find(c => c.id === t.contractId); if (c) c.status = 'at_risk'; }
    }
  }
  w.business.committed = w.eventState.directives.filter(d => d.active).reduce((n,d) => n + d.budget, 0);
}
