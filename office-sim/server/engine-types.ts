import type { CompanyActivity, CompanyTask } from '../shared/companyTasks';
import type { CompanyTurn } from './llm/company-task-prompt';
import type { CompanySchedule } from './company-tasks/adapter';
import type { Business } from '../shared/business';
import type { EventState, ManagementContext, EmployeeWorkContext } from '../shared/events';
// Engine-local types: anything the engine needs that shared/types.ts does not
// (yet) define. Proposed shared-type changes are in docs/engine-handoff.md.
import type { Action, AgentProfile, AgentState, Claim, EventType, TickRecord } from '../shared/types';
import type { CustomEventEffectProfile } from '../shared/customEvent';
import type { PriceState, PriceRecord } from './price';
import type { ClaimImpact, Params } from './params';
import type { FeelingVariants, Manner, TurnStyle, VoiceCard } from './llm/voice';

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
  'review_work',
  'report_issue',
  'support_colleague',
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
  task_id?: string;
  evidence_id?: string;
  assignment_version?: number;
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
  /** Optional: an emotion name, a trigger key, and the conversation being answered. Rules validate all three. */
  emotion?: string;
  cause?: string;
  reply_to?: string;
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
  /** Persona line for the LLM prompt; defaults to the id's placeholder. */
  persona?: string;
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

export type AgentStatus = 'active' | 'quit' | 'laid_off';

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
  /** In the office this hour (server/presence.ts). Undefined counts as present. */
  present?: boolean;
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
  /** A distorted claim's text without its retelling frame. */
  core?: string;
  /** Lineage started by a player-written event. */
  custom?: boolean;
}

export interface ScenarioEvent {
  templateId?: string;
  tick: number;
  type: EventType;
  /** Hidden truth tag; defaults to params.events[type].isTrue. */
  isTrue?: boolean;
  /** Rumours: who hears it first. Defaults to one agent drawn from the event stream. */
  hearers?: string[];
  /** Rumours: who they hear it from. Defaults to 'grapevine'. */
  source?: string;
  /** Player-written headline, already validated; replaces the type's wording. */
  text?: string;
  /** Written by the player rather than the scheduler or a preset. */
  custom?: boolean;
  /** Numeric deltas for AI-generated player events. */
  customEffects?: Partial<CustomEventEffectProfile>;
  /** Extra metadata for the custom event summary. */
  customMeta?: { severity: number; durationTicks: number; summary: string };
}

export type QueuedEvent = Omit<ScenarioEvent, 'tick'>;

/** Price-relevant effects of a player-written event; priced by updatePrice, never by mutating price. */
export interface CustomPriceEffect {
  /** Log-price headline impact; replaces the base type's params.price.impacts entry. */
  impact?: number;
  /** Percent shift in output while the event lasts. */
  productivity?: number;
  /** Ticks the productivity shift lasts, from the tick it is announced. */
  duration: number;
}
export interface AppliedEvent { type: EventType; is_true: boolean; claim: string; custom?: CustomPriceEffect }

export interface World {
  companyTasks?: CompanyTask[];
  business: Business;
  eventState: EventState;
  price: PriceState;
  priceRecord: PriceRecord | null;
  seed: number;
  tick: number;
  /** Agent ids in cast order (stable). */
  ids: string[];
  agents: Record<string, EngineAgent>;
  claims: Record<string, EngineClaim>;
  queue: QueuedEvent[];
  quits: Array<{ agent: string; tick: number }>;
  leaks: Array<{ agent: string; claim: string; tick: number }>;
  /** Voice cards and speech history (server/speech.ts). Absent on worlds built before the voice system. */
  speech?: SpeechState;
  /** Live run scorecard (shared/scorecard.ts). Absent on worlds built before it; runTick starts one. */
  scorecard?: import('../shared/scorecard').LiveScorecard;
}

// --- Voice and speech (server/llm/voice.ts, server/speech.ts) ---------------

export interface SpeechState {
  voices: Record<string, VoiceCard>;
  lastManner: Record<string, Manner>;
  workSeen?: Record<string, { signature: string; tick: number }>;
  /** Public lines of the last few rounds, for the prompt and the repetition check. */
  recent: Array<{ tick: number; agent: string; line: string; thought?: string }>;
  /** Example small-talk lines per agent; [] once tried and failed. Acts as the run's cache. */
  examples: Record<string, string[]>;
}

