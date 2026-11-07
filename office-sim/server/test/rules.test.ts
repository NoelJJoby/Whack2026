import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Action, HeldClaim } from '../engine-types';
import { DEFAULT_PARAMS as P } from '../params';
import { createRng, type RngFactory } from '../rng';
import { applyDelta, applyEvent, burnoutThreshold, checkQuit, passiveUpdate, resolveAction } from '../rules';
import { makeAgent, makeClaim, makeWorld } from './helpers';

/** Streams whose first draw is ~0 (always "happens") or ~1 (never). */
const always: RngFactory = () => ({ ...createRng(0), next: () => 0, chance: () => true });
const never: RngFactory = () => ({ ...createRng(0), next: () => 0.999, chance: () => false });

const held = (claimId: string, from: string): HeldClaim => ({ claimId, from, tickHeard: 1, depth: 0, belief: null, verified: null });

function pair() {
  const a = makeAgent('a', { stress: 80, trust_mgmt: 20, workload: 50, loyalty: 50, burnout: 30, affinity: { b: 50 }, source_trust: { b: 50 } });
  const b = makeAgent('b', { stress: 30, trust_mgmt: 70, affinity: { a: 50 } });
  return makeWorld([a, b], [], 4);
}

const act = (action: Action, target: string | null = null, claim: string | null = null) => ({ action, target, claim });

describe('rules: action resolvers', () => {
  it('work and overwork apply their deltas', () => {
    const w = pair();
    resolveAction(w, 'a', act('work'), P, never);
    assert.equal(w.agents.a.state.stress, 80 + P.rules.actions.work.stress);
    resolveAction(w, 'a', act('overwork'), P, never);
    assert.equal(w.agents.a.state.workload, 50 + P.rules.actions.overwork.workload);
    assert.equal(w.agents.a.state.burnout, 30 + P.rules.actions.overwork.burnout);
  });

  it('slack_off lowers stress; if noticed, costs loyalty and affinity', () => {
    const w = pair();
    assert.equal(resolveAction(w, 'a', act('slack_off'), P, never).noticed, false);
    assert.equal(w.agents.a.state.loyalty, 50);
    resolveAction(w, 'a', act('slack_off'), P, always);
    assert.equal(w.agents.a.state.loyalty, 50 + P.rules.actions.slack_off.noticedLoyalty);
    assert.equal(w.agents.b.state.affinity.a, 50 + P.rules.actions.slack_off.noticedAffinity);
  });

  it("complain pulls the target's stress and trust toward the speaker's", () => {
    const w = pair();
    resolveAction(w, 'a', act('complain', 'b'), P, never);
    assert.equal(w.agents.b.state.stress, 30 + (80 - 30) * 0.1);
    assert.equal(w.agents.b.state.trust_mgmt, 70 + (20 - 70) * 0.1);
    assert.equal(w.agents.a.state.affinity.b, 52);
  });

  it('gossip delivers the claim to the target', () => {
    const w = pair();
    w.claims.c = makeClaim('c');
    w.agents.a.claims.push(held('c', 'mgmt'));
    const r = resolveAction(w, 'a', act('gossip', 'b', 'c'), P, never);
    assert.equal(r.hop?.to, 'b');
    assert.equal(w.agents.b.claims[0].claimId, 'c');
  });

  it('verify confirms or refutes, locks belief and shifts trust in the teller', () => {
    const w = pair();
    w.claims.f = makeClaim('f', { is_true: false });
    w.agents.a.claims.push(held('f', 'b'));
    const r = resolveAction(w, 'a', act('verify', 'b', 'f'), P, always); // accurate check of a false claim
    assert.equal(r.verification?.result, 'refuted');
    assert.equal(w.agents.a.claims[0].verified, 'refuted');
    assert.equal(w.agents.a.claims[0].belief, P.rules.actions.verify.refutedBelief);
    assert.equal(w.agents.a.state.source_trust.b, 50 - P.rules.actions.verify.sourceTrustShift);
  });

  it('interview is remembered and lowers the quit threshold for a few ticks', () => {
    const w = pair();
    const base = burnoutThreshold(w.agents.a, 4, P);
    resolveAction(w, 'a', act('interview'), P, never);
    assert.equal(burnoutThreshold(w.agents.a, 4, P), base - P.quit.interviewThresholdDrop);
    assert.equal(burnoutThreshold(w.agents.a, 4 + P.quit.interviewWindow, P), base);
  });

  it('leak hits everyone\'s trust in management and makes the claim public', () => {
    const w = pair();
    w.claims.s = makeClaim('s', { scandal: true });
    w.agents.a.claims.push(held('s', 'mgmt'));
    const r = resolveAction(w, 'a', act('leak', null, 's'), P, never);
    assert.equal(r.leak?.claim, 's');
    assert.equal(w.agents.b.state.trust_mgmt, 70 + P.rules.actions.leak.trust_mgmt);
    assert.equal(w.agents.b.claims[0].claimId, 's');
    assert.equal(w.leaks.length, 1);
  });
});

