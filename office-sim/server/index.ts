import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import Fastify from 'fastify';
import { z } from 'zod';

import type {
  ApiError,
  CastResponse,
  HistoryResponse,
  ModeReason,
  SettingsRequest,
  SimResponse,
  StreamMessage,
  TickFrame,
} from '../shared/api';
import type { DecisionLog, EventType, SimulationMode, SimulationState, TickRecord } from '../shared/types';
import type { CastMember, DecisionLog as EngineDecisionLog, TurnProvider, World } from './engine-types';
import { createTurnProvider } from './llm';
import { DEFAULT_PARAMS, eventParams } from './params';
import { toPriceDTO, workforceReport } from './price';
import { buildScenario, fixtureCast } from './scripts/fixture';
import { createWorld, queueEvent, runTick, toSimulationState, type TickConfig, type TickResult } from './tick';

// Load the key from office-sim/.env (then the repo-root .env) wherever the server is started from.
// A variable already set in the environment wins, so `ANTHROPIC_API_KEY= ...` forces rules mode.
loadEnv({
  path: [fileURLToPath(new URL('../.env', import.meta.url)), fileURLToPath(new URL('../../.env', import.meta.url))],
  quiet: true,
});

const DEFAULT_SEED = 42;
/** Default run length, and the most ticks a run may be set to. */
export const DEFAULT_TICKS = 16;
export const TICK_LIMIT = 128;
const TICK_INTERVAL_MS = 2500;
const HEARTBEAT_MS = 15_000;
const MAX_HISTORY = 200;
const FEED_LINES = 20;
const EVENT_TYPES = Object.keys(eventParams) as [EventType, ...EventType[]];

const injectSchema = z.object({ type: z.enum(EVENT_TYPES), is_true: z.boolean().optional() }).strict();
const settingsSchema = z.object({ max_ticks: z.number().int().min(1).max(TICK_LIMIT).optional(), price_feedback: z.boolean().optional() }).strict().refine(v => v.max_ticks !== undefined || v.price_feedback !== undefined) satisfies z.ZodType<SettingsRequest>;

class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function errorBody(code: string, message: string, details?: unknown): ApiError {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function toSharedDecision(d: EngineDecisionLog): DecisionLog {
  return {
    source: d.fallback ? 'fallback' : d.effective_mode === 'rules' ? 'rules' : 'llm',
    agent: d.agent,
    chosen_action: d.chosen.action,
    ...(d.llm ? { proposals: d.llm.proposals } : {}),
    ...(d.llm?.cache_hit != null ? { cache_hit: d.llm.cache_hit } : {}),
    reason: d.explain,
  };
}

/** TickRecords from runTick, filled in with the lines, quit flag, state and decision from the tick log. */
function enrichRecords(r: TickResult): TickRecord[] {
  return r.records.map((rec) => {
    const line = r.log.lines.find((l) => l.agent === rec.agent);
    const decision = r.log.decisions.find((d) => d.agent === rec.agent);
    const { status: _status, ...state } = r.log.states[rec.agent];
    return {
      ...rec,
      public_line: line?.public_line,
      inner_monologue: line?.inner_monologue,
      quit: r.log.quits.includes(rec.agent),
      state,
      ...(decision ? { decision: toSharedDecision(decision) } : {}),
    };
  });
}

type Listener = (message: StreamMessage) => void;

class OfficeSimManager {
  private readonly listeners = new Set<Listener>();
  private seed = DEFAULT_SEED;
  cast: CastMember[] = fixtureCast(this.seed);
  private world!: World;
  private frames: TickFrame[] = [];
  private feed: string[] = [];
  private provider: TurnProvider | null = null;
  private mode: SimulationMode = 'rules';
  private modeReason: ModeReason = 'no_api_key';
  private maxTicks = DEFAULT_TICKS;
  private priceFeedback = false;
  private speed = 1;
  private started = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  /** Bumped on reset so a tick that was in flight is discarded. */
  private generation = 0;

  constructor() {
    this.init();
  }

  get listenerCount() {
    return this.listeners.size;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
  }

  unsubscribe(listener: Listener) {
    this.listeners.delete(listener);
  }

  private emit(message: StreamMessage) {
    for (const listener of this.listeners) listener(message);
  }

  private init(seed = this.seed) {
    if (hasApiKey()) {
      this.provider ??= createTurnProvider();
      this.mode = 'llm_bias';
      this.modeReason = 'configured';
    } else {
      this.provider = null;
      this.mode = 'rules';
      this.modeReason = 'no_api_key';
    }
    this.cast = fixtureCast(seed);
    this.world = createWorld(this.cast, seed);
    this.frames = [];
    this.feed = ['Simulation ready.'];
    this.started = false;
    this.running = false;
  }

  reseed(seed?: number) {
    const next = typeof seed === 'number' && Number.isInteger(seed) ? seed : Math.floor(Math.random() * 1_000_000) + 1;
    this.clearTimer();
    this.generation += 1;
    this.seed = next;
    this.init(this.seed);
    this.emit({ type: 'history', ...this.history() });
    return this.response();
  }

