import Anthropic from '@anthropic-ai/sdk';

import { llmConfig } from './config';
import { recordRequestMetrics } from './telemetry';

export interface CallMetrics {
  latencyMs: number;
  outcome: 'success' | 'error';
  usage: { promptTokens: number; completionTokens: number } | null;
}

export interface MessageResult {
  message: Anthropic.Message;
  metrics: CallMetrics;
}

interface ClientOptions {
  // Injection uses the real SDK's fetch interface for isolated transport tests.
  fetch?: NonNullable<ConstructorParameters<typeof Anthropic>[0]>['fetch'];
  timeoutMs?: number;
  onMetrics?: (metrics: CallMetrics) => void;
}

export function createMessageClient(options: ClientOptions = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error('ANTHROPIC_API_KEY is required');
  }

  const client = new Anthropic({
    apiKey,
    // Keep this client on Anthropic even if a provider override exists in env.
    baseURL: 'https://api.anthropic.com',
    maxRetries: llmConfig.maxRetries,
    timeout: options.timeoutMs ?? llmConfig.timeoutMs,
    fetch: options.fetch,
    logLevel: 'off',
  });

  function record(metrics: CallMetrics) {
    recordRequestMetrics(metrics);
    // Never log SDK errors, prompts, response bodies or credentials.
    console.info('anthropic_request', metrics);
    try {
      options.onMetrics?.(metrics);
    } catch {
      // Observability must not turn a successful call into a failed decision.
    }
  }

  return async function requestMessage(prompt: string): Promise<MessageResult | null> {
    const started = performance.now();
    try {
      const message = await client.messages.create({
        model: llmConfig.model,
        max_tokens: llmConfig.maxOutputTokens,
        messages: [{ role: 'user', content: prompt }],
      });
      const metrics: CallMetrics = {
        latencyMs: performance.now() - started,
        outcome: 'success',
        usage: {
          promptTokens: message.usage.input_tokens,
          completionTokens: message.usage.output_tokens,
        },
      };
      record(metrics);
      return { message, metrics };
    } catch {
      record({ latencyMs: performance.now() - started, outcome: 'error', usage: null });
      return null;
    }
  };
}
