import type { Business, LedgerEntry, Task } from '../shared/business';
import type { World, EngineAgent } from './engine-types';
import { calendarSpan, workdayTime } from '../shared/workday';

export const BUSINESS_PARAMS = {
  currency: 'GBP', salesTarget: 100_000_000, startingCash: 50_000_000,
  dailyInfrastructure: 60_000, dailyDiscretionary: 40_000, dailySalary: 25_000,
  errorBase: 0.025, errorMax: 0.24, fatigueError: 0.08, overloadError: 0.08,
  reviewReduction: 0.75, detectionDelay: 1, materialDelay: 5,
};
export function initialiseBusiness(agents: Record<string, EngineAgent>): Business {
  const entries = Object.values(agents);
  const ceo = entries.find(a => a.id === 'ceo' || a.profile.functionGroup === 'Exec')?.id;
  const ops = entries.find(a => a.id === 'ops' || (a.profile.role === 'Manager' && a.id !== ceo))?.id;
  const positions: Business['positions'] = {};
  for (const a of entries) {
    const department = ['Sales', 'Engineering', 'Operations'].includes(a.profile.functionGroup) ? a.profile.functionGroup as 'Sales' | 'Engineering' | 'Operations' : 'Exec';
    positions[a.id] = { id: a.id, supervisor: a.id === ceo ? null : a.id === ops ? ceo ?? null : ops ?? ceo ?? null,
      role: a.id === ceo ? 'ceo' : a.id === ops ? 'ops' : 'employee', department,
      capabilities: department === 'Exec' ? [] : [department], capacity: 1,
      dailySalary: a.id === ceo ? 45_000 : a.id === ops ? 32_000 : BUSINESS_PARAMS.dailySalary };
  }
  validateOrganisation(positions);
  const b: Business = { currency: BUSINESS_PARAMS.currency, startingCash: BUSINESS_PARAMS.startingCash, cash: BUSINESS_PARAMS.startingCash,
    bookings: 0, revenue: 0, receivables: 0, costs: 0, committed: 0, dailyInfrastructure: BUSINESS_PARAMS.dailyInfrastructure,
    dailyDiscretionary: BUSINESS_PARAMS.dailyDiscretionary, quarters: [{ quarter: 1, salesTarget: BUSINESS_PARAMS.salesTarget }],
    positions, opportunities: [], contracts: [], ledger: [], tasks: [], work: [], controls: 0, supplierAvailableAt: 0, idle: 0, used: 0, available: 0 };
  for (let i = 0; i < 4; i++) b.opportunities.push({ id: `op-${i}`, client: ['Juniper', 'Harbour', 'Cedar', 'Aster'][i], value: i === 0 ? 10_000_000 : (i + 2) * 1_000_000, stage: 'qualified', owner: entries.find(a => a.profile.functionGroup === 'Sales')?.id ?? null });
  for (let i = 0; i < 3; i++) {
    const id = `existing-${i}`;
    b.contracts.push({ id, client: ['Northstar', 'Willow', 'Bracken'][i], value: 24_000_000, recognised: 0, collected: 0, signedTick: 0, paymentTick: null, status: 'delivering', quarter: 1, target: BUSINESS_PARAMS.salesTarget });
    b.tasks.push(makeTask(`service-${i}`, 'delivery', 'Engineering', `Deliver ${b.contracts[i].client} service`, 4, 20 + i * 5, null, id));
  }
  b.tasks.push(makeTask('initial-release', 'release', 'Engineering', 'Release with access controls checked', 4, 16));
  b.tasks.push(makeTask('initial-collection', 'collection', 'Operations', 'Collect existing receivable', 2, 12));
  // Existing delivered service is a starting receivable, not new run revenue.
  b.receivables = 3_000_000;
  b.tasks.push(makeTask('initial-sales', 'sales', 'Sales', 'Qualify the next client opportunity', 4, 12));
  return b;
}
export function validateOrganisation(positions: Business['positions']) {
  for (const id of Object.keys(positions)) {
    const visited = new Set<string>(); let current: string | null = id;
    while (current) { if (visited.has(current) || !positions[current]) throw new Error('Invalid reporting hierarchy'); visited.add(current); current = positions[current].supervisor; }
  }
}
export function makeTask(id: string, kind: Task['kind'], department: Task['department'], title: string, effort: number, deadline: number, eventId: string | null = null, contractId: string | null = null): Task {
  return { id, title, department, kind, effort, remaining: effort, deadline, eventId, contractId, owner: null, priority: 3,
    dependencies: [], reviewRequired: ['release', 'delivery', 'containment', 'recovery'].includes(kind), reviewed: false,
    error: false, status: 'pending', version: 1, directiveId: null, allocated: 1 };
}
export function post(world: World, entry: LedgerEntry): boolean {
  const b = world.business;
  if (!Number.isSafeInteger(entry.amount) || entry.amount < 0) throw new Error('Money must be nonnegative integer minor units');
  if (b.ledger.some(e => e.id === entry.id)) return false;
  b.ledger.push(entry);
  switch (entry.category) {
    case 'booking': b.bookings += entry.amount; break;
    case 'revenue': b.revenue += entry.amount; b.receivables += entry.amount; break;
    case 'collection': if (entry.amount > b.receivables) throw new Error('Collection exceeds receivables'); b.receivables -= entry.amount; b.cash += entry.amount; break;
    case 'saving': break; // prospective rates are changed by the executing command, never cash created
    default: b.costs += entry.amount; b.cash -= entry.amount;
  }
  const event = world.eventState.cases.find(e => e.id === entry.source);
  if (event) event.ledger.push(entry.id);
  return true;
}
export function openBusinessTick(w: World) {
  const b = w.business; const days = calendarSpan(w.tick - 1, w.tick);
  const quarter = workdayTime(w.tick).quarter;
  if (!b.quarters.some(q => q.quarter === quarter)) b.quarters.push({ quarter, salesTarget: BUSINESS_PARAMS.salesTarget });
  const salaries = Object.values(b.positions).filter(p => w.agents[p.id].status === 'active').reduce((n,p) => n + p.dailySalary, 0);
  post(w, { id: `payroll-${w.tick}`, tick: w.tick, category: 'payroll', amount: Math.round(salaries * days), source: 'operations', calendarDays: days });
  post(w, { id: `infra-${w.tick}`, tick: w.tick, category: 'infrastructure', amount: Math.round((b.dailyInfrastructure + b.dailyDiscretionary) * days), source: 'operations', calendarDays: days });
  for (const c of b.contracts) {
    if (c.status === 'earned' && c.paymentTick !== null && c.paymentTick <= w.tick) {
      const amount = c.recognised - c.collected;
      if (post(w, { id: `${c.id}-cash`, tick: w.tick, category: 'collection', amount, source: c.id })) c.collected += amount;
      c.status = 'paid';
    }
  }
  // Established clients generate recurring service obligations, with real capacity costs.
  if (w.tick % 10 === 1) {
    const id = `routine-${w.tick}`;
    for (const [kind, dept, title] of [['sales', 'Sales', 'Develop qualified pipeline'], ['release', 'Engineering', 'Maintain product release'], ['process', 'Operations', 'Improve service process']] as const)
      b.tasks.push(makeTask(`${id}-${kind}`, kind, dept, title, 3, w.tick + 15));
    if (b.opportunities.filter(o => o.stage === 'qualified').length < 4) b.opportunities.push({ id: `op-${w.tick}`, client: `Client ${w.tick}`, value: 4_000_000, stage: 'qualified', owner: null });
  }
  for (const t of b.tasks) if (t.owner && w.agents[t.owner]?.status !== 'active' && !['done','cancelled'].includes(t.status)) {
    t.owner = null; t.status = 'blocked'; t.version++;
  }
  b.used = 0; b.available = Object.values(b.positions).filter(p => p.role === 'employee' && w.agents[p.id].status === 'active').reduce((n,p) => n + p.capacity, 0);
}
export function signContract(w: World, eventId: string, opportunityId: string, value?: number) {
  const b = w.business; const op = b.opportunities.find(o => o.id === opportunityId && o.stage === 'qualified');
  if (!op) return null;
  const id = `contract-${eventId}`; if (b.contracts.some(c => c.id === id)) return id;
  op.stage = 'signed'; const quarter = workdayTime(w.tick).quarter;
  const target = b.quarters.find(q => q.quarter === quarter)!.salesTarget;
  b.contracts.push({ id, client: op.client, value: value ?? op.value, recognised: 0, collected: 0, signedTick: w.tick, paymentTick: null, status: 'delivering', quarter, target });
  post(w, { id: `${id}-booking`, tick: w.tick, category: 'booking', amount: value ?? op.value, source: eventId });
  return id;
}
