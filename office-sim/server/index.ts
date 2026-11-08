import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { RunStore } from './run-store';
import { Reporting, reportMarkdown } from './reporting';
import { CATALOG, eligible } from './events/catalog';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import Fastify from 'fastify';
import { z } from 'zod';

import type {
  ApiError,
  CastResponse,
  CustomInjectRequest,
  HistoryResponse,
  ModeReason,
  SettingsRequest,
  SimResponse,
  StreamMessage,
  TickFrame,
} from '../shared/api';
import type { DecisionLog, EventType, SimulationMode, SimulationState, TickRecord } from '../shared/types';
import type { CastMember, DecisionLog as EngineDecisionLog, ScenarioEvent, TurnProvider, World } from './engine-types';
import {
  CUSTOM_EVENT_KINDS, CUSTOM_EVENT_LIMITS, checkHeadline, headlineKey,
  inferCustomEventKind,
  type CustomEventKind,
  type GeneratedCustomEvent,
} from '../shared/customEvent';
import { TICKS_PER_QUARTER } from '../shared/workday';
import { createTurnProvider } from './llm';
import { createCustomEventGenerator } from './llm/customEvent';
import { createHeadlineReviewer, type HeadlineReviewer } from './llm/moderation';
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

/** A fresh company on every server start; set SIM_SEED to replay one. */
const randomSeed = () => Math.floor(Math.random() * 1_000_000) + 1;
const envSeed = Number(process.env.SIM_SEED);
const DEFAULT_SEED = Number.isInteger(envSeed) && envSeed > 0 ? envSeed : randomSeed();
/** Default run length (1 quarter = 30 workdays = 240 ticks), and the most ticks a run may be set to (2 quarters = 480 ticks). */
export const DEFAULT_TICKS = TICKS_PER_QUARTER;
export const TICK_LIMIT = TICKS_PER_QUARTER * 2;
/** Minimum gap between tick starts at 1× speed. */
const TICK_INTERVAL_MS = 800;
const HEARTBEAT_MS = 15_000;
const MAX_HISTORY = TICK_LIMIT;
const FEED_LINES = 20;
const EVENT_TYPES = Object.keys(eventParams) as [EventType, ...EventType[]];
/** Events of any kind waiting for the next tick; injecting more is refused. */
const MAX_QUEUED = 4;

const injectSchema = z.object({ type: z.enum(EVENT_TYPES), is_true: z.boolean().optional() }).strict();
// The raw text cap is generous; checkHeadline enforces the real limit after normalising.
const customInjectSchema = z.object({
  text: z.string().max(CUSTOM_EVENT_LIMITS.maxLength * 4),
  is_true: z.boolean(),
}).strict() satisfies z.ZodType<CustomInjectRequest>;
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

export class OfficeSimManager {
  readonly store: RunStore;
  readonly reporting: Reporting;
  private runId = '';
  private phase: string | null = null;
  private storageError: string | null = null;
  private readonly listeners = new Set<Listener>();
  private seed = DEFAULT_SEED;
  cast: CastMember[] = fixtureCast(this.seed);
  private world!: World;
  private frames: TickFrame[] = [];
  private feed: string[] = [];
  private provider: TurnProvider | null = null;
  private reviewer: HeadlineReviewer | null = null;
  private customEventGenerator: ((headline: string, kind: CustomEventKind, isTrue: boolean) => Promise<GeneratedCustomEvent>) | null = null;
  /** headlineKey of every custom event accepted or under review this run. */
  private customHeadlines = new Set<string>();
  /** Custom events under review, counted against the pending limit. */
  private reviewing = 0;
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

