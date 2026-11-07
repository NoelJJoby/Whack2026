import assert from 'node:assert/strict';

import type { TurnContext, TurnProvider } from '../../engine-types';
import { createTurnProvider, getAgentTurn } from '../../llm';
import { toLlmOutput } from '../../llm-adapter';
import { makeAgent, makeWorld } from '../../test/helpers';
import { runTick } from '../../tick';
import type { CallMetrics } from '../client';
import { llmConfig } from '../config';

const agent = makeAgent('a1', { stress: 83, source_trust: { a2: 87 } }).profile;
agent.archetype = 'PRIVATE_ARCHETYPE';
const ctx: TurnContext = {
  tick: 9, mode: 'llm_bias',
  state: makeAgent('a1', { stress: 83, source_trust: { a2: 87 } }).state,
  available: ['work', 'complain', 'gossip'],
  colleagues: [{ id: 'a2', name: 'Rae', affinity: 91, source_trust: 87 }],
  claims: [{ id: 'claim-6', text: 'The office may close.', from: 'a2', tick_heard: 6, scandal: false }],
  events: [{ type: 'new_management', text: 'A new manager starts today.' }],
};
const output = {
  proposals: [{ action: 'gossip', weight: 0.7, target: 'a2', claim: 'claim-6' }],
  public_line: 'What a day.', inner_monologue: 'I feel uneasy.', beliefs: { 'claim-6': 72 },
};

function message(text = JSON.stringify(output), stop_reason = 'end_turn') {
  return {
    id: 'msg_provider_test', type: 'message', role: 'assistant', model: llmConfig.model,
    content: [{ type: 'text', text }], stop_reason, stop_sequence: null,
    usage: { input_tokens: 170, output_tokens: 55 },
  };
}

