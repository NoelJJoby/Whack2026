import type { Action, AgentState, EventType } from '../shared/types';
import type { PriceDTO } from '../shared/api';
import { ACTIONS, type EngineAgent, type EngineClaim } from './engine-types';
import { type Params, type PriceParams } from './params';
import type { Rng } from './rng';
import { applyDelta, clamp } from './rules';

/** Engine-only history. Never project truth, lineage or correction schedules to clients. */
export interface NewsItem {
  id: string;
  kind: EventType | 'leak';
  claimId: string;
  rootId: string;
  impact: number;
  bornTick: number;
  isTrue: boolean;
  correctionTick: number | null;
}
export interface PriceState {
  tick: number;
  price: number;
  ret: number;
  oEma: number;
  news: NewsItem[];
}
export interface FeedbackDelta {
  agent: string;
  requested: { trust_mgmt: number; stress: number };
  actual: { trust_mgmt: number; stress: number };
}
export interface PriceRecord {
  tick: number;
  price: number;
  ret: number;
  rawOutput: number;
  effectiveOutput: number;
  oEma: number;
  outputLog: number;
  newsLevel: number;
  contributions: Array<{ id: string; kind: NewsItem['kind']; value: number }>;
  bornIds: string[];
  correctedIds: string[];
  noise: number;
  headcount: number;
  morale: number | null;
  feedback: boolean;
  feedbackDeltas: FeedbackDelta[];
  guards: { outputFloor: boolean; priceBound: 'min' | 'max' | null; rawLogPrice: number; logPrice: number };
}
export interface PriceInput {
  tick: number;
  events: Array<{ type: EventType; is_true: boolean; claim: string }>;
  leaks: Array<{ agent: string; claim: string }>;
  claims: Record<string, EngineClaim>;
  /** One entry per fixed seat; a null action means already vacant before decisions. */
  seats: Array<{ id: string; action: Action | null; burnout: number }>;
  postQuit: Array<{ id: string; active: boolean; state: Pick<AgentState, 'stress' | 'burnout' | 'trust_mgmt'> }>;
  feedback: boolean;
  feedbackDeltas: FeedbackDelta[];
}
const finite = (x: number, name: string) => {
  if (!Number.isFinite(x)) throw new Error(`Invalid price ${name}: must be finite`);
  return x;
};
const integer = (x: number, name: string) => {
  finite(x, name);
  if (!Number.isSafeInteger(x) || x < 0) throw new Error(`Invalid price ${name}: expected nonnegative safe integer`);
};
export function validatePriceParams(p: PriceParams): void {
  for (const key of ['initialPrice', 'oRef', 'outputFloor', 'minPrice', 'maxPrice', 'sigma', 'rho', 'outputAlpha', 'refuteDelay',
    'trustCoefficient', 'trustNegativeCap', 'trustPositiveCap', 'stressCoefficient', 'stressCap', 'overworkBonus'] as const) finite(p[key], key);
  if (!(p.initialPrice > 0 && p.oRef > 0 && p.outputFloor > 0 && p.minPrice > 0 && p.maxPrice > p.minPrice
    && p.initialPrice >= p.minPrice && p.initialPrice <= p.maxPrice
    && p.sigma >= 0 && p.rho > 0 && p.rho <= 1 && p.outputAlpha > 0 && p.outputAlpha <= 1
    && Number.isSafeInteger(p.refuteDelay) && p.refuteDelay > 0)) throw new Error('Invalid price configuration');
  for (const key of ['trustCoefficient', 'trustNegativeCap', 'trustPositiveCap', 'stressCoefficient', 'stressCap', 'overworkBonus'] as const) {
    if (p[key] < 0) throw new Error(`Invalid price ${key}`);
  }
  for (const action of ACTIONS) if (finite(p.productivity[action], action) < 0) throw new Error(`Invalid productivity ${action}`);
  const kinds: Array<EventType | 'leak'> = ['merger', 'new_management', 'long_hours_policy', 'pr_scandal', 'layoffs_rumour', 'surprise_bonus', 'competitor_poaching', 'leak'];
  for (const kind of kinds) finite(p.impacts[kind], kind);
}
export function createPriceState(p: PriceParams, seats: number): PriceState {
  validatePriceParams(p);
  if (!Number.isSafeInteger(seats) || seats <= 0) throw new Error('Price requires a nonempty fixed roster');
  return { tick: 0, price: p.initialPrice, ret: 0, oEma: p.oRef, news: [] };
}

