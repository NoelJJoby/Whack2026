// The one way the client talks to the server: `api()` for requests and
// `useSimulation()` for the SSE stream and the controls.
import { TICKS_PER_MONTH, TICKS_PER_QUARTER, TICKS_PER_WEEK } from '../shared/workday';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiError, CastResponse, HistoryResponse, ModeReason, PriceDTO, SimResponse, StreamMessage, TickFrame } from '../shared/api';
import type { CompanyTaskSummary } from '../shared/companyTasks';
import type { AgentProfile, EventType, SimulationMode, SimulationState } from '../shared/types';
import { mockCast, mockHistory, mockResponse } from './mocks';
import { playerText } from './hudModel';

/** Run lengths offered in the UI: 1 workweek, 1 month, 2 months, 1 quarter (40, 80, 160, 240 ticks). */
export const RUN_LENGTHS = [TICKS_PER_WEEK, TICKS_PER_MONTH, TICKS_PER_MONTH * 2, TICKS_PER_QUARTER];

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
  runId?: string; phase?: string | null; reportStatus?: string; storageError?: string | null;
  companyTasks: CompanyTaskSummary[];
  injectBusiness: (templateId: string, isTrue: boolean) => Promise<boolean>;
  historyEpoch: number;
  acknowledge: (tick: number) => Promise<boolean>;
  cast: AgentProfile[];
  maxTicks: number;
  price: PriceDTO | null;
  initialPrice: number;
  speed: number;
  setSpeed: (speed: number) => Promise<boolean>;
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
  newSeed: (seed?: number) => Promise<boolean>;
  setRunLength: (maxTicks: number) => Promise<boolean>;
  inject: (type: EventType, isTrue: boolean) => Promise<boolean>;
  /** Post a player-written headline; the server validates it and may reject it. */
  injectCustom: (text: string, isTrue: boolean) => Promise<boolean>;
}

const errorText = (e: unknown) => playerText(e instanceof Error ? e.message : 'Request failed. Try again.');

/** Reconnect/history replay may repeat frames; keep one ordered frame per tick. */
export function orderedFrames(frames: TickFrame[]): TickFrame[] {
  const byTick = new Map<number, TickFrame>();
  for (const frame of frames) byTick.set(frame.tick, frame);
  return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

export function useSimulation(): Simulation {
  const [cast, setCast] = useState<CastResponse | null>(USE_MOCKS ? mockCast : null);
  const [snapshot, setSnapshot] = useState<SimResponse | null>(USE_MOCKS ? mockResponse : null);
  const [history, setHistory] = useState<TickFrame[]>(USE_MOCKS ? mockHistory : []);
  const [connection, setConnection] = useState<Connection>(USE_MOCKS ? 'mock' : 'connecting');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const lastTick = useRef(0);
  const currentTick = useRef(0);
  const currentRun = useRef<string | undefined>();

  const applySnapshot = useCallback((next: SimResponse, force = false) => {
    // An HTTP reply can arrive after a newer SSE tick; never step backwards except on reset.
    if (!force && currentRun.current && next.run_id && currentRun.current !== next.run_id) return;
    if (!force && next.state.tick < currentTick.current) return;
    currentRun.current = next.run_id;
    currentTick.current = next.state.tick;
    setSnapshot(next);
  }, []);

  const replaceHistory = useCallback(
    (next: HistoryResponse) => {
      const history = orderedFrames(next.history);
      setHistoryEpoch(epoch => epoch + 1);
      lastTick.current = history.at(-1)?.tick ?? next.state.tick;
      setHistory(history);
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
          setHistory((h) => orderedFrames([...h, frame]));
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
        applySnapshot(await api<SimResponse>(path, { method: 'POST', body }), path === '/sim/reset' || path === '/sim/new-seed');

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

  const acknowledge = useCallback(async (tick: number) => {
    if (USE_MOCKS) return true;
    try { await api('/sim/presented', { method: 'POST', body: { tick, run_id: currentRun.current } }); return true; }
    catch { return false; }
  }, []);

  const running = snapshot?.state.running ?? false;
  return {
    runId: snapshot?.run_id, phase: snapshot?.phase, reportStatus: snapshot?.report_status, storageError: snapshot?.storage_error,
    companyTasks: snapshot?.company_tasks ?? [],
    injectBusiness: (templateId, isTrue) => post('/sim/inject-business',{ template_id: templateId, is_true: isTrue }),
    historyEpoch,
    acknowledge,
    cast: cast?.agents ?? [],
    speed: snapshot?.speed ?? 1,
    setSpeed: (speed) => post('/sim/speed', { speed }),
    price: snapshot?.price ?? null,
    initialPrice: snapshot?.initial_price ?? 100,
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
    newSeed: (seed) => post('/sim/new-seed', seed === undefined ? undefined : { seed }),
    setRunLength: (maxTicks) => post('/sim/settings', { max_ticks: maxTicks }),
    inject: (type, isTrue) => post('/sim/inject', { type, is_true: isTrue }),
    injectCustom: (text, isTrue) => post('/sim/inject-custom', { text, is_true: isTrue }),
  };
}
