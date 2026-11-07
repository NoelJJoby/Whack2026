// State rules (office-sim/agent.md, tick steps 1, 3, 4, 5). Every number comes
// from params. Functions mutate the world they are given; tick.ts always
// passes a fresh clone, so runTick stays pure from the caller's side.
import type { AgentState, EventType } from '../shared/types';
import { gossipHop, receiveClaim, seedEventClaim } from './claims';
import type { Decision, EngineAgent, HopLog, QueuedEvent, World } from './engine-types';
import type { ClaimImpact, Params } from './params';
import type { Rng, RngFactory } from './rng';

export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

export type StateDelta = Partial<Pick<AgentState, 'stress' | 'workload' | 'loyalty' | 'trust_mgmt' | 'burnout'>>;

/** Apply a delta with clamping. Positive trust_mgmt changes are damped (asymmetry is intentional). */
export function applyDelta(agent: EngineAgent, delta: StateDelta, p: Params): void {
  const s = agent.state;
  if (delta.stress) s.stress = clamp(s.stress + delta.stress);
  if (delta.workload) s.workload = clamp(s.workload + delta.workload);
  if (delta.loyalty) s.loyalty = clamp(s.loyalty + delta.loyalty);
  if (delta.burnout) s.burnout = clamp(s.burnout + delta.burnout);
  if (delta.trust_mgmt) {
    const d = delta.trust_mgmt > 0 ? delta.trust_mgmt * p.rules.trustRecoveryFactor : delta.trust_mgmt;
    s.trust_mgmt = clamp(s.trust_mgmt + d);
  }
}

export function applyImpact(agent: EngineAgent, impact: ClaimImpact | null, scale: number, p: Params): void {
  if (!impact || scale <= 0) return;
  applyDelta(
    agent,
    { stress: impact.stress * scale, trust_mgmt: impact.trust_mgmt * scale, loyalty: impact.loyalty * scale },
    p,
  );
}

function shift(map: Record<string, number>, key: string, delta: number, fallback: number): void {
  map[key] = clamp((map[key] ?? fallback) + delta);
}

const active = (world: World) => world.ids.filter((id) => world.agents[id].status === 'active');

// --- Step 1: events ------------------------------------------------------------

/**
 * Official events reach everyone from management and apply direct effects to
 * the affected function groups. Rumours reach their first hearers only.
 */
export function applyEvent(
  world: World,
  ev: QueuedEvent,
  p: Params,
  rng: Rng,
): { type: EventType; is_true: boolean; claim: string } {
  const e = p.events[ev.type];
  const isTrue = ev.isTrue ?? e.isTrue;
  const ids = active(world);

  if (ev.customEffects) {
    const strength = ev.customMeta?.severity ?? 3;
    const scale = 1 + (strength - 3) * 0.2;
    const productivityShift = ev.customEffects.productivity ?? 0;
    for (const id of ids) {
      const agent = world.agents[id];
      applyDelta(agent, {
        stress: (ev.customEffects.stress ?? 0) * scale,
        loyalty: (ev.customEffects.morale ?? 0) * scale,
        trust_mgmt: (ev.customEffects.trust ?? 0) * scale,
        burnout: (ev.customEffects.burnout ?? 0) * scale,
        workload: productivityShift > 0 ? -Math.abs(productivityShift) * 0.3 : Math.abs(productivityShift) * 0.25,
      }, p);
      if (ev.customEffects.churnRisk) {
        agent.state.stress = clamp(agent.state.stress + (ev.customEffects.churnRisk ?? 0) * 0.25 * scale);
      }
    }
    if (typeof ev.customEffects.priceImpact === 'number' && Number.isFinite(ev.customEffects.priceImpact)) {
      const next = world.price.price * (1 + ev.customEffects.priceImpact * 0.5);
      world.price.price = clamp(next, p.price.minPrice, p.price.maxPrice);
    }
  }

  for (const id of isTrue && !ev.custom ? ids : []) {
    const agent = world.agents[id];
    if (e.groups !== 'all' && !e.groups.includes(agent.profile.functionGroup)) continue;
    const { baselineWorkload, ...direct } = e.direct;
    applyDelta(agent, direct, p);
    agent.baselineWorkload = clamp(agent.baselineWorkload + baselineWorkload);
    if (agent.profile.role === 'Manager' && e.managerStress) applyDelta(agent, { stress: e.managerStress }, p);
  }

  // A rumour from someone who has since left reaches the office via the grapevine.
  const named = ev.source && (ev.source === 'grapevine' || ids.includes(ev.source)) ? ev.source : 'grapevine';
  const source = e.official ? 'mgmt' : named;
  let hearers = ids;
  if (!e.official) {
    const given = (ev.hearers ?? []).filter((id) => ids.includes(id));
    const pool = ids.filter((id) => id !== source);
    hearers = given.length > 0 ? given : pool.length > 0 ? [pool[rng.int(pool.length)]] : [];
  }
  const texts = [e.text, ...(e.variants ?? [])];
  const wording = texts[rng.int(texts.length)];
  const claim = seedEventClaim(world, ev.type, isTrue, source, world.tick, p, ev.text ?? wording, ev.custom);
  for (const id of hearers) {
    if (id === source) continue;
    const r = receiveClaim(world, id, claim.id, source, world.tick, 0, p);
    applyImpact(world.agents[id], r.impact, r.scale, p);
  }
  return { type: ev.type, is_true: isTrue, claim: claim.id };
}

