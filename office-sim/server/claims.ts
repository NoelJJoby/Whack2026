import type { Claim } from '../shared/types';

export function distortClaim(text: string): string {
  return text;
}

export function createClaimFromEvent(text: string, source: string, tick: number, is_true: boolean): Claim {
  return {
    id: `claim-${tick}-${source}`,
    text,
    is_true,
    source,
    created_tick: tick,
    hops: 0,
  };
}

export function spreadClaim(claim: Claim): Claim {
  return { ...claim, id: `${claim.id}-copy`, hops: claim.hops + 1 };
}
