import type { AgentRuntimeState, AgentState, EventType, SimulationState, TickRecord } from '../shared/types';
import { availableActions, decide } from './bias';
import { claimReach } from './claims';
import {
  LLM_MODES,
  type CastMember,
  type Decision,
  type EngineAgent,
  type EngineTickLog,
  type LlmOutput,
  type ProviderLog,
  type QueuedEvent,
  type RunConfig,
  type TurnContext,
  type TurnProvider,
  type World,
} from './engine-types';
import { toLlmOutput } from './llm-adapter';
import type { CallMetrics } from './llm/client';
import { withRequestMetrics } from './llm/telemetry';
import { crackOrderFromEvents, firstQuitTime } from './metrics';
import { DEFAULT_PARAMS, type Params } from './params';
import { applyPriceFeedback, createPriceState, updatePrice, workforceReport } from './price';
import { rngFactory, stream } from './rng';
import { applyEvent, checkQuit, passiveUpdate, resolveAction, type ResolveResult } from './rules';
import { ensureExamples, initSpeech, planRound, recordRound, reviewRound, speechContext } from './speech';

export function createInitialSimulation(seed = 42): SimulationState {
  return {
    tick: 0,
    seed,
    started: false,
    running: false,
    event: null,
    queue: [],
    feed: ['Simulation ready.'],
    claims: [],
    agents: {},
    metrics: {
      crack_order: [],
      first_quit_tick: null,
      true_reach: 0,
      false_reach: 0,
    },
  };
}

export function stepSimulation(state: SimulationState): SimulationState {
  return {
    ...state,
    tick: state.tick + 1,
    feed: [...state.feed, `Tick ${state.tick + 1} complete.`],
  };
}

export function injectEvent(state: SimulationState, event: EventType): SimulationState {
  return {
    ...state,
    queue: [...state.queue, event],
    feed: [...state.feed, `Queued event: ${event}`],
  };
}

// ---------------------------------------------------------------------------
// Engine tick loop. The three functions above are kept unchanged for
// index.ts; new callers should use createWorld / runTick / toSimulationState.
// ---------------------------------------------------------------------------

export function createWorld(cast: CastMember[], seed: number, params: Params = DEFAULT_PARAMS): World {
  const ids = cast.map((c) => c.profile.id);
  const price = createPriceState(params.price, ids.length);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate roster ids');
  const agents: Record<string, EngineAgent> = {};
  for (const c of cast) {
    const others = ids.filter((id) => id !== c.profile.id);
    const { affinity, source_trust, ...rest } = c.start;
    agents[c.profile.id] = {
      id: c.profile.id,
      profile: structuredClone(c.profile),
      state: {
        ...rest,
        affinity: Object.fromEntries(others.map((o) => [o, affinity?.[o] ?? params.rules.defaultAffinity])),
        source_trust: Object.fromEntries(others.map((o) => [o, source_trust?.[o] ?? params.rules.defaultSourceTrust])),
      },
      status: 'active',
      quitTick: null,
      interviewTicks: [],
      baselineWorkload: rest.workload,
      claims: [],
    };
  }
  const world: World = { seed, tick: 0, ids, agents, claims: {}, queue: [], quits: [], leaks: [], price, priceRecord: null };
  if (params.voice) world.speech = initSpeech(world, params);
  return world;
}

/** Judge injection: the event applies at the start of the next tick. Returns a new world. */
export function queueEvent(world: World, event: QueuedEvent): World {
  return { ...world, queue: [...world.queue, event] };
}

/** What the LLM is told about an agent. Never includes truth tags. */
export function buildContext(
  world: World,
  agent: EngineAgent,
  config: Pick<RunConfig, 'mode' | 'gossip'>,
  events: Array<{ type: EventType; claim: string }>,
  params: Params,
): TurnContext {
  const beliefs: Record<string, number> = {};
  for (const h of agent.claims) if (h.belief !== null) beliefs[h.claimId] = h.belief;
  return {
    tick: world.tick,
    mode: config.mode,
    state: structuredClone(agent.state),
    available: availableActions(agent, world, beliefs, params, { gossip: config.gossip }).available,
    colleagues: world.ids
      .filter((id) => id !== agent.id && world.agents[id].status === 'active')
      .map((id) => ({
        id,
        name: world.agents[id].profile.name,
        group: world.agents[id].profile.functionGroup,
        affinity: agent.state.affinity[id] ?? params.rules.defaultAffinity,
        source_trust: agent.state.source_trust[id] ?? params.rules.defaultSourceTrust,
      })),
    claims: agent.claims.map((h) => ({
      id: h.claimId,
      text: world.claims[h.claimId].text,
      from: h.from,
      tick_heard: h.tickHeard,
      scandal: world.claims[h.claimId].scandal,
    })),
    events: events.map((e) => ({ type: e.type, text: world.claims[e.claim].text })),
  };
}

