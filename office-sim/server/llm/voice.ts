// How each agent talks. A voice card is drawn once per agent from their traits
// and the run seed; each turn a manner is drawn from the card and current state.
// The engine picks how an agent responds, the LLM writes the words.
// Every number lives in params.voice; every draw uses the 'voice' or 'manner' stream.
import type { EngineTraits } from '../engine-types';
import type { VoiceParams, VoiceSignal, WeightRule } from '../params';
import { stream, type Rng } from '../rng';
import { bannedHits, tokens } from './similarity';

export const REGISTERS = ['casual', 'plain', 'corporate', 'clipped'] as const;
export const LENGTHS = ['short', 'medium', 'rambling'] as const;
export const HUMOURS = ['none', 'dry', 'self_deprecating', 'sarcastic', 'goofy'] as const;
export const TELLS = [
  'goes_quiet', 'overly_cheerful', 'practical_logistics', 'others_reactions', 'opportunity',
  'life_outside_work', 'asks_specifics', 'polite_but_pointed', 'states_principle',
] as const;
export const MANNERS = [
  'deflect_joke', 'practical_question', 'change_subject', 'personal_aside', 'overly_positive',
  'minimal', 'talk_to_colleague', 'comment_on_other', 'set_boundary', 'gallows',
] as const;
export const FEELINGS = ['stress', 'burnout', 'loyalty', 'trust'] as const;

export type Register = (typeof REGISTERS)[number];
export type Length = (typeof LENGTHS)[number];
export type Humour = (typeof HUMOURS)[number];
export type Tell = (typeof TELLS)[number];
export type Manner = (typeof MANNERS)[number];
export type Stance = 'believer' | 'pragmatist' | 'sceptic';
/** Per feeling, the variant index (0-2) used in each of its three bands. */
export type FeelingVariants = Record<(typeof FEELINGS)[number], [number, number, number]>;

export interface VoiceCard {
  register: Register;
  length: Length;
  fragments: boolean;
  humour: Humour;
  tell: Tell;
  /** Habit ids from params.voice.card.habits. */
  habits: string[];
  topics: string[];
  feelings: FeelingVariants;
  /** Redraws the diversity check needed (logged). */
  resamples: number;
}

/** The manner that each displeasure tell makes likelier. */
export const TELL_MANNER: Record<Tell, Manner> = {
  goes_quiet: 'minimal',
  overly_cheerful: 'overly_positive',
  practical_logistics: 'practical_question',
  asks_specifics: 'practical_question',
  others_reactions: 'comment_on_other',
  opportunity: 'personal_aside',
  life_outside_work: 'change_subject',
  polite_but_pointed: 'set_boundary',
  states_principle: 'set_boundary',
};

// --- Signals and weights ---------------------------------------------------

export type Signals = Partial<Record<VoiceSignal, number | boolean>>;

type Traits = Pick<EngineTraits, 'ambition' | 'financial_need' | 'ethics' | 'sociability' | 'impulsivity' | 'recruiter_contact'>;
type Mood = { stress?: number; burnout?: number; loyalty: number; trust_mgmt: number };

