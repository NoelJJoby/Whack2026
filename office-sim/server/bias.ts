// Bias engine (docs/bias-engine-brief.md). One pure decide(): same inputs and
// seed give the same decision. It never mutates state.
import { heardFresh, pickGossipClaim, pickLeakClaim, pickVerifyClaim, hasBelievedScandal } from './claims';
import {
  ACTIONS,
  LLM_MODES,
  type Action,
  type Decision,
  type EngineAgent,
  type LlmOutput,
  type Mode,
  type World,
} from './engine-types';
import type { Params } from './params';
import type { Rng, RngFactory } from './rng';
import { templateLines } from './templates';

type ActionMap = Record<Action, number>;
type PartialActionMap = Partial<Record<Action, number>>;

/** Every 0-100 value divided by 100. */
export interface Scaled {
  stress: number;
  burnout: number;
  loyalty: number;
  trust_mgmt: number;
  ambition: number;
  financial_need: number;
  ethics: number;
  sociability: number;
  impulsivity: number;
  recruiter_contact: boolean;
}

export function scale(agent: EngineAgent): Scaled {
  const { state, profile } = agent;
  const t = profile.traits;
  return {
    stress: state.stress / 100,
    burnout: state.burnout / 100,
    loyalty: state.loyalty / 100,
    trust_mgmt: state.trust_mgmt / 100,
    ambition: t.ambition / 100,
    financial_need: t.financial_need / 100,
    ethics: t.ethics / 100,
    sociability: t.sociability / 100,
    impulsivity: t.impulsivity / 100,
    recruiter_contact: t.recruiter_contact,
  };
}

export function pressure(s: Scaled, p: Params): number {
  return p.bias.pressureStress * s.stress + p.bias.pressureBurnout * s.burnout;
}

export function gain(s: Scaled, p: Params): number {
  return p.bias.gainBase + p.bias.gainScale * s.impulsivity;
}

/** Unclamped multipliers from the brief's modifier table. */
export function rawModifiers(s: Scaled, fresh: boolean, p: Params): ActionMap {
  const m = p.bias.modifiers;
  const P = pressure(s, p);
  const D = 1 - s.trust_mgmt;
  return {
    work: (1 - m.work.pressure * P) * (1 + m.work.loyalty * s.loyalty),
    overwork:
      (1 + m.overwork.ambition * s.ambition) *
      (1 + m.overwork.financialNeed * s.financial_need) *
      (1 + m.overwork.loyalty * s.loyalty) *
      (1 - m.overwork.burnout * s.burnout),
    slack_off:
      (1 + m.slack_off.pressure * P) * (1 - m.slack_off.loyalty * s.loyalty) * (1 - m.slack_off.financialNeed * s.financial_need),
    complain: (1 + m.complain.pressure * P) * (1 + m.complain.distrust * D) * (m.complain.sociabilityBase + s.sociability),
    gossip: (m.gossip.base + m.gossip.sociability * s.sociability) * (1 + m.gossip.pressure * P) * (fresh ? m.gossip.freshBoost : 1),
    verify: (m.verify.ethicsBase + s.ethics) * (1 + m.verify.distrust * D) * (1 - m.verify.impulsivity * s.impulsivity),
    interview:
      (1 + m.interview.burnout * s.burnout) *
      (m.interview.loyaltyBase - s.loyalty) *
      (1 - m.interview.financialNeed * s.financial_need) *
      (s.recruiter_contact ? m.interview.recruiterBoost : 1),
    leak: (m.leak.base + m.leak.ethicsDistrust * s.ethics * D) * (1 + m.leak.pressure * P),
  };
}

export function clampModifier(x: number, p: Params): number {
  return Math.min(p.bias.clampMax, Math.max(p.bias.clampMin, x));
}

/** Multipliers clamped to [clampMin, clampMax] (before the impulsivity gain). */
export function modifiers(s: Scaled, fresh: boolean, p: Params): ActionMap {
  const raw = rawModifiers(s, fresh, p);
  const out = {} as ActionMap;
  for (const a of ACTIONS) out[a] = clampModifier(raw[a], p);
  return out;
}

export function activeColleagues(agent: EngineAgent, world: World): string[] {
  return world.ids.filter((id) => id !== agent.id && world.agents[id].status === 'active');
}

