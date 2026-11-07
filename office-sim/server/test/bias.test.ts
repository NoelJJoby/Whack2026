import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  availableActions,
  decide,
  gain,
  llmWeights,
  modifiers,
  normalise,
  pressure,
  rawModifiers,
  scale,
  scoreActions,
} from '../bias';
import { ACTIONS, type Action, type LlmOutput, type Mode } from '../engine-types';
import { DEFAULT_PARAMS as P } from '../params';
import { createRng, rngFactory, type RngFactory } from '../rng';
import { makeAgent, makeClaim, makeWorld } from './helpers';

const TICK = 5;

/** Lena: heard a non-scandal claim last tick, so gossip and verify are open, leak is masked. */
function lenaWorld() {
  const lena = makeAgent(
    'lena',
    { stress: 80, burnout: 78, loyalty: 30, trust_mgmt: 35 },
    { ambition: 50, financial_need: 30, ethics: 50, sociability: 40, impulsivity: 60, recruiter_contact: true },
    { claims: [{ claimId: 'c1', from: 'tom', tickHeard: TICK - 1, depth: 1, belief: null, verified: null }] },
  );
  const tom = makeAgent('tom', {});
  return { agent: lena, world: makeWorld([lena, tom], [makeClaim('c1')], TICK) };
}

/** Tom: holds a stale claim (not fresh). */
function tomWorld() {
  const tom = makeAgent(
    'tom',
    { stress: 30, burnout: 10, loyalty: 85, trust_mgmt: 75 },
    { ambition: 40, financial_need: 40, ethics: 60, sociability: 35, impulsivity: 25, recruiter_contact: false },
    { claims: [{ claimId: 'c1', from: 'lena', tickHeard: TICK - 4, depth: 1, belief: null, verified: null }] },
  );
  const lena = makeAgent('lena', {});
  return { agent: tom, world: makeWorld([tom, lena], [makeClaim('c1')], TICK) };
}

const lenaLlm: LlmOutput = {
  proposals: [
    { action: 'work', weight: 0.6 },
    { action: 'complain', weight: 0.3 },
    { action: 'interview', weight: 0.1 },
  ],
  public_line: '',
  inner_monologue: '',
  beliefs: {},
};

const tomLlm: LlmOutput = {
  proposals: [
    { action: 'work', weight: 0.8 },
    { action: 'overwork', weight: 0.2 },
  ],
  public_line: '',
  inner_monologue: '',
  beliefs: {},
};

const rngs: RngFactory = rngFactory(1, TICK, 'x');

function probsFor(w: ReturnType<typeof lenaWorld>, llm: LlmOutput, mode: Mode) {
  return decide({ agent: w.agent, world: w.world, llm, mode, rngs, params: P }).probs;
}

function assertProbs(actual: Partial<Record<Action, number>>, expected: Partial<Record<Action, number>>) {
  for (const [a, v] of Object.entries(expected)) {
    assert.equal(Number((actual[a as Action] ?? 0).toFixed(3)), v, `${a}: ${actual[a as Action]} vs ${v}`);
  }
}

