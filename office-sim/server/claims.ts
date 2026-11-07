import type { Claim, EventType } from '../shared/types';
import type { EngineAgent, EngineClaim, HeldClaim, HopLog, World } from './engine-types';
import type { ClaimImpact, Params } from './params';
import type { Rng } from './rng';

const DISTORTIONS: Array<(text: string) => string> = [
  (t) => `${t} And it's worse than they're admitting.`,
  (t) => `Apparently it's already been decided: ${t}`,
  (t) => `${t} Management has known for weeks.`,
  (t) => `I heard it's even bigger than that: ${t}`,
];

/** Numbers grow in the retelling. Each rule rewrites the first match it finds. */
const EXAGGERATIONS: Array<[RegExp, (match: string, n: string) => string]> = [
  [/(\d+)%/, (_m, n) => `${Math.min(90, Math.round(Number(n) * 1.5))}%`],
  [/(\d+)-hour/, (_m, n) => `${Math.min(24, Number(n) + 4)}-hour`],
  [/(\d+) (million|people|months|weeks)/, (m, n) => m.replace(n, String(Number(n) * 2))],
  [/\bhalf\b/, () => 'most'],
  [/a third/, () => 'half'],
  [/1 in 4/, () => '1 in 3'],
];

function exaggerate(text: string): string {
  for (const [pattern, grow] of EXAGGERATIONS) {
    if (pattern.test(text)) return text.replace(pattern, grow);
  }
  return text;
}

/**
 * Retell a claim: maybe inflate its numbers, then wrap the underlying claim
 * (not the parent's wrapper, so retellings never pile up) in a frame other
 * than the one `avoid` already uses.
 */
export function distortClaim(core: string, rng?: Rng, avoid?: string): { core: string; text: string } {
  const grown = rng && rng.chance(0.5) ? exaggerate(core) : core;
  const options = DISTORTIONS.map((frame) => frame(grown)).filter((text) => text !== avoid);
  return { core: grown, text: options[rng ? rng.int(options.length) : 0] };
}

export function createClaimFromEvent(text: string, source: string, tick: number, is_true: boolean): Claim {
  return {
    id: `claim-${tick}-${source}`,
    text,
    is_true,
    source,
    created_tick: tick,
    hops: 0,
  };
}

export function spreadClaim(claim: Claim): Claim {
  return { ...claim, id: `${claim.id}-copy`, hops: claim.hops + 1 };
}

// --- Belief ------------------------------------------------------------------

/** How much `agent` trusts `from` (0-100). Management announcements use trust_mgmt. */
export function sourceTrust(agent: EngineAgent, from: string, p: Params): number {
  if (from === 'mgmt') return agent.state.trust_mgmt;
  return agent.state.source_trust[from] ?? p.rules.defaultSourceTrust;
}

/**
 * 0.6 x LLM belief + 0.4 x trust in whoever said it (brief). Without an LLM
 * belief, source trust alone. A verified claim keeps its verified value.
 */
export function effectiveBelief(agent: EngineAgent, held: HeldClaim, llmBelief: number | undefined, p: Params): number {
  if (held.verified && held.belief !== null) return held.belief;
  const trust = sourceTrust(agent, held.from, p);
  const belief = llmBelief ?? held.belief;
  if (belief === null || belief === undefined) return trust;
  const share = p.bias.beliefLlmShare;
  return share * belief + (1 - share) * trust;
}

export function isFresh(held: HeldClaim, tick: number, p: Params): boolean {
  const age = tick - held.tickHeard;
  return age >= 0 && age <= p.bias.freshWindow;
}

export function heardFresh(agent: EngineAgent, tick: number, p: Params): boolean {
  return agent.claims.some((h) => isFresh(h, tick, p));
}

type Beliefs = Record<string, number>;

function argBest(
  agent: EngineAgent,
  candidates: HeldClaim[],
  score: (h: HeldClaim) => number,
  rng: Rng,
): string | null {
  if (candidates.length === 0) return null;
  let best = -Infinity;
  let ties: HeldClaim[] = [];
  for (const h of candidates) {
    const s = score(h);
    if (s > best + 1e-12) {
      best = s;
      ties = [h];
    } else if (Math.abs(s - best) <= 1e-12) {
      ties.push(h);
    }
  }
  return ties.length === 1 ? ties[0].claimId : ties[rng.int(ties.length)].claimId;
}

/** Highest effective belief, x claimFreshBoost if heard recently. */
export function pickGossipClaim(agent: EngineAgent, world: World, beliefs: Beliefs, rng: Rng, p: Params): string | null {
  return argBest(
    agent,
    agent.claims,
    (h) =>
      effectiveBelief(agent, h, beliefs[h.claimId], p) * (isFresh(h, world.tick, p) ? p.bias.claimFreshBoost : 1),
    rng,
  );
}

/** Belief closest to 50; prefers claims not yet verified. */
export function pickVerifyClaim(agent: EngineAgent, _world: World, beliefs: Beliefs, rng: Rng, p: Params): string | null {
  const unverified = agent.claims.filter((h) => !h.verified);
  const pool = unverified.length > 0 ? unverified : agent.claims;
  return argBest(agent, pool, (h) => -Math.abs(effectiveBelief(agent, h, beliefs[h.claimId], p) - 50), rng);
}

function believedScandals(agent: EngineAgent, world: World, beliefs: Beliefs, p: Params): HeldClaim[] {
  return agent.claims.filter(
    (h) =>
      world.claims[h.claimId]?.scandal &&
      effectiveBelief(agent, h, beliefs[h.claimId], p) >= p.bias.leakBeliefThreshold,
  );
}

