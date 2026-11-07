import assert from 'node:assert/strict';

import { createTurnProvider } from '../../llm';
import { fixtureCast } from '../../scripts/fixture';
import { createWorld, runTick } from '../../tick';
import { NO_REGEN_PARAMS } from '../../test/helpers';
import { llmConfig } from '../config';
import { buildTurnPrompt } from '../prompt';

const key = process.env.ANTHROPIC_API_KEY;
process.env.ANTHROPIC_API_KEY = 'test-only-not-a-real-key';
try {
  const world = createWorld(fixtureCast(42), 42);
  const calls = new Map<string, number>();
  const tick = 1;
  // Stub routing uses exact precomputed prompts, never production correlation.
  const { buildContext } = await import('../../tick');
  const { DEFAULT_PARAMS } = await import('../../params');
  const prompts = new Map(world.ids.map((id, index) => {
    const ctx = buildContext({ ...world, tick }, world.agents[id], { mode: 'llm_raw', gossip: true }, [], DEFAULT_PARAMS);
    return [buildTurnPrompt(world.agents[id].profile, ctx), { id, index }];
  }));
  const provider = createTurnProvider({ fetch: async (request, init) => {
    const body = await new Request(request, init).json();
    const item = prompts.get(body.messages[0].content);
    assert.ok(item);
    const { id, index } = item;
    const attempt = (calls.get(id) ?? 0) + 1;
    calls.set(id, attempt);
    // Mix completion order; delayed requests overlap retry invocations.
    await new Promise(resolve => setTimeout(resolve, (8 - index) * 2));
    if (index === 2) return Response.json({ type: 'error', error: { type: 'api_error', message: 'test' } }, { status: 503 });
    return Response.json({
      id: `msg_${index}_${attempt}`, type: 'message', role: 'assistant', model: llmConfig.model,
      content: [{ type: 'text', text: JSON.stringify(index === 1 && attempt === 1 ? { proposals: [] } : {
        proposals: [{ action: 'work', weight: 1 }], public_line: 'A long day.', inner_monologue: 'I need a break.', beliefs: {},
      }) }],
      stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 100 + index, output_tokens: 10 + index },
    });
  } });
  // Exact attempt counts below: no speech regenerations.
  const result = await runTick(world, provider, { mode: 'llm_raw', scenario: [], gossip: true, billboard: true }, NO_REGEN_PARAMS);
  for (const decision of result.log.decisions) {
    const index = world.ids.indexOf(decision.agent);
    const log = decision.provider;
    assert.ok(log);
    const attempts = index === 1 || index === 2 ? 2 : 1;
    assert.equal(decision.tick, tick);
    assert.equal(log.attempts, attempts);
    assert.equal(log.retry_count, attempts - 1);
    assert.equal(calls.get(decision.agent), attempts);
    assert.equal(log.requests.length, attempts);
    assert.equal(log.cache_hit, false);
    assert.ok(log.latency_ms !== null && log.latency_ms >= 0);
    assert.equal(log.latency_ms, log.requests.reduce((sum, request) => sum + request.latencyMs, 0));
    assert.deepEqual(log.requests.map(request => request.attempt), attempts === 2 ? [1, 2] : [1]);
    if (index === 2) {
      assert.equal(log.usage, null);
      assert.ok(log.requests.every(request => request.outcome === 'error' && request.validation_error === 'no_output'));
      assert.equal(decision.fallback, 'no_output');
      assert.equal(decision.effective_mode, 'rules');
    } else {
      assert.deepEqual(log.usage, { promptTokens: (100 + index) * attempts, completionTokens: (10 + index) * attempts });
      assert.equal(decision.fallback, null);
      assert.equal(decision.llm?.cache_hit, false);
      assert.equal(log.requests[0].validation_error, index === 1 ? 'schema_mismatch' : null);
      assert.equal(log.requests.at(-1)?.validation_error, null);
    }
  }
  // A provider without transport telemetry still has accurate retry/fallback
  // counts, but cannot claim API usage, latency or cache status.
  const unreported = await runTick(world, async () => null, { mode: 'llm_raw', scenario: [], gossip: true, billboard: true });
  for (const decision of unreported.log.decisions) {
    assert.deepEqual(decision.provider, {
      attempts: 2, retry_count: 1, cache_hit: null, latency_ms: null, usage: null, requests: [],
    });
  }
  console.log('Concurrent engine decision logging passed: agent/tick isolation, retries, validation failures, fallback and API usage.');
} finally {
  if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = key;
}
