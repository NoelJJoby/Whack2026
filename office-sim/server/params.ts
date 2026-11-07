import { BURNOUT_STRESS_THRESHOLD, BURNOUT_RECOVERY_THRESHOLD } from '../shared/stressThresholds';
import type { Action, EventType } from '../shared/types';

export const simParams = {
  agentCount: 8,
  comfortableWorkload: 45,
  trustMgmtDrop: 10,
  burnoutThreshold: 80,
  loyaltyThreshold: 30,
  trustThreshold: 35,
};

// ---------------------------------------------------------------------------
// Every tunable number in the engine lives below. Nothing else hard-codes one.
// Values are starting points to tune, not findings. 0-100 state values are
// scaled to 0-1 inside the bias engine; rule deltas are on the 0-100 scale.
// ---------------------------------------------------------------------------

/** Bias engine (docs/bias-engine-brief.md). */
export const biasParams = {
  priors: {
    work: 0.45,
    overwork: 0.08,
    slack_off: 0.1,
    complain: 0.1,
    gossip: 0.1,
    verify: 0.07,
    interview: 0.05,
    leak: 0.05,
  } as Record<Action, number>,
  /** LLM share of influence in llm_bias: w^alpha * prior^(1-alpha). */
  alpha: 0.6,
  /** Minimum LLM weight for every available action. */
  floorWeight: 0.03,
  clampMin: 0.1,
  clampMax: 5,
  /** g = gainBase + gainScale * impulsivity. */
  gainBase: 0.5,
  gainScale: 1,
  /** Pressure P = pressureStress * stress + pressureBurnout * burnout. */
  pressureStress: 0.6,
  pressureBurnout: 0.4,
  modifiers: {
    // (1 - pressure*P) * (1 + loyalty*L)
    work: { pressure: 0.6, loyalty: 0.3 },
    // (1 + ambition*A) * (1 + financialNeed*F) * (1 + loyalty*L) * (1 - burnout*B)
    overwork: { ambition: 0.8, financialNeed: 0.6, loyalty: 0.8, burnout: 0.7 },
    // (1 + pressure*P) * (1 - loyalty*L) * (1 - financialNeed*F)
    slack_off: { pressure: 1.5, loyalty: 0.5, financialNeed: 0.4 },
    // (1 + pressure*P) * (1 + distrust*D) * (sociabilityBase + S)
    complain: { pressure: 2, distrust: 1, sociabilityBase: 0.5 },
    // (base + sociability*S) * (1 + pressure*P) * freshBoost if a claim was heard recently
    gossip: { base: 0.4, sociability: 1.6, pressure: 1, freshBoost: 1.5 },
    // (ethicsBase + E) * (1 + distrust*D) * (1 - impulsivity*I)
    verify: { ethicsBase: 0.5, distrust: 1, impulsivity: 0.5 },
    // (1 + burnout*B) * (loyaltyBase - L) * (1 - financialNeed*F) * recruiterBoost if recruiter contact
    interview: { burnout: 3, loyaltyBase: 1.5, financialNeed: 0.5, recruiterBoost: 2 },
    // (base + ethicsDistrust*E*D) * (1 + pressure*P)
    leak: { base: 0.2, ethicsDistrust: 1.5, pressure: 1 },
  },
  /** A claim counts as fresh if heard within this many ticks. */
  freshWindow: 2,
  /** Leak needs a scandal claim with effective belief at least this (0-100). */
  leakBeliefThreshold: 60,
  /** Effective belief = beliefLlmShare * LLM belief + (1 - share) * source trust. */
  beliefLlmShare: 0.6,
  /** Gossip claim choice: effective belief times this if the claim is fresh. */
  claimFreshBoost: 1.5,
  /** Added to affinity / source-trust weights when drawing a target, so 0 is still possible. */
  targetWeightEpsilon: 1,
  /** Invalid LLM output is retried this many times before falling back to `rules`. */
  llmRetries: 1,
  /** Explain line: minimum probability gain over the LLM weight worth calling a push. */
  explainMinGap: 0.05,
  /** Explain line: scaled state/trait level that counts as a driver. */
  explainHigh: 0.65,
  explainLow: 0.35,
};

/** Effect of hearing a claim, scaled by effective belief / 100. */
export interface ClaimImpact {
  stress: number;
  trust_mgmt: number;
  loyalty: number;
}

export interface EventParams {
  text: string;
  isTrue: boolean;
  scandal: boolean;
  /** Official: everyone hears it from management and direct effects apply. */
  official: boolean;
  /** Function groups hit by the direct effects; 'all' for everyone. */
  groups: 'all' | string[];
  direct: { stress: number; workload: number; baselineWorkload: number; loyalty: number; trust_mgmt: number };
  /** Extra stress for managers who must enforce the policy. */
  managerStress: number;
  onHear: ClaimImpact;
}

const noImpact: ClaimImpact = { stress: 0, trust_mgmt: 0, loyalty: 0 };
const noDirect = { stress: 0, workload: 0, baselineWorkload: 0, loyalty: 0, trust_mgmt: 0 };