/** Whether `claimId` may be used for `action` by this agent (held; for leak, a believed scandal). */
export function claimValidFor(
  action: 'gossip' | 'verify' | 'leak',
  claimId: string,
  agent: EngineAgent,
  world: World,
  beliefs: Beliefs,
  p: Params,
): boolean {
  if (action === 'leak') return believedScandals(agent, world, beliefs, p).some((h) => h.claimId === claimId);
  return agent.claims.some((h) => h.claimId === claimId);
}

export function hasBelievedScandal(agent: EngineAgent, world: World, beliefs: Beliefs, p: Params): boolean {
  return believedScandals(agent, world, beliefs, p).length > 0;
}

/** The believed scandal claim with the highest effective belief. */
export function pickLeakClaim(agent: EngineAgent, world: World, beliefs: Beliefs, rng: Rng, p: Params): string | null {
  return argBest(
    agent,
    believedScandals(agent, world, beliefs, p),
    (h) => effectiveBelief(agent, h, beliefs[h.claimId], p),
    rng,
  );
}

// --- Spread ------------------------------------------------------------------

export function seedEventClaim(
  world: World,
  type: EventType,
  isTrue: boolean,
  source: string,
  tick: number,
  p: Params,
  text = p.events[type].text,
  custom = false,
): EngineClaim {
  const e = p.events[type];
  const base = createClaimFromEvent(text, source, tick, isTrue);
  // Two events of one type in the same tick (a scheduled one and an injected
  // one, say) each get their own claim.
  let id = `claim-${tick}-${type}`;
  for (let n = 2; world.claims[id]; n++) id = `claim-${tick}-${type}-${n}`;
  const claim: EngineClaim = {
    ...base,
    id,
    scandal: e.scandal,
    parentId: null,
    rootId: id,
    ...(custom ? { custom: true } : {}),
    event: type,
    onHear: { ...e.onHear },
  };
  world.claims[claim.id] = claim;
  return claim;
}

export interface Received {
  newToTarget: boolean;
  /** Impact to apply (scaled by `scale`), only the first time a lineage is heard. */
  impact: ClaimImpact | null;
  scale: number;
}

/** Give `claimId` to `toId`. Mutates world. */
export function receiveClaim(
  world: World,
  toId: string,
  claimId: string,
  from: string,
  tick: number,
  depth: number,
  p: Params,
): Received {
  const agent = world.agents[toId];
  const claim = world.claims[claimId];
  if (agent.claims.some((h) => h.claimId === claimId)) return { newToTarget: false, impact: null, scale: 0 };
  const newLineage = !agent.claims.some((h) => world.claims[h.claimId]?.rootId === claim.rootId);
  const held: HeldClaim = { claimId, from, tickHeard: tick, depth, belief: null, verified: null };
  agent.claims.push(held);
  claim.hops = Math.max(claim.hops, depth);
  if (!newLineage) return { newToTarget: true, impact: null, scale: 0 };
  return { newToTarget: true, impact: claim.onHear, scale: sourceTrust(agent, from, p) / 100 };
}

/**
 * One gossip hop. With probability distortion_rate the target receives a
 * distorted child claim, which is always tagged false. Mutates world.
 */
export function gossipHop(
  world: World,
  speakerId: string,
  targetId: string,
  claimId: string,
  rng: Rng,
  p: Params,
): HopLog & Received {
  const speaker = world.agents[speakerId];
  const held = speaker.claims.find((h) => h.claimId === claimId);
  const depth = (held?.depth ?? 0) + 1;
  const parent = world.claims[claimId];
  const distorted = rng.chance(speaker.profile.traits.distortion_rate * p.rules.distortionScale);
  let delivered = claimId;
  if (distorted) {
    const child: EngineClaim = {
      ...parent,
      id: `${parent.id}~${world.tick}-${speakerId}`,
      ...distortClaim(parent.core ?? parent.text, rng, parent.text),
      is_true: false,
      source: speakerId,
      created_tick: world.tick,
      hops: depth,
      parentId: parent.id,
      onHear: { ...parent.onHear },
    };
    world.claims[child.id] = child;
    delivered = child.id;
  }
  const r = receiveClaim(world, targetId, delivered, speakerId, world.tick, depth, p);
  return { from: speakerId, to: targetId, claim: claimId, delivered, distorted, new_to_target: r.newToTarget, ...r };
}

// --- Metrics -----------------------------------------------------------------

export interface ClaimReach {
  id: string;
  rootId: string;
  is_true: boolean;
  holders: number;
  hops: number;
}

export function reachByClaim(world: World): ClaimReach[] {
  const counts = new Map<string, number>();
  for (const id of world.ids) {
    for (const h of world.agents[id].claims) counts.set(h.claimId, (counts.get(h.claimId) ?? 0) + 1);
  }
  return Object.values(world.claims).map((c) => ({
    id: c.id,
    rootId: c.rootId,
    is_true: c.is_true,
    holders: counts.get(c.id) ?? 0,
    hops: c.hops,
  }));
}

/** Agent-claim holdings of true vs false claims (each agent counted once per claim). */
export function claimReach(world: World): { true_holders: number; false_holders: number } {
  let t = 0;
  let f = 0;
  for (const c of reachByClaim(world)) {
    if (c.is_true) t += c.holders;
    else f += c.holders;
  }
  return { true_holders: t, false_holders: f };
}
