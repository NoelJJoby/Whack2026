// The one way the client talks to the server: `api()` for requests and
// `useSimulation()` for the SSE stream and the controls.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiError, CastResponse, HistoryResponse, ModeReason, PriceDTO, SimResponse, StreamMessage, TickFrame } from '../shared/api';
import type { AgentProfile, EventType, SimulationMode, SimulationState } from '../shared/types';
import { mockCast, mockHistory, mockResponse } from './mocks';

/** Run lengths offered in the UI. The server accepts any integer from 1 to 128. */
export const RUN_LENGTHS = [16, 32, 64, 128];

/** Dev only: `VITE_USE_MOCKS=true` renders the design mock data instead of the server. */
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      // Only send a JSON content type with a body: Fastify rejects an empty JSON body.
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
    });
  } catch {
    throw new ApiRequestError(0, 'network', 'Cannot reach the simulation server.');
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (json as ApiError | null)?.error;
    throw new ApiRequestError(response.status, error?.code ?? 'http_error', error?.message ?? `Request failed (${response.status}).`);
  }
  return json as T;
}

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'mock';

export interface Simulation {
  cast: AgentProfile[];
  maxTicks: number;
  price: PriceDTO | null;
  initialPrice: number | null;
  priceFeedback: boolean;
  setPriceFeedback: (enabled: boolean) => Promise<boolean>;
  mode: SimulationMode | null;
  modeReason: ModeReason | null;
  state: SimulationState | null;
  history: TickFrame[];
  connection: Connection;
  /** Last control or inject error, if any. */
  error: string | null;
  busy: boolean;
  start: () => Promise<boolean>;
  togglePlay: () => Promise<boolean>;
  step: () => Promise<boolean>;
  reset: () => Promise<boolean>;
  setRunLength: (maxTicks: number) => Promise<boolean>;
  inject: (type: EventType, isTrue: boolean) => Promise<boolean>;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

export function useSimulation(): Simulation {
  const [cast, setCast] = useState<CastResponse | null>(USE_MOCKS ? mockCast : null);
  const [snapshot, setSnapshot] = useState<SimResponse | null>(USE_MOCKS ? mockResponse : null);
  const [history, setHistory] = useState<TickFrame[]>(USE_MOCKS ? mockHistory : []);
  const [connection, setConnection] = useState<Connection>(USE_MOCKS ? 'mock' : 'connecting');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastTick = useRef(0);
  const currentTick = useRef(0);

  const applySnapshot = useCallback((next: SimResponse, force = false) => {
    // An HTTP reply can arrive after a newer SSE tick; never step backwards except on reset.
    if (!force && next.state.tick < currentTick.current) return;
    currentTick.current = next.state.tick;
    setSnapshot({ mode: next.mode, mode_reason: next.mode_reason, max_ticks: next.max_ticks, state: next.state, price: next.price, price_feedback: next.price_feedback, initial_price: next.initial_price });
  }, []);

  const replaceHistory = useCallback(
    (next: HistoryResponse) => {
      lastTick.current = next.history.at(-1)?.tick ?? 0;
      setHistory(next.history);
      applySnapshot(next, true);
    },
    [applySnapshot],
  );

  useEffect(() => {
    if (USE_MOCKS) return;
    let closed = false;
    const loadCast = () =>
      api<CastResponse>('/sim/cast')
        .then((c) => !closed && setCast(c))
        .catch((e) => !closed && setError(errorText(e)));
    const resync = () =>
      api<HistoryResponse>('/sim/history')
        .then((h) => !closed && replaceHistory(h))
        .catch((e) => !closed && setError(errorText(e)));

    const source = new EventSource('/api/events');
    source.onmessage = (event) => {
      const message = JSON.parse(event.data) as StreamMessage;
      if (message.type === 'history') {
        // Sent on every (re)connect and after reset: replace, never append.
        replaceHistory(message);
        setConnection('live');
        void loadCast();
      } else if (message.type === 'tick') {
        const { frame } = message;
        if (frame.tick === lastTick.current + 1) {
          lastTick.current = frame.tick;
          setHistory((h) => [...h, frame]);
          applySnapshot(message);
        } else if (frame.tick > lastTick.current) {
          void resync();
        }
      } else {
        applySnapshot(message);
      }
    };
    // EventSource reconnects by itself; the server re-sends history on reconnect.
    source.onerror = () => !closed && setConnection('reconnecting');
    return () => {
      closed = true;
      source.close();
    };
  }, [applySnapshot, replaceHistory]);

  const post = useCallback(
    async (path: string, body?: unknown) => {
      if (USE_MOCKS) {
        setError('Mock data mode: the simulation is not connected.');
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        applySnapshot(await api<SimResponse>(path, { method: 'POST', body }), path === '/sim/reset');
        return true;
      } catch (e) {
        setError(errorText(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot],
  );

  const running = snapshot?.state.running ?? false;
  return {
    cast: cast?.agents ?? [],
    price: snapshot?.price ?? null,
    initialPrice: snapshot?.initial_price ?? null,
    priceFeedback: snapshot?.price_feedback ?? false,
    setPriceFeedback: (enabled) => post('/sim/settings', { price_feedback: enabled }),
    maxTicks: snapshot?.max_ticks ?? RUN_LENGTHS[0],
    mode: snapshot?.mode ?? null,
    modeReason: snapshot?.mode_reason ?? null,
    state: snapshot?.state ?? null,
    history,
    connection,
    error,
    busy,
    start: () => post('/sim/start'),
    togglePlay: () => post(running ? '/sim/pause' : '/sim/play'),
    step: () => post('/sim/step'),
    reset: () => post('/sim/reset'),
    setRunLength: (maxTicks) => post('/sim/settings', { max_ticks: maxTicks }),
    inject: (type, isTrue) => post('/sim/inject', { type, is_true: isTrue }),
  };
}