export interface MaskOptions {
  /** Ablation: gossip off masks gossip for everyone. */
  gossip?: boolean;
}

/** Step 2: mask actions the agent cannot take. */
export function availableActions(
  agent: EngineAgent,
  world: World,
  beliefs: Record<string, number>,
  p: Params,
  opts: MaskOptions = {},
): { available: Action[]; masked: Action[] } {
  const hasColleague = activeColleagues(agent, world).length > 0;
  const hasClaim = agent.claims.length > 0;
  const ok: Record<Action, boolean> = {
    work: true,
    overwork: true,
    slack_off: true,
    interview: true,
    complain: hasColleague,
    gossip: hasColleague && hasClaim && opts.gossip !== false,
    verify: hasColleague && hasClaim,
    leak: hasBelievedScandal(agent, world, beliefs, p),
  };
  return { available: ACTIONS.filter((a) => ok[a]), masked: ACTIONS.filter((a) => !ok[a]) };
}

/**
 * Step 3: normalise proposal weights to sum to 1 (`raw`, 0 if not proposed),
 * then w = max(raw, floor) for every available action. w is not renormalised.
 */
export function llmWeights(
  llm: LlmOutput | null,
  available: readonly Action[],
  p: Params,
): { raw: PartialActionMap; w: PartialActionMap } {
  const raw: PartialActionMap = {};
  const w: PartialActionMap = {};
  const total = llm ? llm.proposals.reduce((s, q) => s + q.weight, 0) : 0;
  for (const a of available) {
    const prop = llm?.proposals.find((q) => q.action === a);
    raw[a] = prop && total > 0 ? prop.weight / total : 0;
    w[a] = Math.max(raw[a] ?? 0, p.bias.floorWeight);
  }
  return { raw, w };
}

export function scoreActions(
  mode: Mode,
  available: readonly Action[],
  weights: { raw: PartialActionMap; w: PartialActionMap },
  m: ActionMap,
  g: number,
  p: Params,
): PartialActionMap {
  const alpha = p.bias.alpha;
  const prior = p.bias.priors;
  const out: PartialActionMap = {};
  for (const a of available) {
    switch (mode) {
      case 'random':
        out[a] = 1;
        break;
      case 'llm_raw':
        out[a] = weights.raw[a] ?? 0;
        break;
      case 'rules':
        out[a] = prior[a] * m[a] ** g;
        break;
      case 'llm_bias':
        out[a] = (weights.w[a] ?? 0) ** alpha * prior[a] ** (1 - alpha) * m[a] ** g;
        break;
    }
  }
  return out;
}

export function normalise(scores: PartialActionMap): PartialActionMap {
  const total = Object.values(scores).reduce((s, v) => s + (v ?? 0), 0);
  const out: PartialActionMap = {};
  for (const a of ACTIONS) if (a in scores) out[a] = total > 0 ? (scores[a] ?? 0) / total : 0;
  return out;
}

// --- Step 8: settle claim and target -----------------------------------------

export function settleClaim(
  action: Action,
  agent: EngineAgent,
  world: World,
  beliefs: Record<string, number>,
  rng: Rng,
  p: Params,
): string | null {
  switch (action) {
    case 'gossip':
      return pickGossipClaim(agent, world, beliefs, rng, p);
    case 'verify':
      return pickVerifyClaim(agent, world, beliefs, rng, p);
    case 'leak':
      return pickLeakClaim(agent, world, beliefs, rng, p);
    default:
      return null;
  }
}

/** Colleagues `verify` may ask: never the claim's original source or the teller, if anyone else is left. */
function verifyCandidates(agent: EngineAgent, world: World, claimId: string | null): string[] {
  const all = activeColleagues(agent, world);
  if (!claimId) return all;
  const held = agent.claims.find((h) => h.claimId === claimId);
  const origin = world.claims[claimId]?.source;
  const strict = all.filter((id) => id !== origin && id !== held?.from);
  if (strict.length > 0) return strict;
  const loose = all.filter((id) => id !== origin);
  return loose.length > 0 ? loose : all;
}

