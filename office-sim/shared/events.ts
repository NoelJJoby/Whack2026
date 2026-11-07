import type { Department } from './business';
export type Rarity = 'common' | 'rare';
export type Valence = 'positive' | 'negative';
export type EventDomain = 'sales' | 'delivery' | 'reliability' | 'security' | 'finance' | 'people' | 'supplier';
export type EventStatus = 'open' | 'responding' | 'monitoring' | 'resolved' | 'failed' | 'cancelled' | 'superseded';
export interface Evidence {
  id: string; eventId: string; tick: number; deliveryTick: number; source: string; recipients: string[];
  text: string; certainty: 'observed' | 'suspected' | 'rumour';
}
export interface BusinessEvent {
  id: string; templateId: string; headline: string; rarity: Rarity; valence: Valence; domain: EventDomain;
  severity: 'low' | 'medium' | 'high'; origin: 'external' | 'employee' | 'management' | 'injection';
  rootId: string; parentId: string | null; entityId: string; openedTick: number; deadline: number;
  publicTick?: number;
  owner: string | null; status: EventStatus; truth: boolean; detected: boolean;
  evidence: string[]; decisions: string[]; tasks: string[]; ledger: string[];
  milestones: Array<{ tick: number; text: string }>; outcome: string | null;
  quarter: number; target: number; value: number; exposure: boolean; contained: boolean;
}
export interface BusinessOption {
  id: string; eventId: string; label: string; kind: 'respond' | 'monitor' | 'reduce_spend' | 'renegotiate' | 'postpone' | 'layoff';
  cost: number; savings: number; employeeId?: string; department: Department; effort: number;
}
export interface ManagementChoice {
  eventId: string; optionId: string; priority: number; budget: number; deadline: number;
  acceptance: string; communicate: string[]; reviewTick: number;
}
export interface ManagementDecision {
  id: string; tick: number; revision: number; author: string; kind: 'ceo' | 'ops';
  rationale: string; fallback: string | null; choices: ManagementChoice[];
  assignments: Array<{ taskId: string; employeeId: string | null; state: 'active' | 'paused'; allocation: number }>;
}
export interface Directive {
  id: string; eventId: string; decisionId: string; author: string; recipient: string | null;
  version: number; priority: number; budget: number; deadline: number; acceptance: string;
  effectiveTick: number; expiryTick: number; reviewTick: number; supersedes: string | null; active: boolean;
}
export interface SchedulerSlot { index: number; nominal: number; due: number; }
export interface SchedulerRecord { tick: number; rarity: Rarity; slot: number; nominal: number; reason: string; eventId?: string; }
export interface EventState {
  lastOpsInput?: string;
  cases: BusinessEvent[]; evidence: Evidence[]; decisions: ManagementDecision[]; directives: Directive[];
  scheduler: Record<Rarity, SchedulerSlot>; scheduling: SchedulerRecord[]; cooldowns: Record<string, number>;
  incidents: Array<{ eventId: string; detectedAt: number; materialAt: number; employee: string | null }>;
  diagnostics: Array<{ tick: number; phase: string; reason: string; intent?: unknown }>;
}
export interface ManagementContext {
  schemaVersion: 1; kind: 'ceo' | 'ops'; revision: number; actor: string; authority: 'full' | 'acting';
  cases: BusinessEvent[]; evidence: Evidence[]; options: BusinessOption[]; directives: Directive[];
  finances: { cash: number; committed: number; revenue: number; bookings: number; costs: number; target: number };
  employees: Array<{ id: string; department: string; capabilities: Department[]; capacity: number }>;
  tasks: import('./business').Task[];
}
export interface EmployeeWorkContext {
  schemaVersion: 1; revision: number; supervisor: string | null; role: string;
  assignments: import('./business').Task[]; reviewable: import('./business').Task[];
  supportable: Array<{ taskId: string; colleagueId: string; version: number }>; evidence: Evidence[]; directives: Directive[];
}

export type BusinessNewsKind = 'contract' | 'security' | 'operating_review' | 'delivery';
