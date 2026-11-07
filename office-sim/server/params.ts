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
  /** Other wordings; each run's billboard picks one of text and these. */
  variants?: string[];
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
    variants: [
      "We're being acquired by our biggest rival; Sales and Operations will be folded into theirs.",
      'Merger confirmed: two Sales teams, two Ops teams, one org chart by next quarter.',
      "We're combining with a competitor; expect Sales and Operations to be cut by 15%.",
      'The board approved a merger; Sales and Operations report to new leads from Monday.',
    ],
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
    variants: [
      'A new VP starts Monday with a 90-day plan to change everything.',
      'Leadership shake-up: a VP from the competition takes over and wants results in 30 days.',
      'A new VP of Operations is reviewing every team, starting this week.',
      "The new VP's first memo: 'Nothing here is sacred.'",
    ],
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
    variants: [
      'Leadership says 16-hour days and working weekends until the launch ships.',
      'All leave is cancelled; 18-hour days until the release is out.',
      'New policy: everyone stays until 2am until the launch date.',
      'Leadership wants 7-day weeks for the next 6 weeks to hit the deadline.',
    ],
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
    variants: [
      'The company covered up a breach that exposed 2 million customer records.',
      'Customer passwords leaked 8 months ago and nobody was told.',
      'Legal buried a report about a customer data leak last spring.',
      'Someone in Security says a breach was hushed up before the funding round.',
    ],
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
    variants: [
      'Layoffs are coming next month, half of Sales.',
      'HR is drafting a list: 1 in 4 people are getting cut before the holidays.',
      'Layoffs in Q1, about 20% of the company.',
      'Every team has been told to cut 2 people by the end of the quarter.',
    ],
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
    variants: [
      'Everyone gets an extra 10% bonus in the next paycheque.',
      "A one-off bonus of two weeks' pay goes out on Friday.",
      'Record quarter: everyone gets a $2,000 bonus this month.',
      'Leadership is sharing the profits, with a bonus for every employee this month.',
    ],
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
    variants: [
      'A competitor is offering our engineers 40% more to jump ship.',
      "A rival's recruiter has messaged half the office this week, offering 25% more.",
      'Three people already left for a competitor paying 50% more.',
      'A competitor is offering signing bonuses to anyone from our team.',
    ],
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

/** Synthetic valuation assumptions; impacts and returns are in log-price units. */
export const priceParams = {
  initialPrice: 100, rho: 0.95, sigma: 0.005, oRef: 0.902724,
  outputAlpha: 0.3, outputFloor: 0.001, minPrice: 0.000001, maxPrice: 1000000000,
  refuteDelay: 6,
  trustCoefficient: 0.25, trustNegativeCap: 2, trustPositiveCap: 2,
  stressCoefficient: 0.3, stressCap: 1.5,
  productivity: {
    work: 1, overwork: 1, verify: 0.6, complain: 0.5, gossip: 0.5,
    slack_off: 0.3, interview: 0.2, leak: 0.2,
  } as Record<Action, number>,
  overworkBonus: 0.3,
  impacts: {
    merger: -0.02, new_management: -0.01, long_hours_policy: 0.02,
    pr_scandal: -0.08, layoffs_rumour: -0.03, surprise_bonus: -0.01,
    competitor_poaching: -0.04, leak: -0.03,
  } as Record<EventType | 'leak', number>,
};

export type PriceParams = typeof priceParams;

// ---------------------------------------------------------------------------
// Voice: how agents talk (server/llm/voice.ts, server/speech.ts). Weights are
// unnormalised. A rule reads one signal, scaled to 0-1: `hi` is how far above
// 50 it is, `lo` how far below, `flag` is 1 when a boolean is true. `add`
// rules run first (weight += add * f), then `mul` rules
// (weight *= max(floor, 1 + mul * f)).
// ---------------------------------------------------------------------------

export type VoiceSignal =
  | 'ambition' | 'financial_need' | 'ethics' | 'sociability' | 'impulsivity'
  | 'loyalty' | 'trust' | 'stress' | 'burnout' | 'recruiter';

export interface WeightRule<K extends string> {
  option: K;
  signal: VoiceSignal;
  dir: 'hi' | 'lo' | 'flag';
  add?: number;
  mul?: number;
  floor?: number;
}

export interface HabitDef {
  id: string;
  /** Sentence for the style brief. */
  text: string;
  /** Opening habits: at most one per agent. */
  opener: boolean;
}

