export type Department = 'Sales' | 'Engineering' | 'Operations';
export interface Position {
  id: string; supervisor: string | null; role: 'ceo' | 'ops' | 'employee';
  department: Department | 'Exec'; capabilities: Department[]; capacity: number; dailySalary: number;
}
export interface QuarterPlan { quarter: number; salesTarget: number; }
export interface Opportunity { id: string; client: string; value: number; stage: 'qualified' | 'signed'; owner: string | null; }
export interface Contract {
  id: string; client: string; value: number; recognised: number; collected: number;
  signedTick: number; paymentTick: number | null; status: 'delivering' | 'earned' | 'paid' | 'at_risk';
  quarter: number; target: number;
}
export interface LedgerEntry {
  id: string; tick: number; category: 'booking' | 'revenue' | 'collection' | 'payroll' | 'infrastructure' | 'response' | 'saving';
  amount: number; source: string; calendarDays?: number;
}
export interface Task {
  id: string; title: string; department: Department; kind: 'sales' | 'delivery' | 'release' | 'optimisation' | 'support' | 'onboarding' | 'collection' | 'supplier' | 'process' | 'containment' | 'recovery' | 'cost_cut';
  eventId: string | null; contractId: string | null; owner: string | null;
  effort: number; remaining: number; priority: number; deadline: number;
  dependencies: string[]; reviewRequired: boolean; reviewed: boolean; error: boolean;
  status: 'pending' | 'active' | 'paused' | 'review' | 'done' | 'blocked' | 'cancelled';
  reviewer?: string;
  version: number; directiveId: string | null; allocated: number;
}
export interface WorkResult { id: string; tick: number; agent: string; taskId: string | null; action: string; progress: number; outcome: string; directiveVersion: number | null; }
export interface Business {
  currency: string; startingCash: number; cash: number; bookings: number; revenue: number; receivables: number;
  costs: number; committed: number; dailyInfrastructure: number; dailyDiscretionary: number;
  quarters: QuarterPlan[]; opportunities: Opportunity[]; contracts: Contract[]; ledger: LedgerEntry[];
  positions: Record<string, Position>; tasks: Task[]; work: WorkResult[];
  controls: number; supplierAvailableAt: number; idle: number; used: number; available: number;
}