async function callProvider(
  provider: TurnProvider,
  agent: EngineAgent,
  ctx: TurnContext,
  retries: number,
): Promise<{ output: LlmOutput | null; reason: string | null; providerLog: ProviderLog }> {
  let reason: string | null = null;
  const providerLog: ProviderLog = {
    attempts: 0, retry_count: 0, cache_hit: null, latency_ms: null, usage: null, requests: [],
  };
  for (let attempt = 0; attempt <= retries; attempt++) {
    const metrics: CallMetrics[] = [];
    providerLog.attempts++;
    providerLog.retry_count = attempt;
    try {
      const r = toLlmOutput(await withRequestMetrics(metrics, () => provider(agent.profile, ctx)));
      reason = r.reason;
      if (r.output) return { output: r.output, reason: null, providerLog };
    } catch {
      reason = 'provider_error';
    } finally {
      for (const metric of metrics) {
        providerLog.requests.push({ ...metric, attempt: attempt + 1, validation_error: reason });
        providerLog.cache_hit = false;
        providerLog.latency_ms = (providerLog.latency_ms ?? 0) + metric.latencyMs;
        if (metric.usage) {
          providerLog.usage ??= { promptTokens: 0, completionTokens: 0 };
          providerLog.usage.promptTokens += metric.usage.promptTokens;
          providerLog.usage.completionTokens += metric.usage.completionTokens;
        }
      }
    }
  }
  return { output: null, reason, providerLog };
}

function summarise(world: World, d: Decision, agentId: string, r: ResolveResult, quit: boolean): string {
  const name = (id: string | null) => (id ? world.agents[id]?.profile.name ?? id : 'someone');
  const me = name(agentId);
  const claim = d.claim ? world.claims[r.hop?.delivered ?? d.claim]?.text : null;
  let s: string;
  switch (d.action) {
    case 'work':
      s = `${me} works normally.`;
      break;
    case 'overwork':
      s = `${me} overworks.`;
      break;
    case 'slack_off':
      s = `${me} slacks off${r.noticed ? ' and gets noticed' : ''}.`;
      break;
    case 'complain':
      s = `${me} complains to ${name(d.target)}.`;
      break;
    case 'gossip':
      s = `${me} tells ${name(d.target)}: "${claim}"${r.hop?.distorted ? ' (distorted)' : ''}`;
      break;
    case 'verify':
      s = `${me} checks a claim with ${name(d.target)}: ${r.verification?.result ?? 'no answer'}.`;
      break;
    case 'interview':
      s = `${me} goes to an outside interview.`;
      break;
    case 'leak':
      s = `${me} leaks to the press: "${claim}"`;
      break;
  }
  return quit ? `${s} ${me} quits.` : s;
}

export interface TickResult {
  world: World;
  records: TickRecord[];
  log: EngineTickLog;
}

export type TickConfig = Pick<RunConfig, 'mode' | 'scenario' | 'gossip' | 'billboard'> & Partial<Pick<RunConfig, 'priceFeedback'>>;

/**
 * One tick: previous-return feedback -> apply event -> agent turns (LLM, all on the start-of-tick
 * snapshot) -> bias engine -> resolve in seeded order -> passive updates ->
 * quit check -> price -> record. Never mutates `world`.
 */