/** Box-Muller draw; 1-u is strictly positive even when the stream returns zero. */
export function normal(rng: Rng): number {
  const u = rng.next();
  const v = rng.next();
  if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) throw new Error('Invalid price RNG draw');
  return Math.sqrt(-2 * Math.log(1 - u)) * Math.cos(2 * Math.PI * v);
}
export function workforceReport(agents: PriceInput['postQuit']): { headcount: number; morale: number | null } {
  for (const a of agents) for (const key of ['stress', 'burnout', 'trust_mgmt'] as const) finite(a.state[key], key);
  const active = agents.filter(a => a.active);
  const morale = active.length ? active.reduce((sum, a) => sum + 0.4 * (1 - clamp(a.state.stress) / 100)
    + 0.3 * (1 - clamp(a.state.burnout) / 100) + 0.3 * clamp(a.state.trust_mgmt) / 100, 0) / active.length : null;
  return { headcount: active.length, morale };
}

/** Pure valuation. All workforce mutations belong to the separate start-of-tick hook. */
export function updatePrice(previous: PriceState, input: PriceInput, p: PriceParams, rng: Rng): { state: PriceState; record: PriceRecord } {
  validatePriceParams(p);
  integer(input.tick, 'tick');
  integer(previous.tick, 'previous tick');
  if (input.tick !== previous.tick + 1) throw new Error('Price updates must be consecutive');
  if (!(finite(previous.price, 'previous price') > 0) || finite(previous.oEma, 'previous output') < 0) throw new Error('Invalid previous price state');
  finite(previous.ret, 'previous return');
  if (!input.seats.length || new Set(input.seats.map(s => s.id)).size !== input.seats.length
    || input.postQuit.length !== input.seats.length || new Set(input.postQuit.map(a => a.id)).size !== input.seats.length
    || input.postQuit.some(a => !input.seats.some(s => s.id === a.id))) throw new Error('Invalid fixed price roster');
  for (const delta of input.feedbackDeltas) for (const d of [delta.requested, delta.actual]) {
    finite(d.stress, 'feedback stress'); finite(d.trust_mgmt, 'feedback trust');
  }
  const rawOutput = finite(input.seats.reduce((sum, seat) => {
    const b = clamp(finite(seat.burnout, 'burnout')) / 100;
    if (seat.action === null) return sum;
    return sum + finite(p.productivity[seat.action], 'productivity') + (seat.action === 'overwork' ? p.overworkBonus * (1 - b) : 0);
  }, 0) / input.seats.length, 'output');
  const oEma = finite(p.outputAlpha * rawOutput + (1 - p.outputAlpha) * previous.oEma, 'smoothed output');
  const born: NewsItem[] = [];
  const add = (id: string, kind: NewsItem['kind'], claimId: string, eventTruth?: boolean) => {
    const claim = input.claims[claimId];
    if (!claim || typeof claim.is_true !== 'boolean' || !claim.rootId) throw new Error(`Invalid price claim ${claimId}`);
    integer(claim.created_tick, 'claim birth');
    if (claim.created_tick > input.tick || (eventTruth !== undefined && eventTruth !== claim.is_true)) throw new Error('Invalid price claim metadata');
    const correctionTick = claim.is_true ? null : claim.created_tick + p.refuteDelay;
    if (correctionTick !== null) integer(correctionTick, 'correction tick');
    born.push({ id, kind, claimId, rootId: claim.rootId, impact: p.impacts[kind], bornTick: input.tick, isTrue: claim.is_true, correctionTick });
  };
  for (const event of input.events) add(event.claim, event.type, event.claim, event.is_true);
  for (const leak of input.leaks) add(`leak:${input.tick}:${leak.agent}:${leak.claim}`, 'leak', leak.claim);
  const news = [...previous.news.map(item => ({ ...item })), ...born];
  if (new Set(news.map(n => n.id)).size !== news.length) throw new Error('Duplicate price news id');
  for (const item of news) {
    finite(item.impact, 'news impact'); integer(item.bornTick, 'news birth');
    if (item.bornTick > input.tick) throw new Error('Invalid price news birth');
    if (item.correctionTick !== null) integer(item.correctionTick, 'news correction');
    if (item.isTrue !== (item.correctionTick === null)) throw new Error('Invalid price correction metadata');
  }
  const contributions = news.map(item => ({ id: item.id, kind: item.kind,
    value: item.correctionTick !== null && input.tick >= item.correctionTick ? 0 : item.impact * p.rho ** (input.tick - item.bornTick) }));
  const correctedIds = news.filter(n => n.correctionTick !== null && input.tick >= n.correctionTick
    && (previous.tick < n.correctionTick || n.bornTick === input.tick)).map(n => n.id);
  const newsLevel = finite(contributions.reduce((sum, item) => sum + item.value, 0), 'news level');
  const noise = finite(p.sigma * normal(rng), 'noise');
  const effectiveOutput = Math.max(p.outputFloor, oEma);
  // Difference of logs avoids overflow/underflow in an otherwise valid output/reference ratio.
  const outputLog = Math.log(effectiveOutput) - Math.log(p.oRef);
  const rawLogPrice = finite(Math.log(p.initialPrice) + outputLog + newsLevel + noise, 'raw log price');
  const logPrice = clamp(rawLogPrice, Math.log(p.minPrice), Math.log(p.maxPrice));
  const price = clamp(Math.exp(logPrice), p.minPrice, p.maxPrice);
  const ret = logPrice - Math.log(previous.price);
  const state: PriceState = { tick: input.tick, price, ret, oEma, news };
  const record: PriceRecord = { tick: input.tick, price, ret, rawOutput, effectiveOutput, oEma, outputLog, newsLevel, contributions,
    bornIds: born.map(n => n.id), correctedIds, noise, ...workforceReport(input.postQuit), feedback: input.feedback,
    feedbackDeltas: structuredClone(input.feedbackDeltas),
    guards: { outputFloor: oEma < p.outputFloor, priceBound: rawLogPrice < Math.log(p.minPrice) ? 'min' : rawLogPrice > Math.log(p.maxPrice) ? 'max' : null, rawLogPrice, logPrice } };
  return { state, record };
}