describe('bias engine: reference cases (Python port, 3 dp)', () => {
  it('Lena intermediates: pressure, gain, clamped multipliers', () => {
    const { agent } = lenaWorld();
    const s = scale(agent);
    assert.equal(Number(pressure(s, P).toFixed(3)), 0.792);
    assert.equal(Number(gain(s, P).toFixed(3)), 1.1);
    const m = modifiers(s, true, P);
    const expected = { work: 0.57, overwork: 0.93, slack_off: 1.64, complain: 3.84, gossip: 2.8, verify: 1.15, interview: 5 };
    for (const [a, v] of Object.entries(expected)) assert.equal(Number(m[a as Action].toFixed(2)), v, a);
    assert.ok(rawModifiers(s, true, P).interview > 5, 'interview is clamped from above 5');
  });

  it('Lena: leak masked, everything else available', () => {
    const { agent, world } = lenaWorld();
    assert.deepEqual(availableActions(agent, world, {}, P).masked, ['leak', 'review_work', 'report_issue', 'support_colleague']);
  });

  it('Lena llm_bias', () => {
    assertProbs(probsFor(lenaWorld(), lenaLlm, 'llm_bias'), {
      complain: 0.445, interview: 0.233, work: 0.152, gossip: 0.079, slack_off: 0.044, verify: 0.026, overwork: 0.022, leak: 0,
    });
  });

  it('Lena rules', () => {
    assertProbs(probsFor(lenaWorld(), lenaLlm, 'rules'), {
      complain: 0.272, interview: 0.182, work: 0.151, gossip: 0.192, slack_off: 0.107, verify: 0.051, overwork: 0.046,
    });
  });

  it('Lena llm_raw', () => {
    assertProbs(probsFor(lenaWorld(), lenaLlm, 'llm_raw'), {
      complain: 0.3, interview: 0.1, work: 0.6, gossip: 0, slack_off: 0, verify: 0, overwork: 0,
    });
  });

  it('Tom llm_bias', () => {
    assertProbs(probsFor(tomWorld(), tomLlm, 'llm_bias'), {
      work: 0.569, overwork: 0.236, complain: 0.056, gossip: 0.046, verify: 0.041, slack_off: 0.029, interview: 0.023,
    });
  });

  it('Tom rules', () => {
    assertProbs(probsFor(tomWorld(), tomLlm, 'rules'), {
      work: 0.444, overwork: 0.15, complain: 0.127, gossip: 0.104, verify: 0.074, slack_off: 0.066, interview: 0.034,
    });
  });

  it('logs the Lena decision like the brief', () => {
    const { agent, world } = lenaWorld();
    const d = decide({ agent, world, llm: lenaLlm, mode: 'llm_bias', rngs, params: P });
    assert.deepEqual(d.log.masked, ['leak', 'review_work', 'report_issue', 'support_colleague']);
    assert.equal(d.log.gain, 1.1);
    assert.equal(d.log.modifiers.interview, 5);
    assert.equal(d.log.fresh, true);
    assert.equal(d.log.fallback, null);
    assert.equal(d.log.chosen.action, d.action);
    assert.ok(d.log.draw >= 0 && d.log.draw < 1);
    assert.match(d.log.explain, /Leaned toward working; .*stress.* pushed toward complaining\./);
  });
});

describe('bias engine: invariants', () => {
  const grid = () => {
    const rng = createRng(2026);
    const v = () => rng.int(101);
    return Array.from({ length: 2000 }, () => ({
      state: { stress: v(), burnout: v(), loyalty: v(), trust_mgmt: v() },
      traits: {
        ambition: v(), financial_need: v(), ethics: v(), sociability: v(), impulsivity: v(),
        recruiter_contact: rng.chance(0.5),
      },
      fresh: rng.chance(0.5),
    }));
  };

  it('every multiplier stays within [0.1, 5] for any state and traits', () => {
    for (const g of [...grid(), { state: { stress: 0, burnout: 0, loyalty: 0, trust_mgmt: 0 }, traits: {}, fresh: false },
      { state: { stress: 100, burnout: 100, loyalty: 100, trust_mgmt: 100 }, traits: { ambition: 100, financial_need: 100, ethics: 100, sociability: 100, impulsivity: 100, recruiter_contact: true }, fresh: true }]) {
      const m = modifiers(scale(makeAgent('a', g.state, g.traits)), g.fresh, P);
      for (const a of ACTIONS) assert.ok(m[a] >= 0.1 && m[a] <= 5, `${a}=${m[a]}`);
    }
  });

  it('probabilities sum to 1 and masked actions get 0, in every mode', () => {
    const modes: Mode[] = ['llm_bias', 'llm_raw', 'rules', 'random'];
    let i = 0;
    for (const g of grid().slice(0, 300)) {
      const agent = makeAgent('a', g.state, g.traits);
      const world = makeWorld([agent, makeAgent('b', {})]);
      const mode = modes[i++ % 4];
      const d = decide({ agent, world, llm: lenaLlm, mode, rngs, params: P });
      const sum = Object.values(d.probs).reduce((s, v) => s + (v ?? 0), 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `sum ${sum}`);
      for (const a of d.log.masked) assert.equal(d.probs[a] ?? 0, 0);
      assert.ok(!d.log.masked.includes(d.action));
    }
  });

  it('llm weights: floor applies, not renormalised; unproposed raw weight is 0', () => {
    const { raw, w } = llmWeights(lenaLlm, ACTIONS.filter((a) => a !== 'leak'), P);
    assert.equal(raw.gossip, 0);
    assert.equal(w.gossip, 0.03);
    assert.ok(Math.abs((w.work ?? 0) - 0.6) < 1e-12);
    const total = Object.values(w).reduce((s, v) => s + (v ?? 0), 0);
    assert.ok(total > 1);
  });

  it('higher impulsivity shifts the mix away from work faster as stress rises (all else equal)', () => {
    const awayFromWork = (stress: number, impulsivity: number) => {
      const agent = makeAgent('a', { stress, burnout: 30, loyalty: 50, trust_mgmt: 50 }, { impulsivity });
      const d = decide({ agent, world: makeWorld([agent, makeAgent('b', {})]), llm: null, mode: 'rules', rngs, params: P });
      return 1 - (d.probs.work ?? 0) - (d.probs.overwork ?? 0);
    };
    const shift = (imp: number) => awayFromWork(90, imp) - awayFromWork(30, imp);
    assert.ok(shift(20) > 0);
    assert.ok(shift(80) > shift(20), `${shift(80)} vs ${shift(20)}`);
  });

  it('random is uniform over available actions', () => {
    const avail: Action[] = ['work', 'overwork', 'complain', 'interview'];
    const probs = normalise(scoreActions('random', avail, { raw: {}, w: {} }, modifiers(scale(makeAgent('a', {})), false, P), 1, P));
    for (const a of avail) assert.equal(probs[a], 0.25);
  });
});

