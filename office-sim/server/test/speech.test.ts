import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RunConfig, TurnContext, TurnProvider } from '../engine-types';
import { DEFAULT_PARAMS as P } from '../params';
import { buildScenario, fixtureCast } from '../scripts/fixture';
import { checkLine, joinSpeech } from '../speech';
import { createStubProvider } from '../stub-provider';
import { createWorld, runSimulation, runTick } from '../tick';

const config = (seed: number, over: Partial<RunConfig> = {}): RunConfig => ({
  seed, mode: 'llm_bias', ticks: 16, scenario: buildScenario(seed, 16), gossip: true, billboard: true, priceFeedback: false, ...over,
});

const speechOf = (r: Awaited<ReturnType<typeof runSimulation>>) =>
  r.logs.map((l) => l.decisions.map((d) => ({ agent: d.agent, manner: d.speech?.manner, stance: d.speech?.stance, addressee: d.speech?.addressee })));

describe('speech: determinism', () => {
  it('the same seed gives identical voice cards and manners across two runs', async () => {
    const a = await runSimulation(fixtureCast(42), config(42), createStubProvider(42));
    const b = await runSimulation(fixtureCast(42), config(42), createStubProvider(42));
    assert.ok(a.logs[0].voices);
    assert.deepEqual(a.logs[0].voices, b.logs[0].voices);
    assert.deepEqual(speechOf(a), speechOf(b));
    const c = await runSimulation(fixtureCast(43), config(43), createStubProvider(43));
    assert.notDeepEqual(a.logs[0].voices, c.logs[0].voices);
  });

  it('every agent has a card from the start; cards are logged on tick 1 only', async () => {
    const r = await runSimulation(fixtureCast(5), config(5), createStubProvider(5));
    assert.deepEqual(Object.keys(r.logs[0].voices!).sort(), [...r.world.ids].sort());
    assert.ok(r.logs.slice(1).every((l) => !l.voices));
  });

  it('a replacement agent gets a card that clashes with nobody', () => {
    const world = createWorld(fixtureCast(42), 42);
    const before = structuredClone(world.speech!.voices);
    world.agents.ops2 = structuredClone({ ...world.agents.ops, id: 'ops2' });
    world.ids.push('ops2');
    const card = joinSpeech(world, 'ops2', P);
    assert.ok(Object.values(before).every((c) => `${c.register}${c.humour}${c.tell}` !== `${card.register}${card.humour}${card.tell}`));
    assert.equal(world.speech!.voices.ops2, card);
  });

  it('rules and random modes sample no manners', async () => {
    for (const mode of ['rules', 'random'] as const) {
      const r = await runSimulation(fixtureCast(42), config(42, { mode }), null);
      assert.ok(r.logs.every((l) => l.decisions.every((d) => !d.speech)), mode);
    }
  });
});

describe('speech: manner constraints over full runs', () => {
  it('no agent repeats a manner on consecutive turns; at most two agents share one per round', async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = await runSimulation(fixtureCast(seed), config(seed), createStubProvider(seed));
      const last: Record<string, string> = {};
      for (const l of r.logs) {
        const counts: Record<string, number> = {};
        for (const d of l.decisions) {
          const m = d.speech!.manner;
          assert.notEqual(m, last[d.agent], `seed ${seed} tick ${l.tick} ${d.agent} repeated ${m}`);
          last[d.agent] = m;
          counts[m] = (counts[m] ?? 0) + 1;
        }
        assert.ok(Object.values(counts).every((n) => n <= P.voice.manner.roundCap), `seed ${seed} tick ${l.tick}`);
        if (l.decisions.length >= 6) assert.ok(Object.keys(counts).length >= 4, `seed ${seed} tick ${l.tick}: ${JSON.stringify(counts)}`);
      }
    }
  });
});