export const voiceParams = {
  /** Master switch: off means no manners, briefs, checks or example calls (cards are still dealt). */
  enabled: true,
  card: {
    register: {
      base: { casual: 1, plain: 1.5, corporate: 0.5, clipped: 0.5 },
      rules: [
        { option: 'corporate', signal: 'ambition', dir: 'hi', add: 2.5 },
        { option: 'casual', signal: 'sociability', dir: 'hi', add: 2.5 },
        { option: 'clipped', signal: 'sociability', dir: 'lo', add: 2.5 },
      ] as WeightRule<string>[],
    },
    length: {
      base: { short: 1, medium: 2, rambling: 0.5 },
      rules: [
        { option: 'rambling', signal: 'sociability', dir: 'hi', add: 3 },
        { option: 'short', signal: 'sociability', dir: 'lo', add: 3 },
      ] as WeightRule<string>[],
      /** Chance of speaking in fragments = fragmentBase + fragmentImpulsivity * hi(impulsivity). */
      fragmentBase: 0.1,
      fragmentImpulsivity: 0.7,
    },
    humour: {
      base: { none: 1, dry: 1, self_deprecating: 1, sarcastic: 0.7, goofy: 0.7 },
      rules: [
        { option: 'sarcastic', signal: 'trust', dir: 'lo', add: 2.5 },
        { option: 'dry', signal: 'trust', dir: 'lo', add: 1.5 },
        { option: 'goofy', signal: 'loyalty', dir: 'hi', add: 2 },
        { option: 'self_deprecating', signal: 'loyalty', dir: 'hi', add: 1.5 },
        { option: 'dry', signal: 'sociability', dir: 'lo', add: 1.5 },
        { option: 'none', signal: 'sociability', dir: 'lo', add: 1.5 },
        // Loyal agents are almost never sarcastic.
        { option: 'sarcastic', signal: 'loyalty', dir: 'hi', mul: -1.5, floor: 0.05 },
      ] as WeightRule<string>[],
    },
    tell: {
      base: {
        goes_quiet: 0.3, overly_cheerful: 0.3, practical_logistics: 0.3, others_reactions: 0.3,
        opportunity: 0.3, life_outside_work: 0.3, asks_specifics: 0.3, polite_but_pointed: 0.3,
        states_principle: 0.3,
      },
      rules: [
        { option: 'practical_logistics', signal: 'financial_need', dir: 'hi', add: 3 },
        { option: 'others_reactions', signal: 'sociability', dir: 'hi', add: 3 },
        { option: 'opportunity', signal: 'ambition', dir: 'hi', add: 3 },
        { option: 'overly_cheerful', signal: 'loyalty', dir: 'hi', add: 3 },
        { option: 'life_outside_work', signal: 'loyalty', dir: 'lo', add: 3 },
        { option: 'life_outside_work', signal: 'recruiter', dir: 'flag', add: 1.5 },
        { option: 'states_principle', signal: 'ethics', dir: 'hi', add: 3 },
        { option: 'goes_quiet', signal: 'sociability', dir: 'lo', add: 3 },
        { option: 'asks_specifics', signal: 'impulsivity', dir: 'lo', add: 1.5 },
        { option: 'polite_but_pointed', signal: 'trust', dir: 'lo', add: 1.5 },
      ] as WeightRule<string>[],
    },
    /** Chance an agent gets two verbal habits rather than one. */
    twoHabitsChance: 0.5,
    habits: [
      { id: 'right', text: 'You often start with "Right."', opener: true },
      { id: 'honestly', text: 'You often start with "Honestly".', opener: true },
      { id: 'look', text: 'You often start with "Look".', opener: true },
      { id: 'okay_so', text: 'You often start with "Okay so".', opener: true },
      { id: 'i_mean', text: 'You often start with "I mean".', opener: true },
      { id: 'listen', text: 'You often start with "Listen".', opener: true },
      { id: 'question', text: 'You often end on a question.', opener: false },
      { id: 'anyway', text: 'You tend to trail off with "anyway."', opener: false },
      { id: 'sports', text: 'You reach for sports metaphors.', opener: false },
      { id: 'cooking', text: 'You reach for cooking metaphors.', opener: false },
      { id: 'gardening', text: 'You reach for gardening metaphors.', opener: false },
      { id: 'threes', text: 'You list things in threes.', opener: false },
      { id: 'fair_enough', text: 'You say "fair enough" a lot.', opener: false },
      { id: 'mate', text: 'You call people "mate".', opener: false },
      { id: 'to_be_fair', text: 'You say "to be fair" a lot.', opener: false },
      { id: 'understatement', text: 'You understate things ("not ideal").', opener: false },
      { id: 'numbers', text: 'You like exact numbers.', opener: false },
      { id: 'classic', text: 'You say "classic" when things go wrong.', opener: false },
      { id: 'bless', text: 'You say "bless" about people.', opener: false },
      { id: 'no_drama', text: 'You say "no drama" a lot.', opener: false },
    ] as HabitDef[],
    topicCount: 2,
    topics: [
      'the kids and the school run', 'the gym', 'football', 'cooking', 'the commute', 'your dog',
      'your cat', 'your side project', 'holiday plans', 'coffee', 'your house plants',
      'gigs and music', 'your running club', 'your allotment', 'a TV series you are hooked on',
      'the bills', 'your elderly parent', 'your car',
    ],
    /** Topics made likelier by financial need: weight * (1 + financialTopicBoost * hi(financial_need)). */
    financialTopics: ['the bills', 'the kids and the school run', 'your elderly parent'],
    financialTopicBoost: 3,
    /** Diversity check: redraws of register, humour and tell before forcing a free tell. */
    maxResamples: 20,
    /** Variants per feeling band (server/llm/bands.ts). */
    feelingVariants: 3,
  },
  manner: {
    base: {
      deflect_joke: 1, practical_question: 1, change_subject: 0.9, personal_aside: 1,
      overly_positive: 0.6, minimal: 0.7, talk_to_colleague: 1, comment_on_other: 0.8,
      set_boundary: 0.6, gallows: 0.5,
    },
    rules: [
      { option: 'minimal', signal: 'stress', dir: 'hi', mul: 2 },
      { option: 'gallows', signal: 'stress', dir: 'hi', mul: 2 },
      { option: 'overly_positive', signal: 'stress', dir: 'lo', mul: 1.5 },
      { option: 'change_subject', signal: 'stress', dir: 'lo', mul: 1.5 },
      { option: 'talk_to_colleague', signal: 'sociability', dir: 'hi', mul: 1.5 },
      { option: 'comment_on_other', signal: 'sociability', dir: 'hi', mul: 1.5 },
      { option: 'minimal', signal: 'sociability', dir: 'lo', mul: 1 },
      { option: 'set_boundary', signal: 'burnout', dir: 'hi', mul: 1.5 },
    ] as WeightRule<string>[],
    /** Multiplier on the manner that matches the agent's displeasure tell. */
    tellBoost: 2.5,
    /** Multipliers when the card's humour is `none`. */
    noHumour: { deflect_joke: 0.2, gallows: 0.2 } as Record<string, number>,
    /** Multipliers by this turn's stance. */
    stance: {
      believer: { gallows: 0.3, set_boundary: 0.6 },
      pragmatist: {},
      sceptic: { overly_positive: 0.5 },
    } as Record<string, Record<string, number>>,
    /** At most this many agents share a manner in one round. */
    roundCap: 2,
    /** Chance the verbal habits appear in this turn's brief. */
    habitShowChance: 0.6,
    /** Added to affinity when drawing who to address. */
    addresseeEpsilon: 1,
  },
  /** Stance toward leadership, from current trust_mgmt. */
  stance: { believerMin: 65, scepticBelow: 40 },
  /** Word limits written into the prompt. */
  words: { publicMax: 15, innerMax: 30, minimalMax: 4, shortMin: 3, shortMax: 8, examplesMax: 20 },
  /** Anti-repetition post-check. */
  speech: {
    /** Rounds of colleagues' lines shown in the prompt and checked against. */
    recentRounds: 2,
    /** Lines whose first this-many words match another agent's line this round are flagged. */
    openerWords: 3,
    /** Word-trigram Jaccard similarity above this is flagged. */
    trigramThreshold: 0.5,
    /** An echo opener has an event key term within this many leading words. */
    echoWords: 5,
    /** Flagged lines get one regeneration, within the tick's request budget. */
    regenerate: true,
  },
  /** One call per agent for three small-talk lines used as style examples. */
  examples: { enabled: true, count: 3 },
  /** Banned in public lines. Phrases match anywhere; sentences only as a whole sentence. */
  bannedPhrases: [
    'Anyone actually know', 'keep my head down', 'running on fumes', "Let's see if it actually",
    'before anyone panics', "it's not a plan, it's a threat",
  ],
  bannedSentences: ['Sure.'],
  /** Case-insensitive regexes for archetype labels used as names. */
  labelPatterns: [
    '\\bclimbers?\\b', '\\bloyalists?\\b', '\\bgossip hubs?\\b', '\\bs[ck]eptics?\\b',
    '\\bbreadwinners?\\b', '\\bflight risks?\\b', '\\bops (?:would|will|knows?|says?|thinks?|said)\\b',
  ],
  tickPatterns: ['\\bticks?\\b'],
  /** Word prefixes that name each event, for the echo-opener check. Numbers in the text are added. */
  eventKeyTerms: {
    merger: ['merg', 'acqui', 'takeover', 'rival', 'combin', 'org chart'],
    new_management: ['vp', 'new boss', 'new manag', 'shake up', 'memo', 'sacred'],
    long_hours_policy: ['hour', 'policy', 'weekend', 'overtime', 'all nighter', 'launch'],
    pr_scandal: ['breach', 'leak', 'hack', 'password', 'record', 'cover up', 'covered up', 'scandal', 'hushed'],
    layoffs_rumour: ['layoff', 'laid off', 'cut', 'redundan', 'axe'],
    surprise_bonus: ['bonus', 'paycheque', 'paycheck', 'payout'],
    competitor_poaching: ['competitor', 'recruit', 'poach', 'rival', 'jump ship', 'signing'],
  } as Record<EventType, string[]>,
  /** Mirrors src/Workday.tsx: 16 ticks a day, the first at 09:00. */
  clock: { ticksPerDay: 16, firstHour: 9, afternoonFrom: 12, eveningFrom: 17 },
};

export type VoiceParams = typeof voiceParams;

export const DEFAULT_PARAMS = {
  bias: biasParams,
  rules: ruleParams,
  events: eventParams,
  quit: quitParams,
  setup: setupParams,
  price: priceParams,
  voice: voiceParams,
};

export type Params = typeof DEFAULT_PARAMS;
