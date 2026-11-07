import type { Claim } from '../shared/types';

export function crackOrderFromEvents(events: Array<{ agent: string; tick: number }>): string[] {
  return events
    .slice()
    .sort((a, b) => a.tick - b.tick)
    .map((event) => event.agent);
}

export function firstQuitTime(events: Array<{ agent: string; tick: number }>): number | null {
  if (!events.length) {
    return null;
  }
  return Math.min(...events.map((event) => event.tick));
}

export function reachSummary(
  claims: Claim[],
  agentClaims: Record<string, Claim[]> = {},
): { trueReach: number; falseReach: number } {
  const seen = new Set<string>();
  let trueReach = 0;
  let falseReach = 0;

  for (const agentId of Object.keys(agentClaims)) {
    for (const claim of agentClaims[agentId] ?? []) {
      const key = `${agentId}:${claim.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (claim.is_true) trueReach += 1;
      else falseReach += 1;
    }
  }

  for (const claim of claims) {
    const key = `system:${claim.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (claim.is_true) trueReach += 1;
    else falseReach += 1;
  }

  return { trueReach, falseReach };
}
