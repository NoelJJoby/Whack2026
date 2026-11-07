export type EventType =
  | 'merger'
  | 'new_management'
  | 'long_hours_policy'
  | 'pr_scandal'
  | 'layoffs_rumour'
  | 'surprise_bonus'
  | 'competitor_poaching';

export type Action =
  | 'work'
  | 'overwork'
  | 'slack_off'
  | 'complain'
  | 'gossip'
  | 'verify'
  | 'interview'
  | 'leak';

export type AgentStatus = 'active' | 'quit';
export type SimulationMode = 'llm_bias' | 'rules';

export interface Proposal {
  action: Action;
  weight: number;
  target?: string | null;
  claim?: string | null;
}

export interface DecisionLog {
  source: 'llm' | 'rules' | 'fallback';
  agent: string;
  chosen_action: Action;
  proposals?: Proposal[];
  cache_hit?: boolean;
  reason?: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  archetype: string;
  role: string;
  functionGroup: string;
  traits: {
    ambition: number;
    financial_need: number;
    ethics: number;
    sociability: number;
    distortion_rate: number;
    quit_threshold: number;
    impulsivity: number;
    recruiter_contact: boolean;
  };
}

export interface AgentState {
  stress: number;
  workload: number;
  loyalty: number;
  trust_mgmt: number;
  burnout: number;
  affinity: Record<string, number>;
  source_trust: Record<string, number>;
}

export interface AgentRuntimeState extends AgentState {
  status: AgentStatus;
  quit_tick: number | null;
}

export interface Claim {
  id: string;
  text: string;
  is_true: boolean;
  source: string;
  created_tick: number;
  hops: number;
  scandal?: boolean;
  parent_id?: string | null;
}

export interface TickRecord {
  tick: number;
  event: EventType | null;
  action: Action;
  agent: string;
  target: string | null;
  summary: string;
  public_line?: string;
  inner_monologue?: string;
  quit?: boolean;
  state?: AgentState;
  decision?: DecisionLog;
}

export interface LlmTurn {
  action: Action;
  target: string | null;
  claim_id: string | null;
  public_line: string;
  inner_monologue: string;
}

export interface LlmOutput {
  proposals: Proposal[];
  public_line: string;
  inner_monologue: string;
  beliefs: Record<string, number>;
}

export interface SimulationState {
  tick: number;
  seed: number;
  started: boolean;
  running: boolean;
  event: EventType | null;
  queue: EventType[];
  feed: string[];
  claims: Claim[];
  agents: Record<string, AgentRuntimeState>;
  mode?: SimulationMode;
  metrics: {
    crack_order: string[];
    first_quit_tick: number | null;
    true_reach: number;
    false_reach: number;
  };
}
