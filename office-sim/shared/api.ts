// HTTP + SSE contract between server/index.ts and the web client.
// PENDING TEAM SIGN-OFF (integration plan item S2). Additive only: nothing in
// shared/types.ts changes.
import type { AgentProfile, EventType, SimulationMode, SimulationState, TickRecord } from './types';

/** Why the server runs in its current mode. */
export type ModeReason = 'configured' | 'no_api_key' | 'llm_failed';

export interface SimResponse {
  mode: SimulationMode;
  mode_reason: ModeReason;
  /** Run length: the run auto-pauses when state.tick reaches it. */
  max_ticks: number;
  state: SimulationState;
}

/** POST /api/sim/settings. max_ticks: integer, 1 to 128, not below the current tick. */
export interface SettingsRequest {
  max_ticks: number;
}

export interface InjectRequest {
  type: EventType;
  /** Hidden truth tag. Omitted: the engine's default for this event type. */
  is_true?: boolean;
}

/** An event the engine applied this tick. */
export interface TickEvent {
  type: EventType;
  is_true: boolean;
  text: string;
}

export interface TickFrame {
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
