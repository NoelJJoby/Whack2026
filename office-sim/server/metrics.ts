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

export function reachSummary(claims: Claim[]): { trueReach: number; falseReach: number } {
  return {
    trueReach: claims.filter((claim) => claim.is_true).length,
    falseReach: claims.filter((claim) => !claim.is_true).length,
  };
}