/** The style brief the prompt builder renders. */
export interface SpeechContext {
  news?: string[];
  /** "How you talk" brief, without the label. */
  voice: string;
  /** "This time" instruction, without the label. */
  manner: string;
  minimal: boolean;
  feelings: FeelingVariants;
  examples: string[];
  /** Colleagues' recent public lines, by name. */
  recent: Array<{ name: string; line: string }>;
  /** Set only on a regeneration: the flagged public line and/or thought (null if that part passed). */
  nudge: { line: string | null; against: string | null; thought: string | null } | null;
}

export interface SpeechLog extends TurnStyle {
  /** Why the first line was flagged; empty if it passed. */
  flags: string[];
  regenerated: boolean;
  /** Flags on the regenerated line; null when there was no regeneration. */
  regen_flags: string[] | null;
  regen_request: { latencyMs: number; outcome: 'success' | 'error'; usage: { promptTokens: number; completionTokens: number } | null } | null;
}

export interface SpeechTickLog {
  flagged: number;
  regenerated: number;
  still_flagged: number;
  /** Requests left in the tick's budget after regenerations. */
  budget_left: number;
  example_requests: number;
}

export interface RunConfig {
  business?: boolean;
  seed: number;
  mode: Mode;
  ticks: number;
  scenario: ScenarioEvent[];
  /** Ablation toggles (agent.md). */
  gossip: boolean;
  billboard: boolean;
  /** Run-level option, default off in runners and API. */
  priceFeedback: boolean;
}

// --- Turn provider (the LLM is injected) -----------------------------------

/** What an agent is told. Never includes truth tags. */
export interface TurnContext {
  companyTurn?: CompanyTurn;
  companySchedule?: CompanySchedule;
  companyKnowledge?: { objective: string; work: Array<{ title: string; acceptance: string; receivedFindings: string[] }> };
  management?: ManagementContext;
  work?: EmployeeWorkContext;
  tick: number;
  mode: Mode;
  state: AgentState;
  available: Action[];
  /** `group` is the colleague's function (department), shown beside their name. */
  colleagues: Array<{ id: string; name: string; affinity: number; source_trust: number; group?: string }>;
  claims: Array<{ id: string; text: string; from: string; tick_heard: number; scandal: boolean }>;
  events: Array<{ type: EventType; text: string }>;
  /** Voice brief, set in LLM modes by server/speech.ts. */
  speech?: SpeechContext;
  /** Concrete reasons this agent might be upset this hour (server/triggers.ts). */
  triggers?: import('./triggers').Trigger[];
  /** A colleague's line waiting for this agent's reply (server/conversations.ts). */
  incoming?: import('./conversations').Incoming;
}

/** Example small-talk lines for a voice, or null if the call failed. */
export type StyleExamplesProvider = (agent: EngineProfile, voice: string) => Promise<string[] | null>;

/** Returns raw LLM output (either format), or null if the call failed. */
export type TurnProvider = ((agent: EngineProfile, ctx: TurnContext) => Promise<unknown>) & {
  styleExamples?: StyleExamplesProvider;
};

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
  chosen: { action: Action; target: string | null; claim: string | null; task_id?: string; assignment_version?: number; evidence_id?: string };
  explain: string;
  /** Manner, stance and repetition check for this turn's line (LLM modes). */
  speech?: SpeechLog;
}

export interface Decision {
  action: Action;
  target: string | null;
  claim: string | null;
  task_id?: string;
  evidence_id?: string;
  assignment_version?: number;
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
  companyActivity?: CompanyActivity[];
  business?: { decisions: string[]; work: string[]; events: string[]; ledger: string[] };
  price: PriceRecord;
  tick: number;
  events: AppliedEvent[];
  order: string[];
  decisions: DecisionLog[];
  lines: Array<{ agent: string; public_line: string; inner_monologue: string }>;
  hops: HopLog[];
  verifications: Array<{ agent: string; target: string | null; claim: string; result: 'confirmed' | 'refuted' }>;
  leaks: Array<{ agent: string; claim: string }>;
  quits: string[];
  states: Record<string, AgentState & { status: AgentStatus }>;
  reach: { true_holders: number; false_holders: number };
  /** Who stayed late and who went home after this hour (17:00 to 23:00 only). */
  presence?: import('./presence').PresenceLog;
  /** Voice cards created this tick (tick 1, or a newcomer's). */
  voices?: Record<string, VoiceCard>;
  /** Example lines fetched this tick. */
  examples?: Record<string, string[]>;
  speech?: SpeechTickLog;
}
