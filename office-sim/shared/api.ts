// HTTP + SSE contract between server/index.ts and the web client.
// PENDING TEAM SIGN-OFF (integration plan item S2). Additive only: nothing in
// shared/types.ts changes.
import type { AgentProfile, EventType, SimulationMode, SimulationState, TickRecord } from './types';

/** Why the server runs in its current mode. */
export type ModeReason = 'configured' | 'no_api_key' | 'llm_failed';

/** Public price decomposition. No truth, lineage, claim details or future corrections. */
export interface PriceDTO {
  operating?: { fundamentals: number; productiveUnits: number; capacity: number };
  tick: number;
  price: number;
  ret: number;
  rawOutput: number;
  effectiveOutput: number;
  oEma: number;
  outputLog: number;
  newsLevel: number;
  noise: number;
  headcount: number;
  morale: number | null;
  feedback: boolean;
  guards: { outputFloor: boolean; priceBound: 'min' | 'max' | null; rawLogPrice: number; logPrice: number };
  markers: Array<{ id: string; kind: EventType | 'leak' | import('./events').BusinessNewsKind; event: 'headline' | 'correction' }>;
}

export interface SimResponse {
  run_id?: string;
  revision?: number;
  phase?: string | null;
  storage_error?: string | null;
  report_status?: 'pending' | 'ready' | 'factual_fallback' | 'none';
  report_id?: string | null;
  price: PriceDTO;
  initial_price: number;
  price_feedback: boolean;
  /** Complete parameter snapshot for replay (synthetic model assumptions only). */
  params?: unknown;
  mode: SimulationMode;
  mode_reason: ModeReason;
  /** Run length: the run auto-pauses when state.tick reaches it. */
  max_ticks: number;
  /** Playback multiplier; omitted by older servers. */
  speed?: number;
  state: SimulationState;
}

/** POST /api/sim/settings. Supply at least one field. Feedback changes require reset once started. */
export interface SettingsRequest {
  max_ticks?: number;
  price_feedback?: boolean;
}

export interface InjectRequest {
  type: EventType;
  /** Hidden truth tag. Omitted: the engine's default for this event type. */
  is_true?: boolean;
}

/** POST /api/sim/inject-custom. The user writes a freeform office headline; the server validates and generates its effects automatically. */
export interface CustomInjectRequest {
  text: string;
  is_true: boolean;
}

/** An event the engine applied this tick. */
export interface TickEvent {
  business_id?: string;
  type: EventType;
  is_true: boolean;
  text: string;
  /** Written by the player. */
  custom?: boolean;
}

export interface TickFrame {
  price: PriceDTO;
  tick: number;
  records: TickRecord[];
  events: TickEvent[];
  state: SimulationState;
}

export interface HistoryResponse extends SimResponse {
  history: TickFrame[];
}

export interface CastResponse {
  agents: AgentProfile[];
}

/**
 * SSE messages on GET /api/events (the default `message` event, JSON data).
 * - history: sent on connect and after reset. The client REPLACES its history.
 * - tick: one finished tick. The client appends it if frame.tick === last + 1.
 * - state: play / pause / inject / settings. State only.
 */
export type StreamMessage =
  | ({ type: 'history' } & HistoryResponse)
  | ({ type: 'tick'; frame: TickFrame } & SimResponse)
  | ({ type: 'state' } & SimResponse);

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
