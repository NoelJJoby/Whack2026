import assert from 'node:assert/strict';

import type { TurnContext } from '../../engine-types';
import { createTurnProvider } from '../../llm';
import { makeAgent } from '../../test/helpers';
import { buildTurnPrompt } from '../prompt';
import { type CallMetrics } from '../client';
import { llmConfig } from '../config';

const originalKey = process.env.ANTHROPIC_API_KEY;
process.env.ANTHROPIC_API_KEY = 'test-only-not-a-real-key';

try {
  let started = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const metrics: CallMetrics[] = [];
  const attempts = new Map<number, number>();
  const inputs = Array.from({ length: 8 }, (_, id) => {
    const agent = makeAgent(`a${id}`, {});
    const ctx: TurnContext = {
      tick: 1, mode: 'llm_raw', state: agent.state, available: ['work'],
      colleagues: [], claims: [], events: [],
    };
    return { agent: agent.profile, ctx, persona: `You remember working with a${id}.` };
  });
  // Test transport routes exact known prompts to distinct stub responses. No
  // production correlation or identity is derived from prompt text.
  const idsByPrompt = new Map(inputs.map((input, id) => [buildTurnPrompt(input.agent, input.ctx, input.persona), id]));
  const provider = createTurnProvider({
    timeoutMs: 200,
    personaFor: agent => `You remember working with ${agent.id}.`,
    onMetrics: metric => metrics.push(metric),
    fetch: async (request, init) => {
      const body = await new Request(request, init).json();
      const id = idsByPrompt.get(body.messages[0].content);
      assert.notEqual(id, undefined);
      attempts.set(id!, (attempts.get(id!) ?? 0) + 1);
      started++;
      if (started === 8) release();
      // No response can finish until every request has entered fetch.
      await gate;
      if (id === 7) {
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener('abort', abort, { once: true });
        });
      }
      if (id === 6) {
        return Response.json({ type: 'error', error: { type: 'rate_limit_error', message: 'test' } },
          { status: 429 });
      }
      return Response.json({
        id: `msg_${id}`, type: 'message', role: 'assistant', model: llmConfig.model,
        content: [{ type: 'text', text: JSON.stringify({ id }) }],
        stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 20 + id!, output_tokens: 3 + id! },
      });
    },
  });
  const pending = inputs.map(input => provider(input.agent, input.ctx));
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const results = await Promise.race([
      Promise.all(pending),
      new Promise<never>((_resolve, reject) => {
        watchdog = setTimeout(() => reject(new Error('Concurrent provider calls exceeded timeout budget')), 2000);
      }),
    ]);
    assert.equal(started, 8);
    assert.equal(metrics.length, 8);
    assert.equal(metrics.filter(metric => metric.outcome === 'error').length, 2);
    for (let id = 0; id < 8; id++) {
      assert.equal(attempts.get(id), 1, 'One attempt per invocation, including failure');
      assert.deepEqual(results[id], id < 6 ? { id } : null);
      if (id < 6) assert.ok(metrics.some(metric => metric.usage?.promptTokens === 20 + id
        && metric.usage?.completionTokens === 3 + id));
    }
  } finally {
    clearTimeout(watchdog);
    release();
  }
  console.log('Eight calls through one provider passed; rate limit and timeout isolated, no local retries.');
} finally {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
}