describe('bias engine: masking', () => {
  it('no claims: gossip, verify and leak are masked; alone: complain too', () => {
    const a = makeAgent('a', {});
    assert.deepEqual(availableActions(a, makeWorld([a, makeAgent('b', {})]), {}, P).masked, ['gossip', 'verify', 'leak', 'review_work', 'report_issue', 'support_colleague']);
    assert.deepEqual(availableActions(a, makeWorld([a]), {}, P).masked, ['complain', 'gossip', 'verify', 'leak', 'review_work', 'report_issue', 'support_colleague']);
  });

  it('colleagues who quit do not count', () => {
    const a = makeAgent('a', {});
    const b = makeAgent('b', {}, {}, { status: 'quit' });
    assert.ok(availableActions(a, makeWorld([a, b]), {}, P).masked.includes('complain'));
  });

  it('leak needs a scandal claim with effective belief >= 60', () => {
    const held = { claimId: 's', from: 'b', tickHeard: 1, depth: 1, belief: null, verified: null } as const;
    const mk = (trustInB: number, scandal: boolean) => {
      const a = makeAgent('a', { source_trust: { b: trustInB } }, {}, { claims: [{ ...held }] });
      return { a, world: makeWorld([a, makeAgent('b', {})], [makeClaim('s', { scandal })]) };
    };
    // No LLM belief: effective belief = source trust.
    let w = mk(59, true);
    assert.ok(availableActions(w.a, w.world, {}, P).masked.includes('leak'));
    w = mk(60, true);
    assert.ok(!availableActions(w.a, w.world, {}, P).masked.includes('leak'));
    w = mk(100, false);
    assert.ok(availableActions(w.a, w.world, {}, P).masked.includes('leak'));
    // With LLM belief: 0.6 * 70 + 0.4 * 40 = 58 < 60; 0.6 * 75 + 0.4 * 40 = 61.
    w = mk(40, true);
    assert.ok(availableActions(w.a, w.world, { s: 70 }, P).masked.includes('leak'));
    assert.ok(!availableActions(w.a, w.world, { s: 75 }, P).masked.includes('leak'));
  });

  it('gossip ablation masks gossip', () => {
    const { agent, world } = lenaWorld();
    assert.ok(availableActions(agent, world, {}, P, { gossip: false }).masked.includes('gossip'));
  });
});