export function signalsOf(traits: Traits, state: Mood): Signals {
  return {
    ambition: traits.ambition,
    financial_need: traits.financial_need,
    ethics: traits.ethics,
    sociability: traits.sociability,
    impulsivity: traits.impulsivity,
    recruiter: traits.recruiter_contact,
    loyalty: state.loyalty,
    trust: state.trust_mgmt,
    stress: state.stress ?? 50,
    burnout: state.burnout ?? 50,
  };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 0-1: how far above 50 (hi) or below 50 (lo) a signal is, or 1 for a true flag. */
export function level(signals: Signals, signal: VoiceSignal, dir: WeightRule<string>['dir']): number {
  const v = signals[signal];
  if (dir === 'flag') return v ? 1 : 0;
  const n = typeof v === 'number' ? v : 50;
  return clamp01(dir === 'hi' ? (n - 50) / 50 : (50 - n) / 50);
}

/** Base weights, then every `add` rule, then every `mul` rule. */
export function weigh<K extends string>(
  base: Record<K, number>, rules: readonly WeightRule<string>[], signals: Signals,
): Record<K, number> {
  const w = { ...base };
  for (const r of rules) {
    if (r.add !== undefined && r.option in w) w[r.option as K] += r.add * level(signals, r.signal, r.dir);
  }
  for (const r of rules) {
    if (r.mul !== undefined && r.option in w) {
      w[r.option as K] *= Math.max(r.floor ?? 0, 1 + r.mul * level(signals, r.signal, r.dir));
    }
  }
  return w;
}

// --- Cards -----------------------------------------------------------------

interface Usage {
  habits: Map<string, number>;
  topics: Map<string, number>;
}

/** Uniform among the least-used candidates; `weight` scales the pick within them. */
function leastUsed<T extends string>(rng: Rng, items: readonly T[], used: Map<string, number>, weight: (t: T) => number = () => 1): T {
  const min = Math.min(...items.map((t) => used.get(t) ?? 0));
  const fresh = items.filter((t) => (used.get(t) ?? 0) === min);
  return rng.weighted(fresh, fresh.map(weight));
}

function drawCore(rng: Rng, s: Signals, p: VoiceParams['card']) {
  return {
    register: rng.pick(weigh(p.register.base, p.register.rules, s), REGISTERS).value,
    humour: rng.pick(weigh(p.humour.base, p.humour.rules, s), HUMOURS).value,
    tell: rng.pick(weigh(p.tell.base, p.tell.rules, s), TELLS).value,
  };
}

const clashes = (a: Pick<VoiceCard, 'register' | 'humour' | 'tell'>, others: readonly VoiceCard[]) =>
  others.some((o) => o.register === a.register && o.humour === a.humour && o.tell === a.tell);

function drawCard(rng: Rng, s: Signals, usage: Usage, others: readonly VoiceCard[], p: VoiceParams['card']): VoiceCard {
  let core = drawCore(rng, s, p);
  const length = rng.pick(weigh(p.length.base, p.length.rules, s), LENGTHS).value;
  const fragments = rng.chance(p.length.fragmentBase + p.length.fragmentImpulsivity * level(s, 'impulsivity', 'hi'));

  const habits: string[] = [];
  const count = rng.chance(p.twoHabitsChance) ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const hasOpener = habits.some((id) => p.habits.find((h) => h.id === id)?.opener);
    const pool = p.habits.filter((h) => !habits.includes(h.id) && !(hasOpener && h.opener)).map((h) => h.id);
    habits.push(leastUsed(rng, pool, usage.habits));
  }

  const topics: string[] = [];
  const boost = 1 + p.financialTopicBoost * level(s, 'financial_need', 'hi');
  for (let i = 0; i < p.topicCount; i++) {
    const pool = p.topics.filter((t) => !topics.includes(t));
    topics.push(leastUsed(rng, pool, usage.topics, (t) => (p.financialTopics.includes(t) ? boost : 1)));
  }

  const variant = (): [number, number, number] =>
    [rng.int(p.feelingVariants), rng.int(p.feelingVariants), rng.int(p.feelingVariants)];
  const feelings: FeelingVariants = { stress: variant(), burnout: variant(), loyalty: variant(), trust: variant() };

  // Diversity: no two agents share register, humour and tell together.
  let resamples = 0;
  while (clashes(core, others) && resamples < p.maxResamples) {
    core = drawCore(rng, s, p);
    resamples++;
  }
  if (clashes(core, others)) {
    const w = weigh(p.tell.base, p.tell.rules, s);
    const free = [...TELLS].sort((a, b) => w[b] - w[a]).find((tell) => !clashes({ ...core, tell }, others));
    if (free) core = { ...core, tell: free };
  }
  return { ...core, length, fragments, habits, topics, feelings, resamples };
}

function usageOf(cards: readonly VoiceCard[]): Usage {
  const usage: Usage = { habits: new Map(), topics: new Map() };
  for (const c of cards) {
    for (const h of c.habits) usage.habits.set(h, (usage.habits.get(h) ?? 0) + 1);
    for (const t of c.topics) usage.topics.set(t, (usage.topics.get(t) ?? 0) + 1);
  }
  return usage;
}

export interface VoiceSubject {
  id: string;
  traits: Traits;
  /** Starting state; loyalty and trust are state, not traits. */
  state: Mood;
}

/** Cards for a whole cast, drawn in cast order so the shared pools are deterministic. */
export function assignVoices(cast: readonly VoiceSubject[], seed: number, p: VoiceParams): Record<string, VoiceCard> {
  const out: Record<string, VoiceCard> = {};
  for (const a of cast) out[a.id] = addVoice(out, a, seed, 0, p);
  return out;
}

/** A card for one agent (a replacement, say) that respects the cards already dealt. */
export function addVoice(
  existing: Record<string, VoiceCard>, agent: VoiceSubject, seed: number, tick: number, p: VoiceParams,
): VoiceCard {
  const others = Object.entries(existing).filter(([id]) => id !== agent.id).map(([, c]) => c);
  return drawCard(stream(seed, tick, agent.id, 'voice'), signalsOf(agent.traits, agent.state), usageOf(others), others, p.card);
}

