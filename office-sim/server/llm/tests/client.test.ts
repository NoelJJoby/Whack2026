import assert from 'node:assert/strict';

import { createMessageClient, type CallMetrics } from '../client';
import { llmConfig } from '../config';

const originalKey = process.env.ANTHROPIC_API_KEY;
const originalBaseURL = process.env.ANTHROPIC_BASE_URL;

try {
  delete process.env.ANTHROPIC_API_KEY;
  assert.throws(() => createMessageClient(), /ANTHROPIC_API_KEY is required/);
  process.env.ANTHROPIC_API_KEY = 'test-only-not-a-real-key';
  process.env.ANTHROPIC_BASE_URL = 'https://example.invalid';

  let calls = 0;
  const metrics: CallMetrics[] = [];
  const requestMessage = createMessageClient({
    onMetrics: metric => metrics.push(metric),
    fetch: async (input, init) => {
      calls++;
      const request = new Request(input, init);
      assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
      assert.equal(request.method, 'POST');
      const body = await request.json();
      assert.equal(body.model, llmConfig.model);
      assert.equal(body.max_tokens, llmConfig.maxOutputTokens);
      assert.deepEqual(body.messages, [{ role: 'user', content: 'test prompt' }]);
      assert.equal('temperature' in body, false);
      assert.equal('response_format' in body, false);
      return Response.json({
        id: 'msg_test', type: 'message', role: 'assistant', model: llmConfig.model,
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 17, output_tokens: 5 },
      });
    },
  });
  const result = await requestMessage('test prompt');
  assert.ok(result);
  assert.equal(calls, 1);
  assert.deepEqual(result.metrics.usage, { promptTokens: 17, completionTokens: 5 });
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].outcome, 'success');
  assert.ok(Number.isFinite(metrics[0].latencyMs) && metrics[0].latencyMs >= 0);

  for (const status of [429, 500]) {
    let attempts = 0;
    const events: CallMetrics[] = [];
    const fail = createMessageClient({
      onMetrics: metric => events.push(metric),
      fetch: async () => {
        attempts++;
        return Response.json({ type: 'error', error: { type: 'api_error', message: 'test' } }, { status });
      },
    });
    assert.equal(await fail('test'), null);
    assert.equal(attempts, 1, `HTTP ${status} must not retry`);
    assert.equal(events.length, 1);
    assert.equal(events[0].outcome, 'error');
    assert.equal(events[0].usage, null);
  }

  let transportAttempts = 0;
  const transportFailure = createMessageClient({
    fetch: async () => { transportAttempts++; throw new Error('network unavailable'); },
  });
  assert.equal(await transportFailure('test'), null);
  assert.equal(transportAttempts, 1);

  let timeoutAttempts = 0;
  const timeoutEvents: CallMetrics[] = [];
  const timeout = createMessageClient({
    timeoutMs: 20,
    onMetrics: metric => timeoutEvents.push(metric),
    fetch: async (_input, init) => {
      timeoutAttempts++;
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener('abort', abort, { once: true });
      });
    },
  });
  assert.equal(await timeout('test'), null);
  assert.equal(timeoutAttempts, 1);
  assert.equal(timeoutEvents.length, 1);
  assert.equal(timeoutEvents[0].outcome, 'error');
  assert.ok(timeoutEvents[0].latencyMs < 2000, 'SDK timeout must bound the request');
  console.log('Anthropic client checks passed (stubbed transport; no live API calls).');
} finally {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
  if (originalBaseURL === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = originalBaseURL;
}
