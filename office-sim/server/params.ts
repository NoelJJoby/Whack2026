import type { EventType } from '../shared/types';

export const simParams = {
  agentCount: 8,
  comfortableWorkload: 45,
  stressThreshold: 60,
  trustMgmtDrop: 10,
  burnoutThreshold: 80,
  loyaltyThreshold: 30,
  trustThreshold: 35,
  gossipDistortionBase: 0.2,
  quitGraceTicks: 2,
  claimImpact: {
    gossip: 5,
    verify: 3,
    interview: 8,
    leak: 12,
    overwork: 7,
    long_hours_policy: 10,
  },
};

export const eventParams: Record<EventType, { claim: string; truth: boolean; affectedGroups: string[] }> = {
  merger: { claim: 'The company is merging with another firm.', truth: false, affectedGroups: ['Sales', 'Operations'] },
  new_management: { claim: 'New leadership is coming in to cut costs.', truth: false, affectedGroups: ['Exec', 'Operations'] },
  long_hours_policy: { claim: 'The team is shifting to 20-hour work weeks.', truth: true, affectedGroups: ['Engineering', 'Operations'] },
  pr_scandal: { claim: 'A public scandal is about to hit the company.', truth: true, affectedGroups: ['Exec', 'Sales'] },
  layoffs_rumour: { claim: 'Layoffs are being planned across the company.', truth: false, affectedGroups: ['Engineering', 'Operations'] },
  surprise_bonus: { claim: 'A surprise bonus is on the way for the team.', truth: true, affectedGroups: ['Sales', 'Engineering'] },
  competitor_poaching: { claim: 'A competitor is trying to poach top talent.', truth: false, affectedGroups: ['Sales', 'Engineering'] },
};
