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

export interface Claim {
  id: string;
  text: string;
  is_true: boolean;
  source: string;
  created_tick: number;
  hops: number;
}

export interface TickRecord {
  tick: number;
  event: EventType | null;
  action: Action;
  agent: string;
  target: string | null;
  summary: string;
}

export interface LlmTurn {
  action: Action;
  target: string | null;
  claim_id: string | null;
  public_line: string;
  inner_monologue: string;
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
  agents: Record<string, AgentState>;
  metrics: {
    crack_order: string[];
    first_quit_tick: number | null;
    true_reach: number;
    false_reach: number;
  };
}