/** Mutates only active agents in the caller's cloned world, before events/provider contexts. */
export function applyPriceFeedback(previous: PriceState, agents: EngineAgent[], params: Params): FeedbackDelta[] {
  const p = params.price;
  validatePriceParams(p);
  const rPct = finite(100 * previous.ret, 'feedback return');
  return agents.filter(a => a.status === 'active').map(agent => {
    const requested = { trust_mgmt: clamp(p.trustCoefficient * rPct, -p.trustNegativeCap, p.trustPositiveCap), stress: clamp(-p.stressCoefficient * rPct, 0, p.stressCap) };
    const before = { trust_mgmt: agent.state.trust_mgmt, stress: agent.state.stress };
    finite(before.trust_mgmt, 'feedback state trust'); finite(before.stress, 'feedback state stress');
    applyDelta(agent, requested, params);
    return { agent: agent.id, requested, actual: { trust_mgmt: agent.state.trust_mgmt - before.trust_mgmt, stress: agent.state.stress - before.stress } };
  });
}

/** Explicit allowlist projection; engine metadata stays on the server. */
export function toPriceDTO(record: PriceRecord): PriceDTO {
  const { tick, price, ret, rawOutput, effectiveOutput, oEma, outputLog, newsLevel, noise, headcount, morale, feedback, guards } = record;
  return { tick, price, ret, rawOutput, effectiveOutput, oEma, outputLog, newsLevel, noise, headcount, morale, feedback, guards: { ...guards },
    markers: [
      ...record.contributions.filter(c => record.bornIds.includes(c.id)).map(c => ({ id: c.id, kind: c.kind, event: 'headline' as const })),
      ...record.contributions.filter(c => record.correctedIds.includes(c.id)).map(c => ({ id: c.id, kind: c.kind, event: 'correction' as const })),
    ] };
}