// --- Stance and manner -----------------------------------------------------

export function stanceFor(trustMgmt: number, p: VoiceParams): Stance {
  return trustMgmt >= p.stance.believerMin ? 'believer' : trustMgmt < p.stance.scepticBelow ? 'sceptic' : 'pragmatist';
}

export interface TurnStyle {
  /** News this employee actually heard, retained in logs for relevance metrics. */
  news?: string[];
  manner: Manner;
  stance: Stance;
  /** Colleague id for talk_to_colleague and comment_on_other. */
  addressee: string | null;
  /** Comfort topic for change_subject. */
  topic: string | null;
  habits_shown: boolean;
}

export interface MannerOptions {
  news?: boolean;
  hasColleagues: boolean;
  last: Manner | null;
  /** Manners already drawn this round, with counts. */
  round: Partial<Record<Manner, number>>;
}

export function mannerWeights(card: VoiceCard, signals: Signals, stance: Stance, o: MannerOptions, p: VoiceParams): Record<Manner, number> {
  const m = p.manner;
  const w = weigh(m.base, m.rules, signals);
  w[TELL_MANNER[card.tell]] *= m.tellBoost;
  if (card.humour === 'none') for (const [k, f] of Object.entries(m.noHumour)) w[k as Manner] *= f;
  for (const [k, f] of Object.entries(m.stance[stance] ?? {})) w[k as Manner] *= f;
  if (o.news) for (const [key, factor] of Object.entries(p.news.mannerMultipliers)) w[key as Manner] *= factor;
  if (!o.hasColleagues) w.talk_to_colleague = w.comment_on_other = 0;
  for (const k of MANNERS) if ((o.round[k] ?? 0) >= m.roundCap) w[k] = 0;
  if (o.last) w[o.last] = 0;
  if (MANNERS.every((k) => w[k] <= 0)) {
    // Every allowed manner was weighted out: fall back to uniform over what the constraints allow.
    for (const k of MANNERS) w[k] = k !== o.last && (o.round[k] ?? 0) < m.roundCap ? 1 : 0;
    if (MANNERS.every((k) => w[k] <= 0)) for (const k of MANNERS) w[k] = k !== o.last ? 1 : 0;
  }
  return w;
}

/** This turn's manner, plus who to address, which topic and whether to show habits. */
export function sampleStyle(
  rng: Rng,
  card: VoiceCard,
  signals: Signals,
  trustMgmt: number,
  colleagues: ReadonlyArray<{ id: string; affinity: number }>,
  o: Omit<MannerOptions, 'hasColleagues'>,
  p: VoiceParams,
): TurnStyle {
  const stance = stanceFor(trustMgmt, p);
  const manner = rng.pick(mannerWeights(card, signals, stance, { ...o, hasColleagues: colleagues.length > 0 }, p), MANNERS).value;
  const addressee = manner === 'talk_to_colleague' || manner === 'comment_on_other'
    ? rng.weighted(colleagues, colleagues.map((c) => c.affinity + p.manner.addresseeEpsilon)).id
    : null;
  const topic = manner === 'change_subject' ? card.topics[rng.int(card.topics.length)] ?? null : null;
  const habits_shown = rng.chance(p.manner.habitShowChance);
  return { manner, stance, addressee, topic, habits_shown };
}

// --- Brief text ------------------------------------------------------------

const NUMBER = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const num = (n: number) => NUMBER[n] ?? String(n);

const REGISTER_TEXT: Record<Register, string> = {
  casual: 'You use casual, everyday language.',
  plain: 'You speak plainly.',
  corporate: "You're a bit corporate and slip into work jargon.",
  clipped: "You're clipped and terse.",
};

const HUMOUR_TEXT: Record<Humour, string> = {
  none: 'You rarely joke.',
  dry: 'Your humour is dry.',
  self_deprecating: 'You joke at your own expense.',
  sarcastic: 'Your humour is sarcastic.',
  goofy: 'You have a goofy sense of humour.',
};

const TELL_TEXT: Record<Tell, string> = {
  goes_quiet: 'go quiet rather than complain',
  overly_cheerful: 'get extra cheerful',
  practical_logistics: 'talk logistics: money, hours, childcare',
  others_reactions: 'talk about how other people are taking it',
  opportunity: 'spin it into an opportunity',
  life_outside_work: 'bring up your life outside work',
  asks_specifics: 'ask for specifics: who, when, by what date',
  polite_but_pointed: 'stay polite but make your point',
  states_principle: 'state the principle at stake',
};