const originalKey = process.env.ANTHROPIC_API_KEY;
try {
  delete process.env.ANTHROPIC_API_KEY;
  // Importing the default provider needs no credentials, and invocation is safe.
  const defaultProvider: TurnProvider = getAgentTurn;
  assert.equal(await defaultProvider(agent, ctx), null);
  process.env.ANTHROPIC_API_KEY = 'test-only-not-a-real-key';

  let calls = 0;
  const prompts: string[] = [];
  const metrics: CallMetrics[] = [];
  const provider: TurnProvider = createTurnProvider({
    onMetrics: metric => metrics.push(metric),
    fetch: async (input, init) => {
      calls++;
      const request = new Request(input, init);
      assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
      const body = await request.json();
      assert.equal(body.max_tokens, llmConfig.maxOutputTokens);
      prompts.push(body.messages[0].content);
      return Response.json(message('```json\n' + JSON.stringify(output) + '\n```'));
    },
  });
  assert.deepEqual(await provider(agent, ctx), output);
  assert.equal(calls, 1);
  assert.equal(metrics.length, 1);
  assert.deepEqual(metrics[0].usage, { promptTokens: 170, completionTokens: 55 });
  const prompt = prompts[0];
  assert.ok(prompt.startsWith('You are a professional employee in a B2B software and services company. Choose how to use your finite work time. Normal work is the baseline; personality, trust and pressure influence effort, care and communication.'));
  assert.ok(prompt.includes("You've had a headache since this morning and can't get through your list."));
  assert.ok(prompt.includes('"The office may close." (key: c1), from Rae, this morning. you generally trust them.'));
  assert.ok(prompt.includes('A new manager starts today.'));
  assert.ok(prompt.includes('Colleagues still here: Rae'));
  const actions = prompt.split('What you can do:\n')[1].split('\n\n')[0]
    .split('\n').filter(line => line.startsWith('- ')).map(line => line.split(':')[0].slice(2));
  assert.deepEqual(actions, ctx.available);
  assert.ok(prompt.includes('For each claim you\'ve heard, say how likely you think it is to be true, from 0 to 100'));
  assert.ok(prompt.includes('Give one integer for every claim key.'));
  // Names are shown; ids, claim ids, archetypes and ticks are not.
  for (const hidden of ['PRIVATE_ARCHETYPE', 'a2', 'claim-6', 'tick', 'is_true', 'source_trust', '83', '87', '91']) {
    assert.equal(prompt.includes(hidden), false, `Unexpected prompt disclosure: ${hidden}`);
  }
  const noClaims = { ...ctx, claims: [], events: [], colleagues: [], available: ['work'] as TurnContext['available'] };
  assert.deepEqual(await provider(agent, noClaims), output);
  assert.equal(calls, 2, 'Each invocation calls the API once; no implicit cache');
  assert.ok(prompts[1].includes("You haven't heard anything new."));
  assert.ok(prompts[1].includes('Nothing new has been announced.'));
  assert.ok(prompts[1].includes('Colleagues still here: None.'));

  // A reply in the prompt's terms (names, claim keys) comes back in engine ids.
  const named = createTurnProvider({ fetch: async () => Response.json(message(JSON.stringify({
    proposals: [{ action: 'gossip', weight: 1, target: 'rae', claim: 'c1' }],
    public_line: 'Rae, coffee?', inner_monologue: 'Need a break.', beliefs: { c1: 60 },
  }))) });
  assert.deepEqual(await named(agent, ctx), {
    proposals: [{ action: 'gossip', weight: 1, target: 'a2', claim: 'claim-6' }],
    public_line: 'Rae, coffee?', inner_monologue: 'Need a break.', beliefs: { 'claim-6': 60 },
  });

  // Parseable objects are returned unchanged, even if strict validation would
  // reject them. The real engine adapter gets to normalize or reject them.
  const duplicate = {
    ...output,
    proposals: [
      { action: 'work_normally', weight: 1 }, { action: 'work', weight: 2 },
      { action: 'complain', weight: 1 }, { action: 'interview', weight: 1 },
      { action: 'overwork', weight: 1 },
    ],
  };
  const legacy = { action: 'work_normally', claim_id: null };
  for (const raw of [duplicate, legacy, { proposals: [] }, { unexpected: true }]) {
    let attempts = 0;
    const passthrough = createTurnProvider({ fetch: async () => {
      attempts++;
      return Response.json(message(JSON.stringify(raw)));
    } });
    const result = await passthrough(agent, ctx);
    assert.deepEqual(result, raw);
    assert.equal(attempts, 1, 'Schema-invalid JSON must not trigger a provider retry');
  }
  const adapted = toLlmOutput(duplicate);
  assert.equal(adapted.output?.proposals.length, 3);
  assert.equal(adapted.output?.proposals[0].weight, 3);

  for (const reply of [
    message('not JSON'), message(''), message('{}', 'max_tokens'),
    message('{}', 'pause_turn'), { ...message(), content: [] },
  ]) {
    let attempts = 0;
    const unusable = createTurnProvider({ fetch: async () => {
      attempts++;
      return Response.json(reply);
    } });
    assert.equal(await unusable(agent, ctx), null);
    assert.equal(attempts, 1);
  }

  for (const status of [429, 500]) {
    let attempts = 0;
    const failed = createTurnProvider({ fetch: async () => {
      attempts++;
      return Response.json({ type: 'error', error: { type: 'api_error', message: 'test' } }, { status });
    } });
    assert.equal(await failed(agent, ctx), null);
    assert.equal(attempts, 1, `HTTP ${status} must not retry`);
  }
  let networkAttempts = 0;
  const rejected = createTurnProvider({ fetch: async () => {
    networkAttempts++;
    throw new Error('network failure');
  } });
  assert.equal(await rejected(agent, ctx), null);
  assert.equal(networkAttempts, 1);

  let timeoutAttempts = 0;
  const timeout = createTurnProvider({ timeoutMs: 30, fetch: async (_input, init) => {
    timeoutAttempts++;
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener('abort', abort, { once: true });
    });
  } });
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    assert.equal(await Promise.race([
      timeout(agent, ctx),
      new Promise<never>((_resolve, reject) => {
        watchdog = setTimeout(() => reject(new Error('Provider timeout exceeded budget')), 2000);
      }),
    ]), null);
  } finally {
    clearTimeout(watchdog);
  }
  assert.equal(timeoutAttempts, 1);

  // Exercise the actual engine's retry boundary with the new provider injected.
  // The engine alone retries: two failed fetches total, then rules fallback.
  const config = { mode: 'llm_raw', scenario: [], gossip: true, billboard: true } as const;
  for (const recover of [false, true]) {
    let attempts = 0;
    const injected = createTurnProvider({ fetch: async () => {
      attempts++;
      return Response.json(message(recover && attempts === 2
        ? JSON.stringify({ ...output, proposals: [{ action: 'work', weight: 1 }] })
        : '{"proposals":[]}'));
    } });
    const result = await runTick(makeWorld([makeAgent('a1', {})]), injected, { ...config, scenario: [] });
    assert.equal(attempts, 2);
    assert.equal(result.log.decisions[0].effective_mode, recover ? 'llm_raw' : 'rules');
    assert.equal(result.log.decisions[0].fallback, recover ? null : 'schema_mismatch');
  }
  console.log('Provider checks passed: real SDK/stubbed transport, one attempt, engine-owned retry/fallback.');
} finally {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
}
