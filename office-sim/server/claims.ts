import type { Claim } from '../shared/types';

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'claim';
}

export function distortClaim(text: string, distortionRate = 0.2): string {
  if (!text || distortionRate <= 0) {
    return text;
  }

  const replacements: Record<string, string> = {
    company: 'the office',
    leadership: 'the manager',
    policy: 'the plan',
    scandal: 'rumour',
    layoffs: 'cuts',
    bonus: 'perk',
    competitor: 'another team',
  };

  return Object.entries(replacements).reduce((next, [from, to]) => {
    return next.replace(new RegExp(from, 'gi'), () => (Math.random() < distortionRate ? to : from));
  }, text);
}

export function createClaimFromEvent(
  text: string,
  source: string,
  tick: number,
  is_true: boolean,
  scandal = false,
  parent_id: string | null = null,
): Claim {
  return {
    id: `claim-${tick}-${source}-${slugify(text)}`,
    text,
    is_true,
    source,
    created_tick: tick,
    hops: 0,
    scandal,
    parent_id,
  };
}

export function spreadClaim(claim: Claim, source: string, tick: number): Claim {
  return {
    ...claim,
    id: `${claim.id}-hop-${tick}-${slugify(source)}`,
    source,
    hops: claim.hops + 1,
    parent_id: claim.id,
  };
}

export function claimReach(claims: Claim[], agentClaims: Record<string, Claim[]> = {}): { trueReach: number; falseReach: number } {
  const seen = new Set<string>();
  let trueReach = 0;
  let falseReach = 0;

  for (const [agentId, agentHeldClaims] of Object.entries(agentClaims)) {
    for (const claim of agentHeldClaims) {
      const key = `${agentId}:${claim.id}`;
      if (seen.has(key)) {
        continue;
      }
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