export async function runTick(
  world: World,
  provider: TurnProvider | null,
  config: TickConfig,
  params: Params = DEFAULT_PARAMS,
): Promise<TickResult> {
  const w = structuredClone(world);
  w.tick += 1;
  const t = w.tick;
  const feedbackDeltas = config.priceFeedback ? applyPriceFeedback(world.price, w.ids.map(id => w.agents[id]), params) : [];

  // 1. Apply events: scripted for this tick, then anything the judges queued.
  const pending: QueuedEvent[] = [
    ...config.scenario.filter((e) => e.tick === t).map(({ tick: _t, ...e }) => e),
    ...w.queue,
  ];
  w.queue = [];
  const events = config.billboard
    ? pending.map((ev, i) => applyEvent(w, ev, params, stream(w.seed, t, `event-${i}`, 'event')))
    : [];

  // 2. Agent turns in seeded random order.
  const activeIds = w.ids.filter((id) => w.agents[id].status === 'active');
  const order = stream(w.seed, t, '*', 'order').shuffle(activeIds);

  const llm: Record<string, { output: LlmOutput | null; reason: string | null; providerLog?: ProviderLog }> = {};
  // Voice: manners are drawn in turn order before the calls (server/speech.ts).
  const speaking = LLM_MODES.includes(config.mode) && Boolean(w.speech && params.voice?.enabled);
  const styles = speaking ? planRound(w, order, params) : {};
  let speechLogs: Awaited<ReturnType<typeof reviewRound>> | null = null;
  let examples: Awaited<ReturnType<typeof ensureExamples>> = { added: {}, requests: 0 };
  if (LLM_MODES.includes(config.mode)) {
    if (speaking && provider) examples = await ensureExamples(w, activeIds, provider, params);
    const contexts: Record<string, TurnContext> = {};
    for (const id of activeIds) {
      contexts[id] = buildContext(w, w.agents[id], config, events, params);
      if (styles[id]) contexts[id].speech = speechContext(w, id, styles[id], params);
    }
    const results = await Promise.all(
      activeIds.map((id) =>
        provider
          ? callProvider(provider, w.agents[id], contexts[id], params.bias.llmRetries)
          : Promise.resolve({ output: null, reason: 'no_provider' }),
      ),
    );
    activeIds.forEach((id, i) => (llm[id] = results[i]));
    // Remember the LLM's latest beliefs (verified claims stay locked).
    for (const id of activeIds) {
      const beliefs = llm[id].output?.beliefs ?? {};
      for (const h of w.agents[id].claims) {
        if (!h.verified && beliefs[h.claimId] !== undefined) h.belief = beliefs[h.claimId];
      }
    }
    if (speaking && provider) {
      speechLogs = await reviewRound({
        world: w, order, llm, contexts, provider, styles, params,
        events: events.map((e) => ({ type: e.type, text: w.claims[e.claim].text, custom: w.claims[e.claim].custom === true })),
      });
    }
  }

  // 3. Bias engine: every agent decides on the same snapshot.
  const decisions: Record<string, Decision> = {};
  for (const id of order) {
    decisions[id] = decide({
      agent: w.agents[id],
      world: w,
      llm: llm[id]?.output ?? null,
      mode: config.mode,
      rngs: rngFactory(w.seed, t, id),
      params,
      options: { gossip: config.gossip, fallbackReason: llm[id]?.reason ?? null },
    });
    if (llm[id]?.providerLog) {
      decisions[id].log.provider = llm[id].providerLog;
      if (decisions[id].log.llm) decisions[id].log.llm!.cache_hit = llm[id].providerLog!.cache_hit;
    }
    if (speechLogs?.logs[id]) decisions[id].log.speech = speechLogs.logs[id];
  }
  if (speaking) recordRound(w, styles, order.map((id) => ({ agent: id, public_line: decisions[id].public_line })), params);

  const seats = w.ids.map(id => ({ id, action: decisions[id]?.action ?? null, burnout: w.agents[id].state.burnout }));

  // 4. Resolve in order.
  const results: Record<string, ResolveResult> = {};
  for (const id of order) results[id] = resolveAction(w, id, decisions[id], params, rngFactory(w.seed, t, id));

  // 5. Passive updates, then 6. quit check.
  for (const id of activeIds) passiveUpdate(w.agents[id], params);
  const quits: string[] = [];
  for (const id of activeIds) {
    if (checkQuit(w.agents[id], t, params)) {
      w.agents[id].status = 'quit';
      w.agents[id].quitTick = t;
      w.quits.push({ agent: id, tick: t });
      quits.push(id);
    }
  }

  const leaks = order.flatMap(id => results[id].leak ? [results[id].leak!] : []);
  const valuation = updatePrice(world.price, {
    tick: t, events, leaks, claims: w.claims, seats,
    postQuit: w.ids.map(id => ({ id, active: w.agents[id].status === 'active', state: w.agents[id].state })),
    feedback: config.priceFeedback ?? false, feedbackDeltas,
  }, params.price, stream(w.seed, t, '*', 'price'));
  w.price = valuation.state;
  w.priceRecord = valuation.record;

  // 7. Record.
  const firstEvent = events[0]?.type ?? null;
  const records: TickRecord[] = order.map((id) => ({
    tick: t,
    event: firstEvent,
    action: decisions[id].action,
    agent: id,
    target: decisions[id].target,
    summary: summarise(w, decisions[id], id, results[id], quits.includes(id)),
  }));

  const states: EngineTickLog['states'] = {};
  for (const id of w.ids) states[id] = { ...structuredClone(w.agents[id].state), status: w.agents[id].status };

  const log: EngineTickLog = {
    price: valuation.record,
    tick: t,
    events,
    order,
    decisions: order.map((id) => decisions[id].log),
    lines: order.map((id) => ({
      agent: id,
      public_line: decisions[id].public_line,
      inner_monologue: decisions[id].inner_monologue,
    })),
    hops: order.flatMap((id) => (results[id].hop ? [results[id].hop!] : [])),
    verifications: order.flatMap((id) => (results[id].verification ? [results[id].verification!] : [])),
    leaks,
    quits,
    states,
    reach: claimReach(w),
  };
  if (t === 1 && w.speech) log.voices = structuredClone(w.speech.voices);
  if (Object.keys(examples.added).length) log.examples = examples.added;
  if (speechLogs) log.speech = { ...speechLogs.summary, example_requests: examples.requests };

  return { world: w, records, log };
}

