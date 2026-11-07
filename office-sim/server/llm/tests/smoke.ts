import 'dotenv/config';
import assert from 'node:assert/strict';

import { createMessageClient } from '../client';
import { parseReply } from '../parse';

async function main() {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error('BLOCKED: ANTHROPIC_API_KEY is not configured.');
    process.exitCode = 1;
    return;
  }

  const requestMessage = createMessageClient();
  const result = await requestMessage('Return JSON only, exactly {"ok":true}. No markdown.');
  assert.ok(result, 'Anthropic request failed; see sanitized request metrics');
  assert.equal(result.message.stop_reason, 'end_turn', 'Response did not finish normally');
  assert.deepEqual(parseReply(result.message), { ok: true });
  assert.ok(result.metrics.usage);
  assert.ok(result.metrics.usage.promptTokens > 0);
  assert.ok(result.metrics.usage.completionTokens > 0);
  assert.ok(Number.isFinite(result.metrics.latencyMs) && result.metrics.latencyMs >= 0);
  console.log('Live Anthropic smoke check passed.');
}

void main().catch(() => {
  console.error('Live Anthropic smoke check failed. No response or credential data logged.');
  process.exitCode = 1;
});