// --- Step 3: resolve actions ---------------------------------------------------

export interface ResolveResult {
  hop?: HopLog;
  verification?: { agent: string; target: string | null; claim: string; result: 'confirmed' | 'refuted' };
  leak?: { agent: string; claim: string };
  noticed?: boolean;
}

export function resolveAction(
  world: World,
  agentId: string,
  decision: Pick<Decision, 'action' | 'target' | 'claim'>,
  p: Params,
  rngs: RngFactory,
): ResolveResult {
  const a = p.rules.actions;
  const agent = world.agents[agentId];
  const target = decision.target ? world.agents[decision.target] : null;

  switch (decision.action) {
    case 'review_work':
    case 'report_issue':
    case 'support_colleague':
      return {};
    case 'work':
      applyDelta(agent, a.work, p);
      return {};

    case 'overwork':
      applyDelta(agent, a.overwork, p);
      return {};

    case 'slack_off': {
      applyDelta(agent, { stress: a.slack_off.stress, workload: a.slack_off.workload }, p);
      const noticed = rngs('notice').chance(a.slack_off.noticeChance);
      if (noticed) {
        applyDelta(agent, { loyalty: a.slack_off.noticedLoyalty }, p);
        for (const id of active(world)) {
          if (id !== agentId) shift(world.agents[id].state.affinity, agentId, a.slack_off.noticedAffinity, p.rules.defaultAffinity);
        }
      }
      return { noticed };
    }

    case 'complain': {
      if (!target) return {};
      const pull = a.complain.pull;
      target.state.stress = clamp(target.state.stress + (agent.state.stress - target.state.stress) * pull);
      target.state.trust_mgmt = clamp(target.state.trust_mgmt + (agent.state.trust_mgmt - target.state.trust_mgmt) * pull);
      applyDelta(agent, { stress: a.complain.speakerStress }, p);
      shift(agent.state.affinity, target.id, a.complain.affinity, p.rules.defaultAffinity);
      shift(target.state.affinity, agentId, a.complain.affinity, p.rules.defaultAffinity);
      return {};
    }

    case 'gossip': {
      if (!target || !decision.claim) return {};
      const hop = gossipHop(world, agentId, target.id, decision.claim, rngs('distort'), p);
      applyImpact(target, hop.impact, hop.scale, p);
      applyDelta(agent, { stress: a.gossip.speakerStress }, p);
      shift(agent.state.affinity, target.id, a.gossip.affinity, p.rules.defaultAffinity);
      shift(target.state.affinity, agentId, a.gossip.affinity, p.rules.defaultAffinity);
      const { impact: _i, scale: _s, newToTarget: _n, ...log } = hop;
      return { hop: log };
    }

    case 'verify': {
      if (!decision.claim) return {};
      const held = agent.claims.find((h) => h.claimId === decision.claim);
      const claim = world.claims[decision.claim];
      if (!held || !claim) return {};
      const correct = rngs('verify').chance(a.verify.accuracy);
      const confirmed = correct === claim.is_true;
      const result = confirmed ? 'confirmed' : 'refuted';
      held.verified = result;
      held.belief = confirmed ? a.verify.confirmedBelief : a.verify.refutedBelief;
      const delta = confirmed ? a.verify.sourceTrustShift : -a.verify.sourceTrustShift;
      if (held.from === 'mgmt') applyDelta(agent, { trust_mgmt: delta }, p);
      else if (world.agents[held.from]) shift(agent.state.source_trust, held.from, delta, p.rules.defaultSourceTrust);
      return { verification: { agent: agentId, target: decision.target, claim: claim.id, result } };
    }

    case 'interview':
      agent.interviewTicks.push(world.tick);
      applyDelta(agent, a.interview, p);
      return {};

    case 'leak': {
      if (!decision.claim) return {};
      const held = agent.claims.find((h) => h.claimId === decision.claim);
      world.leaks.push({ agent: agentId, claim: decision.claim, tick: world.tick });
      for (const id of active(world)) {
        applyDelta(world.agents[id], { trust_mgmt: a.leak.trust_mgmt }, p);
        if (id === agentId) continue;
        const r = receiveClaim(world, id, decision.claim, agentId, world.tick, (held?.depth ?? 0) + 1, p);
        applyImpact(world.agents[id], r.impact, r.scale, p);
      }
      applyDelta(agent, { stress: a.leak.leakerStress }, p);
      return { leak: { agent: agentId, claim: decision.claim } };
    }
  }
}

