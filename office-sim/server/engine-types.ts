// Engine-local types: anything the engine needs that shared/types.ts does not
// (yet) define. Proposed shared-type changes are in docs/engine-handoff.md.
import type { Action, AgentProfile, AgentState, Claim, EventType, TickRecord } from '../shared/types';
import type { ClaimImpact, Params } from './params';

export type { Action, AgentState, EventType, TickRecord, Params };

/** Canonical action order. Iteration order matters for deterministic sampling. */
export const ACTIONS: readonly Action[] = [
  'work',
  'overwork',
  'slack_off',
  'complain',
  'gossip',
  'verify',
  'interview',
  'leak',
];

export const ACTIONS_WITH_TARGET: readonly Action[] = ['complain', 'gossip', 'verify'];
export const ACTIONS_WITH_CLAIM: readonly Action[] = ['gossip', 'verify', 'leak'];

export type Mode = 'llm_bias' | 'llm_raw' | 'rules' | 'random';
export const MODES: readonly Mode[] = ['llm_bias', 'llm_raw', 'rules', 'random'];
export const LLM_MODES: readonly Mode[] = ['llm_bias', 'llm_raw'];

// --- LLM contract (brief format) -------------------------------------------

export interface Proposal {
  action: Action;
  weight: number;
  /** Colleague id; used if valid for the sampled action, otherwise drawn by affinity / source trust. */
  target?: string | null;
  /** Held claim id for gossip / verify / leak; used if valid, otherwise picked by effective belief. */
  claim?: string | null;
}

export interface LlmOutput {
  proposals: Proposal[];
  public_line: string;
  inner_monologue: string;
  /** claim id -> 0..100, how true the agent thinks it is. */
  beliefs: Record<string, number>;
}

// --- Agents -----------------------------------------------------------------

export interface EngineTraits {
  ambition: number;
  financial_need: number;
  ethics: number;
  sociability: number;
  /** 0-100: chance per gossip hop that the claim is distorted. */
  distortion_rate: number;
  /** Per-agent burnout quit threshold, 0-100. */
  quit_threshold: number;
  /** New (brief): how far pressure pushes choices, 0-100. */
  impulsivity: number;
  /** New (brief): has an outside option. */
  recruiter_contact: boolean;
}

export interface EngineProfile extends Omit<AgentProfile, 'traits'> {
  traits: EngineTraits;
}

/** Starting point for one cast member. Missing pairwise values use params defaults. */
export interface CastMember {
  profile: EngineProfile;
  start: Omit<AgentState, 'affinity' | 'source_trust'> & {
    affinity?: Record<string, number>;
    source_trust?: Record<string, number>;
  };
}

export interface HeldClaim {
  claimId: string;
  /** Who the agent heard it from: an agent id, 'mgmt', or another non-agent source. */
  from: string;
  tickHeard: number;
  /** Hops from the original source when this agent heard it. */
  depth: number;
  /** Latest LLM belief 0-100, or the verified value. null = never assessed. */
  belief: number | null;
  /** Set once the agent verified the claim; locks belief. */
  verified: 'confirmed' | 'refuted' | null;
}

export type AgentStatus = 'active' | 'quit';

export interface EngineAgent {
  id: string;
  profile: EngineProfile;
  state: AgentState;
  status: AgentStatus;
  quitTick: number | null;
  interviewTicks: number[];
  /** Workload the agent drifts back to; policies move it. */
  baselineWorkload: number;
  claims: HeldClaim[];
}

// --- Claims and events ------------------------------------------------------

export interface EngineClaim extends Claim {
  scandal: boolean;
  /** Claim this one was distorted from, or null for an original. */
  parentId: string | null;
  /** Original claim of this lineage. */
  rootId: string;
  event: EventType | null;
  onHear: ClaimImpact;
}

