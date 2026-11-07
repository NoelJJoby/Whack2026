import { AsyncLocalStorage } from 'node:async_hooks';

import type { CallMetrics } from './client';

// The engine establishes a distinct collector for each provider invocation.
// This side channel keeps metadata out of TurnProvider's output/signature and
// does not infer agent/tick identity from a prompt or mutate global callbacks.
const requestMetrics = new AsyncLocalStorage<CallMetrics[]>();

export function withRequestMetrics<T>(metrics: CallMetrics[], invoke: () => Promise<T>): Promise<T> {
  return requestMetrics.run(metrics, invoke);
}

export function recordRequestMetrics(metrics: CallMetrics): void {
  requestMetrics.getStore()?.push({ ...metrics, usage: metrics.usage ? { ...metrics.usage } : null });
}