export function settleTarget(
  action: Action,
  claimId: string | null,
  llm: LlmOutput | null,
  agent: EngineAgent,
  world: World,
  rng: Rng,
  p: Params,
): string | null {
  if (action !== 'complain' && action !== 'gossip' && action !== 'verify') return null;
  const candidates = action === 'verify' ? verifyCandidates(agent, world, claimId) : activeColleagues(agent, world);
  if (candidates.length === 0) return null;
  const proposed = llm?.proposals.find((q) => q.action === action)?.target;
  if (proposed && candidates.includes(proposed)) return proposed;
  const eps = p.bias.targetWeightEpsilon;
  const weights = candidates.map((id) =>
    action === 'verify'
      ? (agent.state.source_trust[id] ?? p.rules.defaultSourceTrust) + eps
      : (agent.state.affinity[id] ?? p.rules.defaultAffinity) + eps,
  );
  return rng.weighted(candidates, weights);
}

// --- Explain line ------------------------------------------------------------

const GERUND: Record<Action, string> = {
  work: 'working',
  overwork: 'overworking',
  slack_off: 'slacking off',
  complain: 'complaining',
  gossip: 'gossiping',
  verify: 'checking the facts',
  interview: 'interviewing elsewhere',
  leak: 'leaking',
};

type Driver = [label: string, active: (s: Scaled, fresh: boolean, P: number, hi: number, lo: number) => boolean];

const D = {
  stress: ['stress', (s, _f, _P, hi) => s.stress >= hi] as Driver,
  burnout: ['burnout', (s, _f, _P, hi) => s.burnout >= hi] as Driver,
  distrust: ['distrust of management', (s, _f, _P, _hi, lo) => s.trust_mgmt <= lo] as Driver,
  lowLoyalty: ['low loyalty', (s, _f, _P, _hi, lo) => s.loyalty <= lo] as Driver,
  loyalty: ['loyalty', (s, _f, _P, hi) => s.loyalty >= hi] as Driver,
  ambition: ['ambition', (s, _f, _P, hi) => s.ambition >= hi] as Driver,
  need: ['financial need', (s, _f, _P, hi) => s.financial_need >= hi] as Driver,
  social: ['sociability', (s, _f, _P, hi) => s.sociability >= hi] as Driver,
  ethics: ['ethics', (s, _f, _P, hi) => s.ethics >= hi] as Driver,
  fresh: ['fresh news', (_s, f) => f] as Driver,
  recruiter: ["a recruiter's number", (s) => s.recruiter_contact] as Driver,
  calm: ['calm', (_s, _f, P, _hi, lo) => P <= lo] as Driver,
};

const DRIVERS: Record<Action, Driver[]> = {
  work: [D.loyalty, D.calm],
  overwork: [D.ambition, D.need, D.loyalty],
  slack_off: [D.stress, D.burnout, D.lowLoyalty],
  complain: [D.stress, D.burnout, D.distrust, D.social],
  gossip: [D.social, D.fresh, D.stress],
  verify: [D.ethics, D.distrust],
  interview: [D.burnout, D.lowLoyalty, D.recruiter],
  leak: [D.ethics, D.distrust],
};

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? 'pressure';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function argmax(map: PartialActionMap): Action {
  let best: Action = ACTIONS[0];
  let v = -Infinity;
  for (const a of ACTIONS) {
    if (a in map && (map[a] ?? 0) > v) {
      v = map[a] ?? 0;
      best = a;
    }
  }
  return best;
}

export function explain(
  mode: Mode,
  fallback: string | null,
  raw: PartialActionMap,
  probs: PartialActionMap,
  s: Scaled,
  fresh: boolean,
  p: Params,
): string {
  const P = pressure(s, p);
  const drivers = (a: Action) =>
    joinList(
      DRIVERS[a].filter(([, on]) => on(s, fresh, P, p.bias.explainHigh, p.bias.explainLow)).map(([label]) => label),
    );
  const prefix = fallback ? `LLM fallback (${fallback}). ` : '';
  if (mode === 'random') return `${prefix}Uniform random choice.`;
  if (mode === 'llm_raw') return `${prefix}Took the LLM's lean toward ${GERUND[argmax(raw)]} as given.`;
  if (mode === 'rules') {
    const top = argmax(probs);
    return `${prefix}No LLM; ${drivers(top)} made ${GERUND[top]} most likely.`;
  }
  const lean = argmax(raw);
  let pushed: Action = lean;
  let gap = -Infinity;
  for (const a of ACTIONS) {
    if (!(a in probs)) continue;
    const g = (probs[a] ?? 0) - (raw[a] ?? 0);
    if (g > gap) {
      gap = g;
      pushed = a;
    }
  }
  if (pushed === lean || gap < p.bias.explainMinGap) return `Went with the LLM's lean toward ${GERUND[lean]}.`;
  return `Leaned toward ${GERUND[lean]}; ${drivers(pushed)} pushed toward ${GERUND[pushed]}.`;
}

