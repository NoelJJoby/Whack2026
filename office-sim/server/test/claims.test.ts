import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  claimReach,
  effectiveBelief,
  gossipHop,
  isFresh,
  pickGossipClaim,
  pickLeakClaim,
  pickVerifyClaim,
  receiveClaim,
  sourceTrust,
} from '../claims';
import type { HeldClaim } from '../engine-types';
import { DEFAULT_PARAMS as P } from '../params';
import { createRng } from '../rng';
import { makeAgent, makeClaim, makeWorld } from './helpers';

const held = (claimId: string, from: string, tickHeard = 1, extra: Partial<HeldClaim> = {}): HeldClaim => ({
  claimId, from, tickHeard, depth: 1, belief: null, verified: null, ...extra,
});

describe('claims: belief', () => {
  it('source trust: agents from source_trust, mgmt from trust_mgmt, unknown from default', () => {
    const a = makeAgent('a', { trust_mgmt: 22, source_trust: { b: 70 } });
    assert.equal(sourceTrust(a, 'b', P), 70);
    assert.equal(sourceTrust(a, 'mgmt', P), 22);
    assert.equal(sourceTrust(a, 'grapevine', P), P.rules.defaultSourceTrust);
  });

  it('effective belief = 0.6 x LLM belief + 0.4 x source trust', () => {
    const a = makeAgent('a', { source_trust: { b: 40 } });
    assert.equal(effectiveBelief(a, held('c', 'b'), 80, P), 0.6 * 80 + 0.4 * 40);
  });

  it('without an LLM belief, source trust alone; stored belief is used if present', () => {
    const a = makeAgent('a', { source_trust: { b: 40 } });
    assert.equal(effectiveBelief(a, held('c', 'b'), undefined, P), 40);
    assert.equal(effectiveBelief(a, held('c', 'b', 1, { belief: 90 }), undefined, P), 0.6 * 90 + 0.4 * 40);
  });

  it('verified claims keep their verified belief', () => {
    const a = makeAgent('a', { source_trust: { b: 40 } });
    assert.equal(effectiveBelief(a, held('c', 'b', 1, { belief: 10, verified: 'refuted' }), 95, P), 10);
  });

  it('fresh means heard within the last 2 ticks', () => {
    assert.ok(isFresh(held('c', 'b', 5), 5, P));
    assert.ok(isFresh(held('c', 'b', 5), 7, P));
    assert.ok(!isFresh(held('c', 'b', 5), 8, P));
  });
});

describe('claims: selection', () => {
  const rng = () => createRng(1);

  it('gossip: highest effective belief, x1.5 if fresh', () => {
    const a = makeAgent('a', { source_trust: { b: 60, c: 50 } }, {}, {
      claims: [held('old', 'b', 1), held('new', 'c', 9)],
    });
    const w = makeWorld([a, makeAgent('b', {}), makeAgent('c', {})], [makeClaim('old'), makeClaim('new')], 10);
    // old: 60, stale. new: 50 x 1.5 = 75.
    assert.equal(pickGossipClaim(a, w, {}, rng(), P), 'new');
    // With LLM beliefs: old 0.6*100+0.4*60 = 84 > new (0.6*10+0.4*50)*1.5 = 39.
    assert.equal(pickGossipClaim(a, w, { old: 100, new: 10 }, rng(), P), 'old');
  });

  it('verify: belief closest to 50, preferring unverified claims', () => {
    const a = makeAgent('a', { source_trust: { b: 90, c: 55 } }, {}, {
      claims: [held('sure', 'b'), held('unsure', 'c'), held('done', 'c', 1, { belief: 50, verified: 'confirmed' })],
    });
    const w = makeWorld([a, makeAgent('b', {}), makeAgent('c', {})], [makeClaim('sure'), makeClaim('unsure'), makeClaim('done')]);
    assert.equal(pickVerifyClaim(a, w, {}, rng(), P), 'unsure');
  });

  it('leak: the believed scandal with the highest belief; null without one', () => {
    const a = makeAgent('a', { source_trust: { b: 70, c: 90 } }, {}, {
      claims: [held('s1', 'b'), held('s2', 'c'), held('plain', 'c')],
    });
    const w = makeWorld(
      [a, makeAgent('b', {}), makeAgent('c', {})],
      [makeClaim('s1', { scandal: true }), makeClaim('s2', { scandal: true }), makeClaim('plain')],
    );
    assert.equal(pickLeakClaim(a, w, {}, rng(), P), 's2');
    assert.equal(pickLeakClaim(a, w, { s2: 0, s1: 100 }, rng(), P), 's1');
    assert.equal(pickLeakClaim(a, w, { s1: 0, s2: 0 }, rng(), P), null);
  });
});

describe('claims: spread', () => {
  function world(rate: number) {
    const a = makeAgent('a', {}, { distortion_rate: rate }, { claims: [held('c', 'mgmt', 1, { depth: 0 })] });
    const b = makeAgent('b', { source_trust: { a: 80 } });
    return makeWorld([a, b], [makeClaim('c', { onHear: { stress: 10, trust_mgmt: 0, loyalty: 0 } })], 3);
  }

  it('distortion rate 0 passes the claim on unchanged', () => {
    const w = world(0);
    const hop = gossipHop(w, 'a', 'b', 'c', createRng(1), P);
    assert.equal(hop.distorted, false);
    assert.equal(hop.delivered, 'c');
    assert.deepEqual(w.agents.b.claims.map((h) => [h.claimId, h.from, h.depth]), [['c', 'a', 1]]);
    assert.equal(w.claims.c.hops, 1);
  });

  it('distortion rate 100 creates a false child claim in the same lineage', () => {
    const w = world(100);
    const hop = gossipHop(w, 'a', 'b', 'c', createRng(1), P);
    assert.equal(hop.distorted, true);
    const child = w.claims[hop.delivered];
    assert.equal(child.is_true, false);
    assert.equal(child.parentId, 'c');
    assert.equal(child.rootId, 'c');
    assert.notEqual(child.text, w.claims.c.text);
    assert.equal(w.agents.b.claims[0].claimId, child.id);
  });

  it('hearing a lineage applies its impact once, scaled by source trust', () => {
    const w = world(0);
    const r1 = gossipHop(w, 'a', 'b', 'c', createRng(1), P);
    assert.deepEqual([r1.impact?.stress, r1.scale], [10, 0.8]);
    const r2 = receiveClaim(w, 'b', 'c', 'a', 3, 1, P);
    assert.equal(r2.newToTarget, false);
    assert.equal(r2.impact, null);
  });

  it('reach counts agent holdings of true vs false claims', () => {
    const w = world(100);
    gossipHop(w, 'a', 'b', 'c', createRng(1), P);
    assert.deepEqual(claimReach(w), { true_holders: 1, false_holders: 1 });
  });
});