describe('rules: passive updates and trust', () => {
  it('stress rises above comfortable workload and falls at normal workload', () => {
    const hi = makeAgent('hi', { stress: 40, workload: 85 });
    passiveUpdate(hi, P);
    assert.ok(hi.state.stress > 40);
    const lo = makeAgent('lo', { stress: 60, workload: 40 });
    passiveUpdate(lo, P);
    assert.ok(lo.state.stress < 60);
  });

  it('burnout accumulates under high stress and decays slowly under low stress', () => {
    const hot = makeAgent('hot', { stress: 90, workload: 90, burnout: 40 });
    passiveUpdate(hot, P);
    assert.ok(hot.state.burnout > 40);
    const calm = makeAgent('calm', { stress: 20, workload: 30, burnout: 40 });
    passiveUpdate(calm, P);
    assert.equal(calm.state.burnout, 40 - P.rules.passive.burnoutDecay);
  });

  it('trust drops at full size but recovers at half', () => {
    const a = makeAgent('a', { trust_mgmt: 50 });
    applyDelta(a, { trust_mgmt: -10 }, P);
    assert.equal(a.state.trust_mgmt, 40);
    applyDelta(a, { trust_mgmt: 10 }, P);
    assert.equal(a.state.trust_mgmt, 40 + 10 * P.rules.trustRecoveryFactor);
  });

  it('values stay within 0-100', () => {
    const a = makeAgent('a', { stress: 99, burnout: 99 });
    applyDelta(a, { stress: 50, burnout: 50, loyalty: -500 }, P);
    assert.deepEqual([a.state.stress, a.state.burnout, a.state.loyalty], [100, 100, 0]);
  });
});

describe('rules: events', () => {
  it('official events reach everyone from mgmt and hit only the affected groups', () => {
    const sales = makeAgent('s', { workload: 40 }, {}, {});
    sales.profile.functionGroup = 'Sales';
    const eng = makeAgent('e', { workload: 40 });
    const w = makeWorld([sales, eng], [], 1);
    const r = applyEvent(w, { type: 'merger' }, P, createRng(1));
    assert.equal(r.is_true, true);
    assert.equal(w.agents.s.state.workload, 40 + P.events.merger.direct.workload);
    assert.equal(w.agents.e.state.workload, 40);
    assert.deepEqual(w.agents.e.claims.map((h) => h.from), ['mgmt']);
  });

  it('rumours reach only the named first hearers; truth tag can be overridden', () => {
    const w = makeWorld([makeAgent('a', {}), makeAgent('b', {})], [], 2);
    const r = applyEvent(w, { type: 'layoffs_rumour', isTrue: true, hearers: ['b'], source: 'grapevine' }, P, createRng(1));
    assert.equal(r.is_true, true);
    assert.equal(w.agents.a.claims.length, 0);
    assert.equal(w.agents.b.claims[0].from, 'grapevine');
    assert.ok(w.agents.b.state.stress > 50, 'rumour impact scaled by source trust');
  });

  it('managers take extra stress when enforcing the long-hours policy', () => {
    const m = makeAgent('m', { stress: 40 });
    m.profile.role = 'Manager';
    const s = makeAgent('s', { stress: 40 });
    const w = makeWorld([m, s], [], 1);
    applyEvent(w, { type: 'long_hours_policy' }, P, createRng(1));
    assert.equal(w.agents.m.state.stress - w.agents.s.state.stress, P.events.long_hours_policy.managerStress);
  });
});

describe('rules: quit check', () => {
  const agent = (burnout: number, loyalty: number, trust: number) =>
    makeAgent('a', { burnout, loyalty, trust_mgmt: trust }, { quit_threshold: 70 });

  it('needs burnout over the threshold AND low loyalty or low trust', () => {
    assert.equal(checkQuit(agent(71, 29, 90), 1, P), true);
    assert.equal(checkQuit(agent(71, 90, 34), 1, P), true);
    assert.equal(checkQuit(agent(71, 90, 90), 1, P), false);
    assert.equal(checkQuit(agent(70, 0, 0), 1, P), false);
  });

  it('quit_threshold 0 falls back to the default burnout threshold', () => {
    const a = makeAgent('a', { burnout: 79, loyalty: 0 }, { quit_threshold: 0 });
    assert.equal(burnoutThreshold(a, 1, P), P.quit.defaultBurnoutThreshold);
    assert.equal(checkQuit(a, 1, P), false);
  });

  it('agents who already quit never quit again', () => {
    const a = agent(100, 0, 0);
    a.status = 'quit';
    assert.equal(checkQuit(a, 1, P), false);
  });
});