export interface ScenarioEvent {
  tick: number;
  type: EventType;
  /** Hidden truth tag; defaults to params.events[type].isTrue. */
  isTrue?: boolean;
  /** Rumours: who hears it first. Defaults to one agent drawn from the event stream. */
  hearers?: string[];
  /** Rumours: who they hear it from. Defaults to 'grapevine'. */
  source?: string;
}

export type QueuedEvent = Omit<ScenarioEvent, 'tick'>;

export interface World {
  seed: number;
  tick: number;
  /** Agent ids in cast order (stable). */
  ids: string[];
  agents: Record<string, EngineAgent>;
  claims: Record<string, EngineClaim>;
  queue: QueuedEvent[];
  quits: Array<{ agent: string; tick: number }>;
  leaks: Array<{ agent: string; claim: string; tick: number }>;
}

export interface RunConfig {
  seed: number;
  mode: Mode;
  ticks: number;
  scenario: ScenarioEvent[];
  /** Ablation toggles (agent.md). */
  gossip: boolean;
  billboard: boolean;
}

// --- Turn provider (the LLM is injected) -----------------------------------

/** What an agent is told. Never includes truth tags. */
export interface TurnContext {
  tick: number;
  mode: Mode;
  state: AgentState;
  available: Action[];
  colleagues: Array<{ id: string; name: string; affinity: number; source_trust: number }>;
  claims: Array<{ id: string; text: string; from: string; tick_heard: number; scandal: boolean }>;
  events: Array<{ type: EventType; text: string }>;
}

/** Returns raw LLM output (either format), or null if the call failed. */
export type TurnProvider = (agent: EngineProfile, ctx: TurnContext) => Promise<unknown>;

// --- Decisions and logs -----------------------------------------------------

export interface ProviderLog {
  attempts: number;
  retry_count: number;
  /** False for measured API calls; null when an injected provider reports no telemetry. */
  cache_hit: boolean | null;
  latency_ms: number | null;
  /** Sum of reported API usage, including responses rejected by the engine. */
  usage: { promptTokens: number; completionTokens: number } | null;
  requests: Array<{
    attempt: number;
    latencyMs: number;
    outcome: 'success' | 'error';
    usage: { promptTokens: number; completionTokens: number } | null;
    validation_error: string | null;
  }>;
}

export interface DecisionLog {
  run: number;
  tick: number;
  agent: string;
  mode: Mode;
  /** Mode actually used (differs after a fallback). */
  effective_mode: Mode;
  fallback: string | null;
  llm: { proposals: Proposal[]; cache_hit: boolean | null } | null;
  /** Present when the engine invokes a provider; agent/tick are supplied above. */
  provider?: ProviderLog;
  state: { stress: number; burnout: number; loyalty: number; trust_mgmt: number };
  fresh: boolean;
  masked: Action[];
  pressure: number;
  /** Clamped multipliers for available actions. */
  modifiers: Partial<Record<Action, number>>;
  gain: number;
  probs: Partial<Record<Action, number>>;
  draw: number;
  chosen: { action: Action; target: string | null; claim: string | null };
  explain: string;
}

export interface Decision {
  action: Action;
  target: string | null;
  claim: string | null;
  probs: Partial<Record<Action, number>>;
  public_line: string;
  inner_monologue: string;
  log: DecisionLog;
}

export interface HopLog {
  from: string;
  to: string;
  claim: string;
  delivered: string;
  distorted: boolean;
  new_to_target: boolean;
}

export interface EngineTickLog {
  tick: number;
  events: Array<{ type: EventType; is_true: boolean; claim: string }>;
  order: string[];
  decisions: DecisionLog[];
  lines: Array<{ agent: string; public_line: string; inner_monologue: string }>;
  hops: HopLog[];
  verifications: Array<{ agent: string; target: string | null; claim: string; result: 'confirmed' | 'refuted' }>;
  leaks: Array<{ agent: string; claim: string }>;
  quits: string[];
  states: Record<string, AgentState & { status: AgentStatus }>;
  reach: { true_holders: number; false_holders: number };
}