// --- decide ----------------------------------------------------------------

export interface DecideInput {
  agent: EngineAgent;
  world: World;
  llm: LlmOutput | null;
  mode: Mode;
  rngs: RngFactory;
  params: Params;
  options?: MaskOptions & {
    /** Why llm is null, if it failed upstream (logged). */
    fallbackReason?: string | null;
    cacheHit?: boolean | null;
  };
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;
const roundMap = (m: PartialActionMap): PartialActionMap => {
  const out: PartialActionMap = {};
  for (const a of ACTIONS) if (a in m) out[a] = round(m[a] ?? 0);
  return out;
};

export function decide(input: DecideInput): Decision {
  const { agent, world, mode, rngs, params: p, options = {} } = input;
  const llm = LLM_MODES.includes(mode) ? input.llm : null;
  const beliefs = llm?.beliefs ?? {};
  const s = scale(agent);
  const fresh = heardFresh(agent, world.tick, p);

  // 1-2. Validate (upstream, adapter) and mask.
  const { available, masked } = availableActions(agent, world, beliefs, p, options);

  // Fallback: an LLM mode with no usable LLM output runs as `rules`.
  let effective: Mode = mode;
  let fallback: string | null = null;
  if (LLM_MODES.includes(mode) && !llm) {
    effective = 'rules';
    fallback = options.fallbackReason ?? 'no_output';
  }
  let weights = llmWeights(llm, available, p);
  if (effective === 'llm_raw' && available.every((a) => (weights.raw[a] ?? 0) === 0)) {
    effective = 'rules';
    fallback = 'llm_proposed_only_masked_actions';
  }
  if (effective === 'rules' && fallback) weights = llmWeights(null, available, p);

  // 3-7. Weights, modifiers, gain, blend, sample.
  const m = modifiers(s, fresh, p);
  const g = gain(s, p);
  const probs = normalise(scoreActions(effective, available, weights, m, g, p));
  const { value: action, draw } = rngs('action').pick(probs, ACTIONS);

  // 8. Settle claim and target (separate streams).
  const claim = settleClaim(action, agent, world, beliefs, rngs('claim'), p);
  const target = settleTarget(action, claim, effective === 'rules' ? null : llm, agent, world, rngs('target'), p);

  const useLlmText = !fallback && llm && (llm.public_line || llm.inner_monologue);
  const lines = useLlmText
    ? { public_line: llm!.public_line, inner_monologue: llm!.inner_monologue }
    : templateLines(action, target ? world.agents[target]?.profile.name ?? target : null, claim ? world.claims[claim]?.text ?? null : null, rngs('text'));

  const modsAvail: PartialActionMap = {};
  for (const a of available) modsAvail[a] = m[a];

  return {
    action,
    target,
    claim,
    probs,
    ...lines,
    log: {
      run: world.seed,
      tick: world.tick,
      agent: agent.id,
      mode,
      effective_mode: effective,
      fallback,
      llm: input.llm ? { proposals: input.llm.proposals, cache_hit: options.cacheHit ?? null } : null,
      state: {
        stress: agent.state.stress,
        burnout: agent.state.burnout,
        loyalty: agent.state.loyalty,
        trust_mgmt: agent.state.trust_mgmt,
      },
      fresh,
      masked,
      pressure: round(pressure(s, p)),
      modifiers: roundMap(modsAvail),
      gain: round(g),
      probs: roundMap(probs),
      draw: round(draw),
      chosen: { action, target, claim },
      explain: explain(effective, fallback, weights.raw, probs, s, fresh, p),
    },
  };
}