  constructor(directory = process.env.SIM_STORE_DIR ?? (process.env.NODE_TEST_CONTEXT ? mkdtempSync(join(tmpdir(),'office-sim-test-')) : fileURLToPath(new URL('../.runtime/runs',import.meta.url))), private readonly overrides: { provider?: TurnProvider; reportProvider?: import('./reporting').ReportProvider } = {}) {
    this.store = new RunStore(directory);
    this.reporting = new Reporting(this.store,this.overrides.reportProvider);
    const latest = this.store.list().find(r => r.status === 'active' || r.status === 'complete');
    this.init(latest?.seed ?? this.seed,latest?.id);
    if (latest) {
      const audit = this.store.read(latest.id).at(-1)?.audit as { settings?: { maxTicks: number; priceFeedback: boolean; speed: number } } | null;
      if (audit?.settings) { this.maxTicks = audit.settings.maxTicks; this.priceFeedback = audit.settings.priceFeedback; this.speed = audit.settings.speed; }
      else if (latest.status === 'complete') this.maxTicks = latest.tick;
    }
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

  private init(seed = this.seed, recoverId?: string) {
    if (this.overrides.provider) {
      this.provider = this.overrides.provider; this.reviewer = null; this.mode = 'llm_bias'; this.modeReason = 'configured';
    } else if (hasApiKey()) {
      this.provider ??= createTurnProvider();
      this.reviewer ??= createHeadlineReviewer();
      this.customEventGenerator ??= createCustomEventGenerator();
      this.mode = 'llm_bias';
      this.modeReason = 'configured';
    } else {
      this.provider = null;
      this.reviewer = null;
      this.customEventGenerator = createCustomEventGenerator();
      this.mode = 'rules';
      this.modeReason = 'no_api_key';
    }
    this.cast = fixtureCast(seed);
    this.world = recoverId ? this.store.recover(recoverId) : createWorld(this.cast, seed);
    this.seed = seed;
    this.runId = recoverId ?? this.store.create(this.world).id;
    this.phase = null; this.storageError = null;
    this.frames = [];
    this.feed = [recoverId ? 'Recovered committed run. Playback is paused.' : 'Simulation ready.'];
    this.customHeadlines = new Set([...Object.values(this.world.claims).filter(c => c.custom).map(c => headlineKey(c.text)),...this.world.queue.filter(e => e.custom && e.text).map(e => headlineKey(e.text!))]);
    this.started = this.world.tick > 0;
    this.running = false;
  }

  reseed(seed?: number) {
    const next = typeof seed === 'number' && Number.isInteger(seed) ? seed : randomSeed();
    this.clearTimer();
    this.generation += 1;
    this.archive();
    this.seed = next;
    this.init(this.seed);
    this.emit({ type: 'history', ...this.history() });
    return this.response();
  }

  private scenario: { key: string; events: ScenarioEvent[] } | null = null;

  /** The billboard schedule for this seed and run length, built once rather than every tick. */
  private billboard(): ScenarioEvent[] {
    const key = `${this.seed}:${this.maxTicks}`;
    if (this.scenario?.key !== key) {
      this.scenario = { key, events: buildScenario(this.seed, this.maxTicks, this.cast.map((c) => c.profile.id)) };
    }
    return this.scenario.events;
  }

  private tickConfig(): TickConfig {
    return { mode: this.mode, scenario: [], gossip: true, billboard: true, priceFeedback: this.priceFeedback, business: true };
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
    const report = this.store.reports(this.runId).at(-1);
    return { run_id: this.runId, revision: this.world.tick, phase: this.phase, storage_error: this.storageError,
      report_status: this.reporting.pending(this.runId) ? 'pending' : report?.status ?? 'none', report_id: report?.id ?? null,
      mode: this.mode, mode_reason: this.modeReason, max_ticks: this.maxTicks, speed: this.speed, state: this.state(), price, price_feedback: this.priceFeedback, initial_price: DEFAULT_PARAMS.price.initialPrice, params: DEFAULT_PARAMS };
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
    const started = performance.now();
    try {
      await this.runOne();
    } catch (error) {
      console.error('Tick failed:', error instanceof Error ? error.message : String(error));
      this.running = false;
      this.emitState();
      return;
    }
    // Playback sets the interval between tick starts, not extra idle time after AI finishes.
    this.schedule(Math.max(0,TICK_INTERVAL_MS / this.speed - (performance.now()-started)));
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
    const queueLength = this.world.queue.length;
    const result = await runTick(this.world, this.provider, { ...this.tickConfig(),
      isCurrent: () => generation === this.generation,
      onPhase: phase => { if (generation === this.generation) { this.phase = phase; this.emitState(); } },
    }).catch(error => { if (generation !== this.generation) return null; throw error; });
    if (!result || generation !== this.generation) return;

    // Injections accepted during a phase belong to the next tick, never disappear on commit.
    result.world.queue.push(...this.world.queue.slice(queueLength));
    try { this.store.commit(this.runId,result.world,'tick',{ log: result.log, settings: { maxTicks: this.maxTicks, priceFeedback: this.priceFeedback, speed: this.speed } }); }
    catch (error) {
      this.storageError = 'History storage failed. The previous tick is retained; retry after restoring storage.';
      this.running = false; this.phase = null; this.clearTimer(); this.emitState(); throw error;
    }
    this.world = result.world; this.phase = null; this.storageError = null;
    const records = enrichRecords(result);
    const events = result.log.events.map((e) => ({
      type: e.type,
      is_true: e.is_true,
      text: result.world.claims[e.claim]?.text ?? eventParams[e.type].text,
      ...(result.world.claims[e.claim]?.custom ? { custom: true } : {}),
    }));
    events.push(...result.world.eventState.cases.filter(e => e.openedTick === result.world.tick).map(e => ({ type: 'new_management' as const, is_true: e.truth, text: e.headline, business_id: e.id, custom: e.origin === 'injection' })));
    this.feed.push(...events.map((e) => `Event: ${e.text}`), ...records.map((r) => r.summary));

    // Demo safety: if every agent fell back because the LLM failed, run on rules from now on.
    const decisions = result.log.decisions;
    if (
      this.mode !== 'rules' &&
      decisions.length > 0 &&
      decisions.every((d) => d.fallback !== null && d.fallback !== 'llm_proposed_only_masked_actions') &&
      !result.world.eventState.decisions.some(d => d.tick === result.world.tick && d.fallback === null)
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
    if (this.world.tick >= this.maxTicks) this.complete();
  }

  private archive() {
    const status = this.store.metadata(this.runId).status;
    if (status !== 'complete') this.store.commit(this.runId,this.world,'archive',{ settings: { maxTicks: this.maxTicks, priceFeedback: this.priceFeedback, speed: this.speed } });
  }
  private complete() {
    const id = this.runId;
    this.store.commit(id,this.world,'complete',{ settings: { maxTicks: this.maxTicks, priceFeedback: this.priceFeedback, speed: this.speed } });
    void this.reporting.generate(id).then(() => { if (this.runId === id) this.emitState(); }).catch(() => {
      if (this.runId === id) { this.storageError = 'Report could not be saved. Committed run evidence remains available for retry.'; this.emitState(); }
    });
    this.emitState();
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
    this.archive();
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
    if (this.world.tick >= this.maxTicks) this.complete();
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

  private persistInput(next: World, audit: unknown) {
    try { this.store.commit(this.runId,next,'input',{ input: audit, settings: { maxTicks: this.maxTicks, priceFeedback: this.priceFeedback, speed: this.speed } }); }
    catch (error) { this.storageError = 'History storage failed. Input was not accepted; restore storage and retry.'; this.running = false; this.clearTimer(); this.emitState(); throw error; }
    this.world = next;
  }
  inject(body: unknown) {
    const parsed = injectSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiFailure(400, 'invalid_event', `Expected { type: one of ${EVENT_TYPES.join(', ')}; is_true?: boolean }.`, parsed.error.issues);
    }
    this.assertNotComplete();
    this.assertQueueRoom();
    const { type, is_true } = parsed.data;
    this.persistInput(queueEvent(this.world, is_true === undefined ? { type } : { type, isTrue: is_true }),parsed.data);
    this.feed.push(`Queued event: ${type}`);
    this.emitState();
    return this.response();
  }

  injectBusiness(body: unknown) {
    const parsed = z.object({ template_id: z.string(), is_true: z.boolean().optional() }).strict().safeParse(body);
    if (!parsed.success || !CATALOG.some(d => d.id === parsed.data.template_id)) throw new ApiFailure(400,'invalid_event','Choose a known structured business template.');
    this.assertNotComplete(); this.assertQueueRoom();
    const template = CATALOG.find(d => d.id === parsed.data.template_id)!;
    if (!eligible(this.world,template)) throw new ApiFailure(422,'ineligible_event','This situation needs eligible clients, work or capacity and cannot duplicate an open case.');
    if (this.world.queue.some(e => e.templateId === template.id)) throw new ApiFailure(409,'duplicate_event','That situation is already queued.');
    this.persistInput(queueEvent(this.world,{ type: 'new_management', templateId: template.id, text: template.headline, isTrue: parsed.data.is_true ?? true }),parsed.data);
    this.emitState(); return this.response();
  }
  private assertQueueRoom() {
    if (this.world.queue.length + this.reviewing >= MAX_QUEUED) {
      throw new ApiFailure(429, 'queue_full', `${MAX_QUEUED} announcements are already waiting. Let the next tick run first.`);
    }
  }

  private assertCustomRoom() {
    this.assertQueueRoom();
    const pending = this.world.queue.filter((e) => e.custom).length + this.reviewing;
    if (pending >= CUSTOM_EVENT_LIMITS.maxPending) {
      throw new ApiFailure(429, 'custom_pending', `${CUSTOM_EVENT_LIMITS.maxPending} of your announcements are already waiting for the next tick.`);
    }
    if (this.customHeadlines.size >= CUSTOM_EVENT_LIMITS.maxPerRun) {
      throw new ApiFailure(429, 'custom_limit', `You can post ${CUSTOM_EVENT_LIMITS.maxPerRun} of your own announcements per run. Reset for more.`);
    }
  }

  private async generateCustomEvent(kind: CustomEventKind | undefined, text: string, isTrue: boolean): Promise<GeneratedCustomEvent> {
   const generator = this.customEventGenerator ?? createCustomEventGenerator();
   const resolvedKind = kind ?? inferCustomEventKind(text);
   return generator(text, resolvedKind, isTrue);
  }

  /**
   * Queue a player-written event. The kind borrows a built-in event's effects;
   * the text must pass the shared rules and, with an API key, a Claude review.
   */
  async injectCustom(body: unknown) {
    const parsed = customInjectSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiFailure(400, 'invalid_event', 'Expected { text: string; is_true: boolean }.', parsed.error.issues);
    }
    this.assertNotComplete();
    this.assertCustomRoom();
    const { is_true } = parsed.data;
    const check = checkHeadline(parsed.data.text);
    if (!check.ok) throw new ApiFailure(422, 'rejected_event', check.message, { reason: check.code });
    const key = headlineKey(check.text);
    if (this.customHeadlines.has(key)) {
      throw new ApiFailure(409, 'duplicate_event', 'That announcement has already been posted this run.');
    }

    const inferredKind = inferCustomEventKind(check.text);
    // Reserve the headline and a pending slot while the review is out, so
    // concurrent requests can't slip past the limits or post it twice.
    const generation = this.generation;
    this.customHeadlines.add(key);
    this.reviewing += 1;
    let verdict;
    try {
      verdict = this.reviewer ? await this.reviewer(check.text) : null;
    } finally {
      this.reviewing -= 1;
    }
    if (generation !== this.generation) {
      throw new ApiFailure(409, 'run_changed', 'The simulation was reset while your announcement was being checked. Post it again.');
    }
    if (verdict && !verdict.allowed) {
      this.customHeadlines.delete(key);
      throw new ApiFailure(422, 'rejected_event', verdict.reason, { reason: 'review' });
    }
    try {
      this.assertNotComplete();
    } catch (error) {
      this.customHeadlines.delete(key);
      throw error;
    }

    const generated = await this.generateCustomEvent(inferredKind, check.text, is_true);
    try { this.persistInput(queueEvent(this.world, {
      type: CUSTOM_EVENT_KINDS[inferredKind].base,
      isTrue: is_true,
      text: generated.headline,
      custom: true,
      customEffects: generated.effects,
      customMeta: { severity: generated.severity, durationTicks: generated.durationTicks, summary: generated.summary },
    }), { kind: inferredKind, text: check.text, is_true }); } catch (error) { this.customHeadlines.delete(key); throw error; }
    this.feed.push(`Queued custom event: ${generated.headline}`);
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
app.post('/api/sim/inject-business', async request => sim.injectBusiness(request.body));
app.get('/api/event-catalog', async () => CATALOG);
app.post('/api/sim/inject-custom', { bodyLimit: 4_096 }, async (request) => sim.injectCustom(request.body));
app.post('/api/sim/speed', async (request) => sim.setSpeed(request.body));
app.post('/api/sim/settings', async (request) => sim.settings(request.body));

app.get('/api/runs', async () => sim.store.list());
app.get<{ Params: { id: string }; Querystring: { cutoff?: string } }>('/api/runs/:id', async (request,reply) => {
  try {
    const txs = sim.store.read(request.params.id);
    const cutoff = request.query.cutoff === undefined ? txs.length : Number(request.query.cutoff);
    if (!Number.isSafeInteger(cutoff) || cutoff < 1 || cutoff > txs.length) throw new Error('Invalid cutoff');
    return { metadata: sim.store.metadata(request.params.id), world: txs[cutoff-1].world, reports: sim.store.reports(request.params.id), pending: sim.reporting.pending(request.params.id) }; }
  catch { return reply.status(404).send(errorBody('run_not_found','Run is unavailable.')); }
});
app.get<{ Params: { id: string } }>('/api/runs/:id/history', async (request,reply) => {
  try { return sim.store.read(request.params.id); } catch { return reply.status(404).send(errorBody('run_not_found','Run history is unavailable.')); }
});
app.post<{ Params: { id: string } }>('/api/runs/:id/report', async (request,reply) => {
  try { sim.store.metadata(request.params.id); } catch { return reply.status(404).send(errorBody('run_not_found','Run is unavailable.')); }
  const input = z.object({ regenerate: z.boolean().optional() }).strict().safeParse(request.body ?? {});
  if (!input.success) throw new ApiFailure(400,'invalid_report_request','Expected an optional regenerate boolean.');
  return sim.reporting.generate(request.params.id,input.data.regenerate ?? false);
});
app.get<{ Params: { id: string; reportId: string }; Querystring: { format?: string } }>('/api/runs/:id/reports/:reportId', async (request,reply) => {
  const report = sim.store.reports(request.params.id).find(r => r.id === request.params.reportId);
  if (!report) return reply.status(404).send(errorBody('report_not_found','Report is unavailable.'));
  if (request.query.format === 'markdown') return reply.type('text/markdown').header('Content-Disposition',`attachment; filename="business-report-${report.version}.md"`).send(reportMarkdown(report));
  return reply.header('Content-Disposition',`attachment; filename="business-report-${report.version}.json"`).send(report);
});

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

// Serve the built demo and its API from one Node process in production.
const clientDirectory = fileURLToPath(new URL('../dist/',import.meta.url));
app.get('/*',async (request,reply) => {
  const pathname = new URL(request.url,'http://localhost').pathname;
  const allowed = pathname === '/' || pathname === '/index.html' || pathname.startsWith('/assets/') || pathname.startsWith('/fonts/');
  if (!allowed) return reply.status(404).send(errorBody('not_found',`No route for ${request.method} ${pathname}`));
  const file = resolve(clientDirectory,pathname === '/' ? 'index.html' : decodeURIComponent(pathname).slice(1));
  if (!file.startsWith(resolve(clientDirectory)+sep)) return reply.status(404).send(errorBody('not_found','Asset unavailable.'));
  const extension = file.split('.').at(-1)!;
  const types: Record<string,string> = { html:'text/html; charset=utf-8', js:'text/javascript; charset=utf-8', css:'text/css; charset=utf-8', woff:'font/woff', woff2:'font/woff2', svg:'image/svg+xml', png:'image/png', ico:'image/x-icon' };
  try { return reply.type(types[extension] ?? 'application/octet-stream').send(await readFile(file)); }
  catch { return reply.status(404).send(errorBody('not_found','Build the client with pnpm build before starting the production demo.')); }
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
