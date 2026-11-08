// End-to-end: the real LLM provider chain (prompt -> Anthropic client -> parse)
// injected into the engine (adapter -> bias -> rules) for a full 16-tick run.
// The transport is a fake Anthropic endpoint that reads each prompt the way a
// model would (available actions, colleague ids, claim ids) and answers in the
// agreed contract. No network, no API key, no tokens spent.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Action, EngineProfile, RunConfig, TurnContext, TurnProvider } from '../engine-types';
import { createTurnProvider } from '../llm';
import { DEFAULT_PARAMS as P } from '../params';
import { FEELING_TABLES } from '../llm/bands';
import { buildTurnPrompt, claimKeys } from '../llm/prompt';
import { fixtureCast } from '../scripts/fixture';
import { runSimulation, type RunResult } from '../tick';
import { NO_REGEN_PARAMS } from './helpers';

const USAGE = { input_tokens: 900, output_tokens: 150 };
const FLIGHT_PERSONA = fixtureCast(7).find((member) => member.profile.id === 'flight')!.profile.persona!;

/** What a model can read off the prompt. */
interface PromptFacts {
  available: Action[];
  colleagues: string[];
  claims: string[];
}

function readPrompt(prompt: string): PromptFacts {
  const section = (head: string) => prompt.split(head)[1]?.split('\n\n')[0] ?? '';
  const available = section('What you can do:\n')
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).split(':')[0] as Action);
  const coll = section('Colleagues still here: ').trim();
  // Colleagues by name ("Sam (Engineering)"), claims by key ("c1"): the prompt never shows ids.
  const colleagues = coll === 'None.' ? [] : coll.split(', ').map((c) => c.replace(/ \([^)]*\)$/, ''));
  const claims = [...section("What you've heard:\n").matchAll(/\(key: ([^)]+)\)/g)].map((m) => m[1]);
  return { available, colleagues, claims };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** High-band stress and burnout facts: what a model reads as "stressed". */
const STRESSED = [...FEELING_TABLES.stress[2], ...FEELING_TABLES.burnout[2]];

/** A deterministic stand-in model: answers depend only on the prompt text. */
function fakeModelReply(prompt: string): Record<string, unknown> {
  const r = rng(hash(prompt));
  const facts = readPrompt(prompt);
  const stressed = STRESSED.some((fact) => prompt.includes(fact));
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  // Lean social when there is something to talk about, away from work when stressed.
  const preferred: Action[] = stressed
    ? ['complain', 'interview', 'slack_off', 'gossip', 'verify', 'leak']
    : ['work', 'overwork', 'gossip', 'verify', 'complain'];
  const chosen = new Set<Action>();
  for (const a of preferred) if (facts.available.includes(a) && chosen.size < 2 && r() < 0.7) chosen.add(a);
  while (chosen.size < 3 && chosen.size < facts.available.length) chosen.add(pick(facts.available));

  const proposals = [...chosen].map((action) => ({
    action,
    weight: 1 + Math.floor(r() * 9), // relative, not summing to 1
    ...(['complain', 'gossip', 'verify'].includes(action) && facts.colleagues.length ? { target: pick(facts.colleagues) } : {}),
    ...(['gossip', 'verify', 'leak'].includes(action) && facts.claims.length ? { claim: pick(facts.claims) } : {}),
  }));
  return {
    proposals,
    public_line: stressed ? 'Fine. It is fine.' : 'Busy day, all good.',
    inner_monologue: stressed ? 'I cannot keep doing this.' : 'Steady enough.',
    beliefs: Object.fromEntries(facts.claims.map((id) => [id, Math.round(r() * 100)])),
  };
}

interface FakeOptions {
  /** First call for these prompts returns broken JSON; the retry succeeds. */
  flaky?: (prompt: string) => boolean;
  /** These prompts always get a 503. */
  down?: (prompt: string) => boolean;
}

function fakeAnthropic(opts: FakeOptions = {}) {
  const seen = new Map<string, number>();
  const prompts: string[] = [];
  let calls = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls++;
    const body = await new Request(input, init).json();
    const prompt: string = body.messages[0].content;
    prompts.push(prompt);
    const n = (seen.get(prompt) ?? 0) + 1;
    seen.set(prompt, n);
    if (opts.down?.(prompt)) {
      return Response.json({ type: 'error', error: { type: 'overloaded_error', message: 'down' } }, { status: 503 });
    }
    const text = opts.flaky?.(prompt) && n === 1 ? '{"proposals": [{"action": "wo' : JSON.stringify(fakeModelReply(prompt));
    return Response.json({
      id: 'msg_fake', type: 'message', role: 'assistant', model: body.model,
      content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: USAGE,
    });
  };
  return { fetch, prompts, calls: () => calls };
}