  private tickConfig(): TickConfig {
    return { mode: this.mode, scenario: buildScenario(this.seed, this.maxTicks), gossip: true, billboard: true, priceFeedback: this.priceFeedback };
  }

  state(): SimulationState {
    const lastEvent = [...this.frames].reverse().find((f) => f.events.length > 0)?.events.at(-1)?.type ?? null;
    return {
      ...toSimulationState(this.world, this.feed.slice(-FEED_LINES)),
      started: this.started,
      running: this.running,
      event: lastEvent,
      mode: this.mode,
    };
  }

  response(): SimResponse {
    const current = this.world.price;
    const price = this.world.priceRecord ? toPriceDTO(this.world.priceRecord) : {
      tick: 0, price: current.price, ret: 0, rawOutput: current.oEma, oEma: current.oEma,
      effectiveOutput: current.oEma, outputLog: 0, newsLevel: 0, noise: 0,
      ...workforceReport(this.world.ids.map(id => ({ id, active: this.world.agents[id].status === 'active', state: this.world.agents[id].state }))),
      feedback: this.priceFeedback, markers: [], guards: { outputFloor: false, priceBound: null, rawLogPrice: Math.log(current.price), logPrice: Math.log(current.price) },
    };
    return { mode: this.mode, mode_reason: this.modeReason, max_ticks: this.maxTicks, speed: this.speed, state: this.state(), price, price_feedback: this.priceFeedback, initial_price: DEFAULT_PARAMS.price.initialPrice, params: DEFAULT_PARAMS };
  }

  history(): HistoryResponse {
    return { ...this.response(), history: this.frames };
  }

  castResponse(): CastResponse {
    return { agents: this.cast.map((c) => c.profile) };
  }

  private emitState() {
    this.emit({ type: 'state', ...this.response() });
  }

  private assertNotComplete() {
    if (this.world.tick >= this.maxTicks) {
      throw new ApiFailure(409, 'run_complete', `The run has finished (${this.maxTicks} ticks). Reset, or raise the run length.`);
    }
  }

  private schedule(delayMs: number) {
    if (this.timer || !this.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.loop();
    }, delayMs);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async loop() {
    if (!this.running) return;
    try {
      await this.runOne();
    } catch (error) {
      console.error('Tick failed:', error instanceof Error ? error.message : String(error));
      this.running = false;
      this.emitState();
      return;
    }
    this.schedule(TICK_INTERVAL_MS / this.speed);
  }

  /** At most one tick in flight; concurrent callers share it. */
  private runOne(): Promise<void> {
    this.inFlight ??= this.advance().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async advance() {
    const generation = this.generation;
    const result = await runTick(this.world, this.provider, this.tickConfig());
    if (generation !== this.generation) return;

    this.world = result.world;
    const records = enrichRecords(result);
    const events = result.log.events.map((e) => ({
      type: e.type,
      is_true: e.is_true,
      text: result.world.claims[e.claim]?.text ?? eventParams[e.type].text,
    }));
    this.feed.push(...events.map((e) => `Event: ${e.text}`), ...records.map((r) => r.summary));

    // Demo safety: if every agent fell back because the LLM failed, run on rules from now on.
    const decisions = result.log.decisions;
    if (
      this.mode !== 'rules' &&
      decisions.length > 0 &&
      decisions.every((d) => d.fallback !== null && d.fallback !== 'llm_proposed_only_masked_actions')
    ) {
      this.mode = 'rules';
      this.modeReason = 'llm_failed';
      console.warn(`LLM unavailable on tick ${result.world.tick}; continuing in rules mode.`);
    }

    if (this.world.tick >= this.maxTicks) {
      this.running = false;
      this.clearTimer();
    }

    const frame: TickFrame = { price: toPriceDTO(result.log.price), tick: this.world.tick, records, events, state: this.state() };
    this.frames.push(frame);
    if (this.frames.length > MAX_HISTORY) this.frames.shift();
    this.emit({ type: 'tick', frame, ...this.response() });
  }

  start() {
    return this.play();
  }

  play() {
    this.assertNotComplete();
    this.started = true;
    if (!this.running) {
      this.running = true;
      this.emitState();
      this.schedule(0);
    }
    return this.response();
  }

  pause() {
    this.running = false;
    this.clearTimer();
    this.emitState();
    return this.response();
  }

  reset() {
    this.clearTimer();
    this.generation += 1;
    this.init(this.seed);
    this.emit({ type: 'history', ...this.history() });
    return this.response();
  }

  async step() {
    if (this.running) throw new ApiFailure(409, 'sim_running', 'Pause the simulation before stepping.');
    if (this.inFlight) throw new ApiFailure(409, 'tick_in_progress', 'A tick is already running.');
    this.assertNotComplete();
    this.started = true;
    await this.runOne();
    return this.response();
  }

  /** Run length. Can change mid-run, but not below the current tick; kept across reset. */
  settings(body: unknown) {
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiFailure(400, 'invalid_settings', `Expected max_ticks (integer 1–${TICK_LIMIT}) and/or price_feedback (boolean).`, parsed.error.issues);
    }
    const max_ticks = parsed.data.max_ticks ?? this.maxTicks;
    const priceFeedback = parsed.data.price_feedback ?? this.priceFeedback;
    if (priceFeedback !== this.priceFeedback && (this.started || this.inFlight)) {
      throw new ApiFailure(409, 'reset_required', 'Reset before changing price feedback.');
    }
    if (max_ticks < this.world.tick) {
      throw new ApiFailure(409, 'below_current_tick', `The run is already at tick ${this.world.tick}; the run length can't go below that.`);
    }
    this.maxTicks = max_ticks;
    this.priceFeedback = priceFeedback;
    if (this.world.tick >= this.maxTicks && this.running) {
      this.running = false;
      this.clearTimer();
    }
    this.emitState();
    return this.response();
  }

