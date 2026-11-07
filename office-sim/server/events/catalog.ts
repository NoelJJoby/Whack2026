import type { EventDomain, Rarity, Valence } from '../../shared/events';
import type { Task } from '../../shared/business';
import type { World } from '../engine-types';
export interface EventDefinition {
  id: string; headline: string; rarity: Rarity; valence: Valence; domain: EventDomain;
  department: Task['department']; kind: Task['kind']; effort: number; deadline: number; cooldown: number;
  cost: number; benefit: number; evidence: string; acceptance: string;
}
function definition(id: string, headline: string, rarity: Rarity, valence: Valence, domain: EventDomain, department: Task['department'], kind: Task['kind'], benefit = 0): EventDefinition {
  return { id, headline, rarity, valence, domain, department, kind, effort: rarity === 'rare' ? 5 : 3,
    deadline: rarity === 'rare' ? 20 : 14, cooldown: id === 'release_success' ? 150 : rarity === 'rare' ? 80 : 25,
    cost: valence === 'negative' ? 100_000 : 50_000, benefit,
    evidence: 'Recorded operating evidence; response and acceptance work are required.',
    acceptance: 'Required work completes, review passes, and linked business conditions hold.' };
}
export const CATALOG: readonly EventDefinition[] = [
  definition('client_win', 'A qualified client signs a service contract', 'common','positive','sales','Engineering','onboarding'),
  definition('expansion', 'An existing client requests expanded service', 'common','positive','sales','Sales','sales'),
  definition('renewal', 'A standard renewal is ready for delivery', 'common','positive','sales','Sales','sales'),
  definition('proposal_gap', 'A proposal misses a client requirement', 'common','negative','sales','Sales','sales'),
  definition('delivery_concern', 'A client raises a delivery concern', 'common','negative','delivery','Engineering','delivery'),
  definition('release_success', 'A reviewed release meets acceptance criteria', 'common','positive','reliability','Engineering','release'),
  definition('infrastructure_saving', 'An optimisation can reduce infrastructure cost', 'common','positive','finance','Engineering','optimisation',10_000),
  definition('support_fix', 'A tested fix can remove recurring support work', 'common','positive','reliability','Engineering','support'),
  definition('regression', 'A release regression needs correction', 'common','negative','reliability','Engineering','recovery'),
  definition('configuration_error', 'A risky access configuration needs investigation', 'common','negative','security','Engineering','containment'),
  definition('onboarding_success', 'Client onboarding passes its acceptance check', 'common','positive','delivery','Operations','onboarding'),
  definition('invoice_collected', 'A receivable is ready for collection', 'common','positive','finance','Operations','collection'),
  definition('supplier_discount', 'A supplier offers a negotiated discount', 'common','positive','supplier','Operations','supplier',10_000),
  definition('process_improvement', 'A process improvement can reduce rework', 'common','positive','delivery','Operations','process'),
  definition('supplier_interruption', 'A supplier interruption delays delivery', 'common','negative','supplier','Operations','supplier'),
  definition('overdue_invoice', 'A client invoice becomes overdue', 'common','negative','finance','Operations','collection'),
  definition('partnership', 'A strategic partnership is available to negotiate', 'rare','positive','sales','Sales','sales'),
  definition('flagship_launch', 'A flagship launch opportunity is ready for acceptance work', 'rare','positive','reliability','Engineering','release'),
  definition('major_renewal', 'A major multi-year renewal enters negotiation', 'rare','positive','sales','Sales','sales'),
  definition('company_adoption', 'A large client considers company-wide adoption', 'rare','positive','sales','Engineering','onboarding'),
  definition('cost_review', 'An operating-budget reduction is required; layoffs are one option', 'rare','negative','people','Operations','cost_cut',20_000),
  definition('material_breach', 'A supplier confirms a material data exposure', 'rare','negative','security','Engineering','containment'),
  definition('account_at_risk', 'A major account threatens to leave', 'rare','negative','sales','Sales','sales'),
  definition('supplier_withdrawal', 'A critical supplier withdraws service', 'rare','negative','supplier','Operations','supplier'),
];
export function eligible(w: World, d: EventDefinition): boolean {
  const b = w.business;
  if (!Object.values(b.positions).some(p => p.capabilities.includes(d.department) && w.agents[p.id]?.status === 'active')) return false;
  if ((w.eventState.cooldowns[d.id] ?? 0) > w.tick) return false;
  if (w.eventState.cases.some(e => e.templateId === d.id && !['resolved','failed','cancelled','superseded'].includes(e.status))) return false;
  if (['client_win','partnership','major_renewal','company_adoption','expansion','renewal'].includes(d.id) && !b.opportunities.some(o => o.stage === 'qualified')) return false;
  if (['expansion','renewal','major_renewal','company_adoption','delivery_concern','account_at_risk'].includes(d.id) && !b.contracts.length) return false;
  if (['invoice_collected','overdue_invoice'].includes(d.id) && b.receivables <= 0) return false;
  if (d.id === 'release_success' && !b.tasks.some(t => t.kind === 'release' && t.status === 'done' && t.reviewed && !t.error)) return false;
  if (d.id === 'onboarding_success' && !b.tasks.some(t => t.kind === 'onboarding' && t.status === 'done' && !t.error)) return false;
  if (d.id === 'regression' && !b.tasks.some(t => t.kind === 'release' && t.remaining < t.effort)) return false;
  if (d.id === 'configuration_error' && !b.tasks.some(t => ['release','delivery'].includes(t.kind) && t.status === 'active')) return false;
  if (d.id === 'infrastructure_saving' && b.dailyInfrastructure <= 20_000) return false;
  if (d.id === 'supplier_discount' && b.dailyDiscretionary <= 5_000) return false;
  return true;
}