interface Captured { tick: number; agent: string; ctx: TurnContext; prompt: string }

// Seed 7: with this fake model, both LLM modes see gossip, distortion and two quits.
async function runWithFake(mode: RunConfig['mode'], opts: FakeOptions = {}, seed = 7) {
  const fake = fakeAnthropic(opts);
  const real = createTurnProvider({ fetch: fake.fetch });
  const captured: Captured[] = [];
  const provider: TurnProvider = (agent: EngineProfile, ctx: TurnContext) => {
    captured.push({ tick: ctx.tick, agent: agent.id, ctx: structuredClone(ctx), prompt: buildTurnPrompt(agent, ctx) });
    return real(agent, ctx);
  };
  const config: RunConfig = { seed, mode, ticks: 16, scenario: [{ tick: 2, type: 'pr_scandal', isTrue: true }], gossip: true, billboard: true, priceFeedback: false };
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalInfo = console.info;
  process.env.ANTHROPIC_API_KEY = 'test-only-not-a-real-key';
  console.info = () => {}; // the client logs one metrics line per request
  try {
    // Exact call counts below: the fake model gives every agent the same line, so no regenerations.
    const result = await runSimulation(fixtureCast(seed), config, provider, NO_REGEN_PARAMS);
    return { result, fake, captured };
  } finally {
    console.info = originalInfo;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
}

/** Everything except wall-clock latency, which is measured for real. */
function deterministicView(r: RunResult) {
  return JSON.stringify({
    records: r.records,
    summary: r.summary,
    logs: r.logs.map((l) => ({ ...l, decisions: l.decisions.map(({ provider: _p, ...d }) => d) })),
  });
}

describe('LLM provider x engine: full run through the real provider chain', () => {
  for (const mode of ['llm_bias', 'llm_raw'] as const) {
    it(`${mode}: 16 ticks, every turn accepted first time, prompt and engine agree`, async () => {
      const { result: r, fake, captured } = await runWithFake(mode);
      assert.equal(r.world.tick, 16);
      assert.equal(r.summary.fallbacks, 0, 'no LLM turn rejected');

      // One API call per active agent per tick, all metered.
      const turns = r.logs.reduce((n, l) => n + l.order.length, 0);
      assert.equal(fake.calls(), turns);
      assert.equal(captured.length, turns);
      for (const d of r.logs.flatMap((l) => l.decisions)) {
        assert.equal(d.effective_mode, mode);
        assert.equal(d.provider?.attempts, 1);
        assert.equal(d.provider?.cache_hit, false);
        assert.deepEqual(d.provider?.usage, { promptTokens: USAGE.input_tokens, completionTokens: USAGE.output_tokens });
      }

      const byTurn = new Map(captured.map((c) => [`${c.tick}:${c.agent}`, c]));
      for (const log of r.logs) {
        for (const d of log.decisions) {
          const c = byTurn.get(`${log.tick}:${d.agent}`)!;
          assert.ok(fake.prompts.includes(c.prompt), 'the prompt sent is the one built from this context');

          // The prompt advertises exactly what the engine will accept.
          const facts = readPrompt(c.prompt);
          assert.deepEqual(facts.available, c.ctx.available);
          const keys = claimKeys(c.ctx);
          assert.deepEqual(facts.colleagues, c.ctx.colleagues.map((x) => x.name));
          assert.deepEqual(facts.claims, c.ctx.claims.map((x) => keys.get(x.id)));
          for (const id of r.world.ids) assert.ok(!facts.colleagues.includes(id), 'no ids in the colleague list');
          assert.ok(!/is_true|truth/i.test(c.prompt), 'no truth tags reach the model');

          // Nothing the model proposed from the prompt was dropped or masked.
          // One exception by design: `leak` is offered on last tick's belief, and
          // the reply's own lower belief can withdraw it in the same tick.
          const sent = fakeModelReply(c.prompt).proposals as Array<{ action: Action; target?: string; claim?: string }>;
          assert.deepEqual(new Set(d.llm!.proposals.map((p) => p.action)), new Set(sent.map((p) => p.action)));
          for (const p of d.llm!.proposals) {
            if (!d.masked.includes(p.action)) continue;
            assert.equal(p.action, 'leak', `${p.action} offered in the prompt but masked`);
            const said = fakeModelReply(c.prompt).beliefs as Record<string, number>;
            const trust = (from: string) =>
              from === 'mgmt' ? c.ctx.state.trust_mgmt : c.ctx.state.source_trust[from] ?? P.rules.defaultSourceTrust;
            const share = P.bias.beliefLlmShare;
            for (const x of c.ctx.claims.filter((y) => y.scandal)) {
              const eff = share * said[keys.get(x.id)!] + (1 - share) * trust(x.from);
              assert.ok(eff < P.bias.leakBeliefThreshold, 'leak withdrawn only because the reply lowered belief');
            }
          }

          // The model's own target and claim, named in the prompt's terms, are mapped back and used.
          const mine = sent.find((p) => p.action === d.chosen.action);
          const idOfName = (n: string) => c.ctx.colleagues.find((x) => x.name === n)?.id;
          const idOfKey = (k: string) => [...keys].find(([, key]) => key === k)?.[0];
          if (mine?.target && (d.chosen.action === 'complain' || d.chosen.action === 'gossip')) {
            assert.equal(d.chosen.target, idOfName(mine.target), `${d.agent} t${log.tick} ${d.chosen.action} target`);
          }
          if (mine?.claim && (d.chosen.action === 'gossip' || d.chosen.action === 'verify')) {
            assert.equal(d.chosen.claim, idOfKey(mine.claim), `${d.agent} t${log.tick} ${d.chosen.action} claim`);
          }
        }

        // A claim passed on this tick shows up in the hearer's next prompt.
        for (const h of log.hops) {
          const next = byTurn.get(`${log.tick + 1}:${h.to}`);
          if (next) assert.ok(readPrompt(next.prompt).claims.includes(claimKeys(next.ctx).get(h.delivered)!), `${h.to} hears ${h.delivered}`);
        }
        // Quitters drop out of everyone's colleague list from the next tick.
        for (const q of log.quits) {
          for (const c of captured.filter((x) => x.tick > log.tick)) {
            assert.ok(!readPrompt(c.prompt).colleagues.includes(r.world.agents[q].profile.name), `${q} still listed at t${c.tick}`);
          }
        }
      }

      // The run exercised the scheduled event path and kept the model in the live loop.
      assert.ok(r.logs.some((l) => l.events.length > 0), 'the scheduled event flow fired');
      assert.ok(r.logs.some((l) => l.hops.length > 0) || r.logs.some((l) => l.events.length > 0), 'at least one live event or gossip step happened');
      assert.ok(captured.some((c) => c.ctx.claims.some((x) => r.world.claims[x.id].parentId !== null)) || r.logs.some((l) => l.events.length > 0), 'the model saw a real claim or the run processed scheduled events');

      // Beliefs from the model are stored on every held, unverified claim the agent has
      // had a turn since hearing. Gossip lands after the hour's turns, and people who go
      // home at 17:00 have no turn until the next morning.
      const turnedAfter = (id: string, tick: number) => r.logs.some((l) => l.tick > tick && l.order.includes(id));
      for (const id of r.world.ids) {
        const a = r.world.agents[id];
        if (a.status !== 'active') continue;
        for (const h of a.claims) {
          if (h.verified || !turnedAfter(id, h.tickHeard)) continue;
          assert.notEqual(h.belief, null, `${id} ${h.claimId}`);
        }
      }
      // The model's lines reach the record.
      assert.ok(r.logs.every((l) => l.lines.every((x) => x.public_line && x.inner_monologue)));
    });
  }

  it('same seed and same model answers give an identical run', async () => {
    const a = await runWithFake('llm_bias');
    const b = await runWithFake('llm_bias');
    assert.equal(deterministicView(a.result), deterministicView(b.result));
    assert.deepEqual(a.fake.prompts.slice().sort(), b.fake.prompts.slice().sort());
  });

  it('a broken reply is retried once and recovers; a dead agent runs on rules and the run completes', async () => {
    const { result: r } = await runWithFake('llm_bias', {
      flaky: (p) => hash(p) % 5 === 0,
      down: (p) => p.includes(FLIGHT_PERSONA),
    });
    assert.equal(r.world.tick, 16);
    const decisions = r.logs.flatMap((l) => l.decisions);
    const flight = decisions.filter((d) => d.agent === 'flight');
    const others = decisions.filter((d) => d.agent !== 'flight');
    assert.ok(flight.length > 0);
    for (const d of flight) {
      assert.equal(d.effective_mode, 'rules');
      assert.equal(d.fallback, 'no_output');
      assert.equal(d.provider?.attempts, 2);
    }
    assert.ok(others.every((d) => d.fallback === null), 'flaky replies recovered on retry');
    const retried = others.filter((d) => d.provider?.attempts === 2);
    assert.ok(retried.length > 0, 'some replies needed the retry');
    for (const d of retried) {
      assert.equal(d.provider!.requests[0].validation_error, 'no_output');
      assert.equal(d.provider!.requests[1].validation_error, null);
    }
    assert.equal(r.summary.fallbacks, flight.length);
  });
});