export const eventParams: Record<EventType, EventParams> = {
  merger: {
    text: "We're merging with a competitor; Sales and Operations will be restructured.",
    isTrue: true,
    scandal: false,
    official: true,
    groups: ['Sales', 'Operations'],
    direct: { stress: 10, workload: 10, baselineWorkload: 5, loyalty: -5, trust_mgmt: -5 },
    managerStress: 0,
    onHear: noImpact,
  },
  new_management: {
    text: 'A new VP is taking over and wants big changes fast.',
    isTrue: true,
    scandal: false,
    official: true,
    groups: 'all',
    direct: { stress: 5, workload: 0, baselineWorkload: 0, loyalty: -3, trust_mgmt: -10 },
    managerStress: 5,
    onHear: noImpact,
  },
  long_hours_policy: {
    text: 'Leadership says 20-hour days until the launch ships.',
    isTrue: true,
    scandal: false,
    official: true,
    groups: 'all',
    direct: { stress: 8, workload: 25, baselineWorkload: 20, loyalty: -5, trust_mgmt: -15 },
    managerStress: 10,
    onHear: noImpact,
  },
  pr_scandal: {
    text: 'The company hid a customer data breach for months.',
    isTrue: true,
    scandal: true,
    official: false,
    groups: 'all',
    direct: noDirect,
    managerStress: 0,
    onHear: { stress: 4, trust_mgmt: -12, loyalty: -4 },
  },
  layoffs_rumour: {
    text: 'Layoffs are coming in Q4, a third of the team.',
    isTrue: false,
    scandal: false,
    official: false,
    groups: 'all',
    direct: noDirect,
    managerStress: 0,
    onHear: { stress: 10, trust_mgmt: -6, loyalty: -4 },
  },
  surprise_bonus: {
    text: 'Everyone gets a surprise bonus this month.',
    isTrue: true,
    scandal: false,
    official: true,
    groups: 'all',
    direct: { stress: -5, workload: 0, baselineWorkload: 0, loyalty: 10, trust_mgmt: 8 },
    managerStress: 0,
    onHear: noImpact,
  },
  competitor_poaching: {
    text: 'A competitor is hiring our people at 30% more pay.',
    isTrue: true,
    scandal: false,
    official: false,
    groups: 'all',
    direct: noDirect,
    managerStress: 0,
    onHear: { stress: 0, trust_mgmt: 0, loyalty: -6 },
  },
};

/** Action resolution and passive state rules (office-sim/agent.md, tick steps 3-5). */
export const ruleParams = {
  comfortableWorkload: simParams.comfortableWorkload,
  /** Defaults for pairs missing from the cast. */
  defaultAffinity: 50,
  defaultSourceTrust: 50,
  actions: {
    work: { stress: -1 },
    overwork: { workload: 8, stress: 5, burnout: 2 },
    slack_off: { stress: -8, workload: -6, noticeChance: 0.3, noticedLoyalty: -2, noticedAffinity: -3 },
    complain: { pull: 0.1, speakerStress: -3, affinity: 2 },
    gossip: { speakerStress: -2, affinity: 3 },
    verify: { accuracy: 0.8, sourceTrustShift: 15, confirmedBelief: 90, refutedBelief: 10 },
    interview: { loyalty: -3, stress: -2 },
    leak: { trust_mgmt: -8, leakerStress: 5 },
  },
  passive: {
    /**
     * Stress relaxes toward target = stressBase + stressPerExcessWorkload * max(0, workload - comfortable),
     * by stressRelax of the gap per tick: it rises under excess workload and falls when workload is normal.
     */
    stressBase: 30,
    stressPerExcessWorkload: 1.0,
    stressRelax: 0.25,
    /** Burnout accumulates above this stress ... */
    burnoutStressHigh: BURNOUT_STRESS_THRESHOLD,
    burnoutGain: 2,
    /** ... plus this per point of stress above burnoutStressHigh. */
    burnoutGainPerStress: 0.05,
    /** Burnout decays slowly below this stress. */
    burnoutStressLow: BURNOUT_RECOVERY_THRESHOLD,
    burnoutDecay: 1,
    /** Workload relaxes toward the agent's baseline by this fraction per tick. */
    workloadRelax: 0.15,
    /** Loyalty erodes while stress is above this. */
    loyaltyStressHigh: 70,
    loyaltyErosion: 1,
  },
  /** Positive trust_mgmt changes are scaled by this (trust drops fast, recovers slowly). */
  trustRecoveryFactor: 0.5,
  /** Distortion rate is a 0-100 trait; probability = rate * distortionScale. */
  distortionScale: 0.01,
};

/** Quit check (office-sim/agent.md, tick step 5). */
export const quitParams = {
  /** Used when an agent's quit_threshold trait is 0 or missing. */
  defaultBurnoutThreshold: simParams.burnoutThreshold,
  loyaltyThreshold: simParams.loyaltyThreshold,
  trustThreshold: simParams.trustThreshold,
  /** Each interview within interviewWindow ticks lowers the burnout threshold by this. */
  interviewThresholdDrop: 10,
  interviewWindow: 3,
};

/** Run-level setup. */
export const setupParams = {
  /** Fixed traits are drawn as archetype value +/- this, from the run seed. */
  traitJitter: 10,
};

export const DEFAULT_PARAMS = {
  bias: biasParams,
  rules: ruleParams,
  events: eventParams,
  quit: quitParams,
  setup: setupParams,
};

export type Params = typeof DEFAULT_PARAMS;
