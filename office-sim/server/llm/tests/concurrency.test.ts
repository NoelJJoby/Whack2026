import assert from 'node:assert/strict';

import { createMessageClient, type CallMetrics } from '../client';
import { llmConfig } from '../config';
import { parseReply } from '../parse';

const originalKey = process.env.ANTHROPIC_API_KEY;
process.env.ANTHROPIC_API_KEY = 'test-only-not-a-real-key';

try {
  let started = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const events = new Map<number, CallMetrics[]>();
  const attempts = new Map<number, number>();
  const pending = Array.from({ length: 8 }, (_, id) => {
    events.set(id, []);
    const request = createMessageClient({
      timeoutMs: 200,
      onMetrics: metric => events.get(id)!.push(metric),
      fetch: async (_input, init) => {
        attempts.set(id, (attempts.get(id) ?? 0) + 1);
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
        // Distinct output and usage expose cross-call state/correlation bugs.
        return Response.json({
          id: `msg_${id}`, type: 'message', role: 'assistant', model: llmConfig.model,
          content: [{ type: 'text', text: JSON.stringify({ id }) }],
          stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 20 + id, output_tokens: 3 + id },
        });
      },
    });
    return request(`concurrent test ${id}`).then(result => result ? parseReply(result.message) : null);
  });

  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const results = await Promise.race([
      Promise.all(pending),
      new Promise<never>((_resolve, reject) => {
        watchdog = setTimeout(() => reject(new Error('Concurrent calls exceeded timeout budget')), 2000);
      }),
    ]);
    assert.equal(started, 8);
    for (let id = 0; id < 8; id++) {
      assert.equal(attempts.get(id), 1, 'One attempt per invocation, including failure');
      assert.equal(events.get(id)!.length, 1);
      const event = events.get(id)![0];
      assert.ok(Number.isFinite(event.latencyMs) && event.latencyMs >= 0);
      assert.deepEqual(results[id], id < 6 ? { id } : null);
      assert.equal(event.outcome, id < 6 ? 'success' : 'error');
      assert.deepEqual(event.usage, id < 6
        ? { promptTokens: 20 + id, completionTokens: 3 + id } : null);
    }
  } finally {
    clearTimeout(watchdog);
    release();
  }
  console.log('Eight concurrent client calls passed; rate limit and timeout isolated, no retries.');
  console.log('Transport coverage only: exact engine provider integration remains blocked.');
} finally {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
}