const STANCE_TEXT: Record<Stance, string> = {
  believer: 'You still believe leadership mean well; when things get hard it comes out as worry or taking on too much, not sarcasm.',
  pragmatist: 'You judge what leadership says by what actually happens to you.',
  sceptic: 'You stopped taking leadership at their word a while ago.',
};

function lengthText(card: VoiceCard, p: VoiceParams): string {
  const base = card.length === 'short' ? `You keep sentences short, ${p.words.shortMin} to ${p.words.shortMax} words.`
    : card.length === 'medium' ? 'Your sentences are medium length.'
      : 'You ramble: one run-on sentence with an aside, still within the word limit.';
  return card.fragments ? `${base} You often talk in fragments.` : base;
}

/** The "How you talk" brief (no stance line when stance is null). A believer's sarcasm reads as dry: cynicism needs fallen trust. */
export function describeVoice(card: VoiceCard, stance: Stance | null, habitsShown: boolean, p: VoiceParams, showTopics = false): string {
  const humour = stance === 'believer' && card.humour === 'sarcastic' ? 'dry' : card.humour;
  const habits = habitsShown
    ? card.habits.map((id) => p.card.habits.find((h) => h.id === id)?.text).filter(Boolean).join(' ')
    : '';
  const [a, b] = card.topics;
  return [
    REGISTER_TEXT[card.register], lengthText(card, p), HUMOUR_TEXT[humour],
    `When you're unhappy you ${TELL_TEXT[card.tell]}.`,
    habits,
    showTopics ? (b ? `You like to talk about ${a}, and ${b}.` : a ? `You like to talk about ${a}.` : '') : '',
    stance ? STANCE_TEXT[stance] : '',
  ].filter(Boolean).join(' ');
}

/** The "This time" instruction. */
export function describeManner(style: TurnStyle, nameOf: (id: string) => string, p: VoiceParams): string {
  const who = style.addressee ? nameOf(style.addressee) : 'a colleague';
  if (style.news?.length) {
    const news: Record<Manner, string> = {
      deflect_joke: 'make a joke about what the news means for your work.',
      practical_question: 'ask one concrete question about what the news means for your work.',
      change_subject: 'react to the news in your own words.',
      personal_aside: 'say what the news means for you personally.',
      overly_positive: 'put an overly bright spin on the news.',
      minimal: `give a one-to-${num(p.words.minimalMax)}-word reaction to the news.`,
      talk_to_colleague: `say what you make of the news directly to ${who}, using their name.`,
      comment_on_other: `remark on how ${who} is taking the news.`,
      set_boundary: "say what you will or won't do in response to the news.",
      gallows: 'make a dark joke about the consequences of the news.',
    };
    return news[style.manner];
  }
  switch (style.manner) {
    case 'deflect_joke': return 'make a joke in your own style about something nearby, not the news itself.';
    case 'practical_question': return 'ask one concrete question about your own work or your day.';
    case 'change_subject': return `talk about ${style.topic ?? 'something outside work'} instead.`;
    case 'personal_aside': return 'say what this means for you personally, without naming the news.';
    case 'overly_positive': return 'sound brighter than the situation deserves.';
    case 'minimal': return `give a minimal reply, one to ${num(p.words.minimalMax)} words.`;
    case 'talk_to_colleague': return `say something directly to ${who}, using their name.`;
    case 'comment_on_other': return `remark on how ${who} seems to be taking things.`;
    case 'set_boundary': return "say plainly what you will or won't do.";
    case 'gallows': return 'make a dark joke about the situation.';
  }
}

// --- Example small talk ----------------------------------------------------

export function examplesPrompt(name: string, voice: string, p: VoiceParams): string {
  const n = num(p.examples.count);
  return [
    `Write ${n} short things ${name} might say at work, to show how they talk.`,
    `How ${name} talks (written to them): ${voice}`,
    'Ordinary remarks at work: tasks, deadlines, colleagues and everyday concerns. Do not invent news or outcomes.',
    `Each line at most ${p.words.examplesMax} words. Make the ${n} lines different from each other.`,
    `Respond with JSON only, in this shape: {"lines": [${Array(p.examples.count).fill('"..."').join(', ')}]}`,
  ].join('\n\n');
}

/** Valid example lines from a parsed reply, or null if there are none. */
export function validExamples(raw: unknown, p: VoiceParams): string[] | null {
  const lines = (raw as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(lines)) return null;
  const ok = lines
    .filter((l): l is string => typeof l === 'string')
    .map((l) => l.trim())
    .filter((l) => l && tokens(l).length <= p.words.examplesMax && bannedHits(l, p).length === 0)
    .slice(0, p.examples.count);
  return ok.length ? ok : null;
}