export interface RunSummary {
  seed: number;
  mode: RunConfig['mode'];
  ticks: number;
  crack_order: string[];
  crack_order_archetypes: string[];
  first_quit_tick: number | null;
  /** Ticks from the first event to the first quit. */
  time_to_first_quit: number | null;
  quits: number;
  reach: { true_holders: number; false_holders: number };
  leaks: number;
  fallbacks: number;
  price: number;
  priceFeedback: boolean;
  headcount: number;
  morale: number | null;
}

export interface RunResult {
  config: RunConfig;
  params: Params;
  world: World;
  records: TickRecord[];
  logs: EngineTickLog[];
  summary: RunSummary;
}

export function summariseRun(world: World, config: RunConfig, logs: EngineTickLog[]): RunSummary {
  const crack = crackOrderFromEvents(world.quits);
  const firstQuit = firstQuitTime(world.quits);
  const firstEvent = logs.find((l) => l.events.length > 0)?.tick ?? null;
  return {
    seed: config.seed,
    mode: config.mode,
    ticks: world.tick,
    crack_order: crack,
    crack_order_archetypes: crack.map((id) => world.agents[id].profile.archetype),
    first_quit_tick: firstQuit,
    time_to_first_quit: firstQuit !== null && firstEvent !== null ? firstQuit - firstEvent : null,
    quits: world.quits.length,
    reach: claimReach(world),
    leaks: world.leaks.length,
    price: world.price.price,
    priceFeedback: config.priceFeedback,
    ...workforceReport(world.ids.map(id => ({ id, active: world.agents[id].status === 'active', state: world.agents[id].state }))),
    fallbacks: logs.reduce((n, l) => n + l.decisions.filter((d) => d.fallback).length, 0),
  };
}

export async function runSimulation(
  cast: CastMember[],
  config: RunConfig,
  provider: TurnProvider | null,
  params: Params = DEFAULT_PARAMS,
  onTick?: (r: TickResult) => void,
): Promise<RunResult> {
  let world = createWorld(cast, config.seed, params);
  const records: TickRecord[] = [];
  const logs: EngineTickLog[] = [];
  for (let i = 0; i < config.ticks; i++) {
    const r = await runTick(world, provider, config, params);
    world = r.world;
    records.push(...r.records);
    logs.push(r.log);
    onTick?.(r);
  }
  return { config, params, world, records, logs, summary: summariseRun(world, config, logs) };
}

/** Project the engine world onto the shared SimulationState. */
export function toSimulationState(world: World, feed: string[] = []): SimulationState {
  const agents: Record<string, AgentRuntimeState> = {};
  for (const id of world.ids) {
    const agent = world.agents[id];
    agents[id] = {
      ...structuredClone(agent.state),
      status: agent.status,
      quit_tick: agent.quitTick,
    };
  }
  const reach = claimReach(world);
  return {
    tick: world.tick,
    seed: world.seed,
    started: world.tick > 0,
    running: false,
    event: null,
    queue: world.queue.map((e) => e.type),
    queue_text: world.queue.map((e) => e.text ?? null),
    feed,
    claims: Object.values(world.claims).map(({ id, text, is_true, source, created_tick, hops }) => ({
      id,
      text,
      is_true,
      source,
      created_tick,
      hops,
    })),
    agents,
    metrics: {
      crack_order: crackOrderFromEvents(world.quits),
      first_quit_tick: firstQuitTime(world.quits),
      true_reach: reach.true_holders,
      false_reach: reach.false_holders,
    },
  };
}