// --- Step 4: passive updates -------------------------------------------------

export function passiveUpdate(agent: EngineAgent, p: Params): void {
  const q = p.rules.passive;
  const s = agent.state;
  const excess = Math.max(0, s.workload - p.rules.comfortableWorkload);
  const target = q.stressBase + q.stressPerExcessWorkload * excess;
  s.stress = clamp(s.stress + (target - s.stress) * q.stressRelax);
  if (s.stress > q.burnoutStressHigh) {
    s.burnout = clamp(s.burnout + q.burnoutGain + q.burnoutGainPerStress * (s.stress - q.burnoutStressHigh));
  } else if (s.stress < q.burnoutStressLow) {
    s.burnout = clamp(s.burnout - q.burnoutDecay);
  }
  s.workload = clamp(s.workload + (agent.baselineWorkload - s.workload) * q.workloadRelax);
  if (s.stress > q.loyaltyStressHigh) s.loyalty = clamp(s.loyalty - q.loyaltyErosion);
}

// --- Step 5: quit check ------------------------------------------------------

export function burnoutThreshold(agent: EngineAgent, tick: number, p: Params): number {
  const base = agent.profile.traits.quit_threshold || p.quit.defaultBurnoutThreshold;
  const recent = agent.interviewTicks.filter((t) => tick - t < p.quit.interviewWindow).length;
  return base - p.quit.interviewThresholdDrop * recent;
}

/** Quit when burnout exceeds the threshold and (loyalty or trust_mgmt is below its threshold). */
export function checkQuit(agent: EngineAgent, tick: number, p: Params): boolean {
  if (agent.status !== 'active') return false;
  const s = agent.state;
  return (
    s.burnout > burnoutThreshold(agent, tick, p) &&
    (s.loyalty < p.quit.loyaltyThreshold || s.trust_mgmt < p.quit.trustThreshold)
  );
}