describe('speech: repetition check and regeneration', () => {
  it('flags the later of two matching openers, and similar, banned, leaky and echo lines', () => {
    const v = P.voice;
    const earlier = [{ agent: 'a', line: 'Two in the morning? No chance.' }];
    assert.deepEqual(checkLine('b', 'Two in the morning, really?', earlier, [], [], v), { flags: ['opener'], against: 'a' });
    assert.deepEqual(checkLine('b', 'The gym was packed again tonight.', earlier, [], [], v).flags, []);
    assert.deepEqual(checkLine('a', 'Two in the morning, really?', earlier, [], [], v).flags, [], 'own lines are not compared');
    const recent = [{ agent: 'c', line: "A surprise bonus? Huh. Let's see it in my paycheck first." }];
    assert.deepEqual(checkLine('b', "Bonus? Huh. Let's see it in my paycheck first.", [], recent, [], v).flags, ['similar']);
    assert.deepEqual(checkLine('b', "I'm running on fumes.", [], [], [], v).flags, ['banned:running on fumes']);
    assert.deepEqual(checkLine('b', 'Ask the climber, nine ticks in.', [], [], [], v).flags, ['label', 'tick']);
    assert.deepEqual(checkLine('b', 'Bonus? Lovely.', [], [], [['bonus']], v).flags, ['echo']);
  });

  const OWN_LINES = [
    'The coffee machine broke again.', 'My dog ate a sock last night.', 'Football was rubbish on Saturday.',
    'The train sat outside town for ages.', 'Tomatoes finally came up this week.', 'Those gig tickets sold out fast.',
    'The school run took forever today.', 'Gym was heaving at six.',
  ];
  const ORDER = fixtureCast(42).map((c) => c.profile.id);

  /** A fake model: every agent says the same thing first time, and something of their own when nudged. */
  function echoingProvider(seen: TurnContext[]): TurnProvider {
    return async (agent, ctx) => {
      seen.push(structuredClone(ctx));
      const nudged = ctx.speech?.nudge;
      return {
        proposals: [{ action: 'work', weight: nudged ? 0 : 1 }, { action: 'overwork', weight: nudged ? 5 : 0.1 }],
        public_line: nudged ? OWN_LINES[ORDER.indexOf(agent.id)] : 'Same old, same old, nothing new here.',
        inner_monologue: nudged ? 'Fine.' : 'Hm.',
        beliefs: {},
      };
    };
  }

  it('regenerates a flagged line once, keeps the first proposals, and logs it', async () => {
    const seen: TurnContext[] = [];
    const world = createWorld(fixtureCast(42), 42);
    const r = await runTick(world, echoingProvider(seen), { mode: 'llm_raw', scenario: [], gossip: true, billboard: true });
    const decisions = r.log.decisions;
    const first = decisions[0];
    assert.equal(first.speech!.flags.length, 0, 'the first speaker is never flagged for matching');
    assert.equal(first.speech!.regenerated, false);
    for (const d of decisions.slice(1)) {
      assert.ok(d.speech!.flags.includes('opener'), d.agent);
      assert.equal(d.speech!.regenerated, true);
      assert.deepEqual(d.speech!.regen_flags, []);
      assert.ok(d.llm!.proposals.some((p) => p.action === 'work' && p.weight === 1), 'proposals from the first call');
    }
    const lines = r.log.lines.map((l) => l.public_line);
    assert.equal(new Set(lines).size, lines.length);
    const nudges = seen.filter((c) => c.speech?.nudge);
    assert.equal(nudges.length, decisions.length - 1);
    assert.equal(nudges[0].speech!.nudge!.line, 'Same old, same old, nothing new here.');
    assert.equal(r.log.speech!.regenerated, decisions.length - 1);
    assert.equal(r.log.speech!.budget_left, decisions.length * (1 + P.bias.llmRetries) - decisions.length - (decisions.length - 1));
  });

  it('never exceeds the tick request budget', async () => {
    const seen: TurnContext[] = [];
    const tight = { ...P, bias: { ...P.bias, llmRetries: 0 } };
    const world = createWorld(fixtureCast(42), 42, tight);
    const r = await runTick(world, echoingProvider(seen), { mode: 'llm_raw', scenario: [], gossip: true, billboard: true }, tight);
    assert.equal(seen.length, world.ids.length, 'no spare requests, no regenerations');
    assert.equal(r.log.speech!.regenerated, 0);
    assert.equal(r.log.speech!.still_flagged, world.ids.length - 1);
  });

  it('a failed regeneration keeps the original line and never blocks the tick', async () => {
    let call = 0;
    const provider: TurnProvider = async () => {
      if (call++ >= 8) throw new Error('network down');
      return { proposals: [{ action: 'work', weight: 1 }], public_line: 'Same old, same old, nothing new here.', inner_monologue: 'Hm.', beliefs: {} };
    };
    const r = await runTick(createWorld(fixtureCast(42), 42), provider, { mode: 'llm_raw', scenario: [], gossip: true, billboard: true });
    assert.ok(r.log.lines.every((l) => l.public_line === 'Same old, same old, nothing new here.'));
    assert.equal(r.log.speech!.regenerated, 0);
  });

  it('shows colleagues their last two rounds of lines, by name', async () => {
    const seen: TurnContext[] = [];
    let world = createWorld(fixtureCast(42), 42);
    for (let i = 0; i < 3; i++) world = (await runTick(world, echoingProvider(seen), { mode: 'llm_raw', scenario: [], gossip: true, billboard: true })).world;
    const late = seen.filter((c) => c.tick === 3 && !c.speech!.nudge);
    for (const c of late) {
      assert.ok(c.speech!.recent.length > 0 && c.speech!.recent.length <= 2 * 7);
      assert.ok(c.speech!.recent.every((r) => !world.ids.includes(r.name)), 'names, not ids');
    }
  });
});