  setSpeed(body: unknown) {
    const parsed = z.object({ speed: z.union([z.literal(0.5), z.literal(1), z.literal(2), z.literal(4)]) }).strict().safeParse(body);
    if (!parsed.success) throw new ApiFailure(400, 'invalid_speed', 'Choose a speed of 0.5, 1, 2 or 4.');
    this.speed = parsed.data.speed;
    this.clearTimer();
    // The active tick finishes first; its loop schedules the next one at the new rate.
    if (!this.inFlight) this.schedule(TICK_INTERVAL_MS / this.speed);
    this.emitState();
    return this.response();
  }

  inject(body: unknown) {
    const parsed = injectSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiFailure(400, 'invalid_event', `Expected { type: one of ${EVENT_TYPES.join(', ')}; is_true?: boolean }.`, parsed.error.issues);
    }
    this.assertNotComplete();
    const { type, is_true } = parsed.data;
    this.world = queueEvent(this.world, is_true === undefined ? { type } : { type, isTrue: is_true });
    this.feed.push(`Queued event: ${type}`);
    this.emitState();
    return this.response();
  }
}

export const sim = new OfficeSimManager();
const app = Fastify({ logger: false });

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ApiFailure) {
    return reply.status(error.status).send(errorBody(error.code, error.message, error.details));
  }
  const status = (error as { statusCode?: number }).statusCode;
  const message = error instanceof Error ? error.message : String(error);
  if (status && status >= 400 && status < 500) {
    return reply.status(status).send(errorBody('bad_request', message));
  }
  console.error('Unhandled error:', message);
  return reply.status(500).send(errorBody('internal', 'Internal server error'));
});

app.setNotFoundHandler((request, reply) => {
  reply.status(404).send(errorBody('not_found', `No route for ${request.method} ${request.url}`));
});

app.get('/api/health', async () => {
  const { mode, mode_reason } = sim.response();
  return { ok: true, mode, mode_reason };
});
app.get('/api/sim/cast', async () => sim.castResponse());
app.get('/api/sim/state', async () => sim.response());
app.get('/api/sim/history', async () => sim.history());
app.post('/api/sim/start', async () => sim.start());
app.post('/api/sim/play', async () => sim.play());
app.post('/api/sim/pause', async () => sim.pause());
app.post('/api/sim/reset', async () => sim.reset());
app.post('/api/sim/new-seed', async (request) => {
  const body = request.body as { seed?: number } | undefined;
  const seed = typeof body?.seed === 'number' ? body.seed : undefined;
  return sim.reseed(seed);
});
app.post('/api/sim/step', async () => sim.step());
app.post('/api/sim/inject', async (request) => sim.inject(request.body));
app.post('/api/sim/speed', async (request) => sim.setSpeed(request.body));
app.post('/api/sim/settings', async (request) => sim.settings(request.body));

app.get('/api/events', (request, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const write = (chunk: string) => {
    if (!res.writableEnded && !res.destroyed) res.write(chunk);
  };
  const send: Listener = (message) => write(`data: ${JSON.stringify(message)}\n\n`);

  write('retry: 3000\n\n');
  send({ type: 'history', ...sim.history() });
  sim.subscribe(send);
  const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);

  res.on('close', () => {
    clearInterval(heartbeat);
    sim.unsubscribe(send);
  });
  request.raw.on('error', () => res.destroy());
});

const port = Number(process.env.PORT ?? '3010');
let listening = false;

export function startServer() {
  if (listening) return app;
  listening = true;
  void (async () => {
    try {
      await app.listen({ port, host: '0.0.0.0' });
      const { mode, mode_reason } = sim.response();
      console.log(`Office sim server listening on http://localhost:${port} (mode: ${mode}, ${mode_reason})`);
    } catch (error) {
      console.error('Failed to start server:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  })();
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}

export { app };
