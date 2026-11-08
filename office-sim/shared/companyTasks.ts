import type { Task, WorkResult } from './business';

export type CompanyTaskStatus = 'queued' | 'delegated' | 'in_progress' | 'blocked' | 'review' | 'completed' | 'failed' | 'abandoned';
export type WorkCategory = 'research' | 'planning' | 'engineering' | 'coordination';
export type CompanyEffect = 'ordinary_work' | 'reviewed_release';
export type CompanySource = 'model' | 'rules' | 'fallback';

export interface SubmitCompanyTask {
  run_id: string;
  idempotency_key: string;
  objective: string;
  deadline_ticks?: number;
}

export interface CompanyTaskSummary {
  id: string;
  runId: string;
  objective: string;
  status: CompanyTaskStatus;
  submittedTick: number;
  activatedTick?: number;
  deadlineTick?: number;
  missedDeadlineTick?: number;
  outcome?: CompanyTaskOutcome;
}

export interface CompanyBrief {
  version: number;
  author: string;
  objective: string;
  assumptions: string[];
  constraints: string[];
  successCriteria: string[];
  deadlineTick: number;
  effect: CompanyEffect;
  workIds: string[];
}

export interface CompanyWork {
  taskId: string;
  category: WorkCategory;
  acceptance: string;
  requiredInputs: string[];
  producesFinding: boolean;
  author?: string;
  firstProgressTick?: number;
  completedTick?: number;
  missedDeadlineTick?: number;
  consumedFindings: Record<string, string>;
  rework: number;
}

export interface WorkFinding {
  id: string;
  version: number;
  taskId: string;
  producer: string;
  facts: Array<{ label: string; value: string }>;
  summary: string;
  completedTick: number;
  knownBy: string[];
}

export interface CompanyMessage {
  threadId: string;
  kind: 'request' | 'incomplete' | 'finding' | 'retrieve' | 'escalation';
  sourceTaskId: string;
  replyTo?: string;
  findingId?: string;
  sentTick: number;
  deliveredTick: number;
  round: number;
}

export interface CompanyDecision {
  authority: 'ceo' | 'ops' | 'acting';
  question: string;
  options: string[];
  explanation: string;
  evidence: string[];
  workIds: string[];
  briefVersion: number;
  source: CompanySource;
  fallback?: string;
  inference?: { attempts: number; latencyMs: number | null; inputTokens: number; outputTokens: number };
}

export interface CompanyActivity {
  id: string;
  companyTaskId: string;
  tick: number;
  round: number;
  order: number;
  actor: string | null;
  recipients: string[];
  taskId?: string;
  kind: 'brief' | 'assignment' | 'displacement' | 'restored' | 'message' | 'deferred_message' | 'priority' | 'progress' | 'review' | 'deadline' | 'departure' | 'outcome';
  location: 'executive office' | 'office' | 'desk' | 'work ledger';
  dialogue: string;
  result?: string;
  /** Cost per participant in this exchange. */
  attention?: number;
  threadId?: string;
  allocation?: { previous: string | null; assignee: string | null; effortPerTick: number; role: 'owner' | 'reviewer' };
  message?: CompanyMessage;
  decision?: CompanyDecision;
  source?: CompanySource;
  workResultId?: string;
}

export interface CompanyTaskOutcome {
  state: 'accepted' | 'failed' | 'abandoned';
  timing: 'on_time' | 'late';
  tick: number;
  reason: string;
  criteria: Array<{ text: string; accepted: boolean; workIds: string[] }>;
  newsCaseId?: string;
}

export interface CompanyTask extends CompanyTaskSummary {
  idempotencyKey: string;
  requestedDeadline?: number;
  brief?: CompanyBrief;
  work: Record<string, CompanyWork>;
  findings: WorkFinding[];
  activity: CompanyActivity[];
  displaced: Record<string, Pick<Task, 'status' | 'owner' | 'allocated'>>;
}


export interface CompanyTaskDetail extends Omit<CompanyTask, 'idempotencyKey'> {
  canonicalWork: Task[];
  workResults: WorkResult[];
}

export interface CompanyTaskList {
  run_id: string;
  tasks: CompanyTaskSummary[];
}