describe('bias engine: determinism and fallback', () => {
  it('same inputs and seed give the same decision', () => {
    const a = decide({ ...lenaWorld(), llm: lenaLlm, mode: 'llm_bias', rngs: rngFactory(9, TICK, 'lena'), params: P });
    const b = decide({ ...lenaWorld(), llm: lenaLlm, mode: 'llm_bias', rngs: rngFactory(9, TICK, 'lena'), params: P });
    assert.deepEqual(a, b);
  });

  it('a different target draw never changes the action draw', () => {
    const base = rngFactory(9, TICK, 'lena');
    const actions = new Set<string>();
    const targets = new Set<string | null>();
    for (let s = 0; s < 30; s++) {
      const mixed: RngFactory = (purpose) => (purpose === 'action' ? base('action') : rngFactory(s, TICK, 'lena')(purpose));
      const three = makeAgent('priya', {});
      const w = lenaWorld();
      w.world.ids.push('priya');
      w.world.agents.priya = three;
      const d = decide({ ...w, llm: { ...lenaLlm, proposals: [{ action: 'complain', weight: 1 }] }, mode: 'llm_bias', rngs: mixed, params: P });
      actions.add(d.action);
      targets.add(d.target);
    }
    assert.equal(actions.size, 1);
  });

  it('the LLM target is used when valid, otherwise one is drawn', () => {
    const w = lenaWorld();
    const only = (target: string): LlmOutput => ({ ...lenaLlm, proposals: [{ action: 'complain', weight: 1, target }] });
    const always: RngFactory = (purpose) => createRng(purpose === 'action' ? 0 : 1);
    const forceComplain = (llm: LlmOutput) => decide({ ...w, llm, mode: 'llm_raw', rngs: always, params: P });
    assert.equal(forceComplain(only('tom')).target, 'tom');
    assert.equal(forceComplain(only('lena')).target, 'tom'); // self is invalid, only Tom is left
    assert.equal(forceComplain(only('nobody')).target, 'tom');
  });

  it('the LLM claim is used when valid, otherwise the belief rule picks one', () => {
    const held = (claimId: string) => ({ claimId, from: 'tom', tickHeard: TICK - 4, depth: 1, belief: null, verified: null });
    const mk = () => {
      const lena = makeAgent('lena', { source_trust: { tom: 70 } }, {}, { claims: [held('a'), held('b'), held('s')] });
      return { agent: lena, world: makeWorld([lena, makeAgent('tom', {}), makeAgent('priya', {})],
        [makeClaim('a'), makeClaim('b'), makeClaim('s', { scandal: true })], TICK) };
    };
    const forced = (action: Action, claim: string, beliefs: Record<string, number> = {}) => {
      const w = mk();
      const llm: LlmOutput = { ...lenaLlm, beliefs, proposals: [{ action, weight: 1, claim }] };
      return decide({ ...w, llm, mode: 'llm_raw', rngs, params: P });
    };
    // Valid picks are honoured, even when the belief rule would choose differently.
    assert.equal(forced('gossip', 'b', { a: 90, b: 10 }).claim, 'b');
    assert.equal(forced('verify', 'a').claim, 'a');
    assert.equal(forced('leak', 's').claim, 's'); // source trust 70 >= 60: believed
    // Not held: fall back to the rule (highest effective belief).
    assert.equal(forced('gossip', 'nope', { a: 90, b: 10 }).claim, 'a');
    // Leak of a non-scandal claim is not valid; the believed scandal is used instead.
    assert.equal(forced('leak', 'a').claim, 's');
  });

  it('null LLM output in an LLM mode runs as rules and logs the fallback', () => {
    const w = lenaWorld();
    const d = decide({ ...w, llm: null, mode: 'llm_bias', rngs, params: P, options: { fallbackReason: 'invalid_json' } });
    assert.equal(d.log.effective_mode, 'rules');
    assert.equal(d.log.fallback, 'invalid_json');
    assertProbs(d.probs, { complain: 0.272, interview: 0.182, work: 0.151 });
    assert.ok(d.public_line.length > 0);
  });

  it('llm_raw proposing only masked actions falls back to rules', () => {
    const w = lenaWorld();
    const d = decide({ ...w, llm: { ...lenaLlm, proposals: [{ action: 'leak', weight: 1 }] }, mode: 'llm_raw', rngs, params: P });
    assert.equal(d.log.effective_mode, 'rules');
    assert.equal(d.log.fallback, 'llm_proposed_only_masked_actions');
  });

  it('rules and random never use the LLM', () => {
    const w = lenaWorld();
    const r = decide({ ...w, llm: lenaLlm, mode: 'rules', rngs, params: P });
    assert.equal(r.log.fallback, null);
    assert.equal(r.log.effective_mode, 'rules');
    const x = decide({ ...w, llm: null, mode: 'random', rngs, params: P });
    assert.equal(x.log.effective_mode, 'random');
    assert.equal(x.log.fallback, null);
  });
});
