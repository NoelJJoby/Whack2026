// Player-written billboard events. The player writes the headline; the sim
// infers the office impact from the text and borrows a built-in event's tuned
// numbers so custom text can never set its own stress, trust or price values
// directly. checkHeadline runs in the browser for instant feedback and again on
// the server, which is the real gate.
import type { EventType } from './types';

export const CUSTOM_EVENT_KINDS = {
  restructuring: { base: 'merger', label: 'Restructuring', hint: 'Teams merged, split or reorganised' },
  leadership: { base: 'new_management', label: 'Leadership change', hint: 'A new boss or a change at the top' },
  harsh_policy: { base: 'long_hours_policy', label: 'Harsh policy', hint: 'More hours, less leave, tighter rules' },
  scandal: { base: 'pr_scandal', label: 'Scandal', hint: 'Something leadership hid' },
  job_rumour: { base: 'layoffs_rumour', label: 'Job-loss rumour', hint: 'Talk of cuts or redundancies' },
  good_news: { base: 'surprise_bonus', label: 'Good news', hint: 'Bonuses, perks, praise' },
  poaching: { base: 'competitor_poaching', label: 'Poaching', hint: 'Rivals hiring our people away' },
} as const satisfies Record<string, { base: EventType; label: string; hint: string }>;

export type CustomEventKind = keyof typeof CUSTOM_EVENT_KINDS;
export const CUSTOM_EVENT_KIND_IDS = Object.keys(CUSTOM_EVENT_KINDS) as [CustomEventKind, ...CustomEventKind[]];

export function inferCustomEventKind(raw: string): CustomEventKind {
  const text = normaliseHeadline(raw).toLowerCase();
  const scores: Record<CustomEventKind, number> = {
    restructuring: 0,
    leadership: 0,
    harsh_policy: 0,
    scandal: 0,
    job_rumour: 0,
    good_news: 0,
    poaching: 0,
  };

  const add = (kind: CustomEventKind, ...patterns: string[]) => {
    for (const pattern of patterns) {
      if (text.includes(pattern)) scores[kind] += 2;
    }
  };

  add('good_news', 'bonus', 'raise', 'pay rise', 'perk', 'promotion', 'retention', 'extra day off', 'team lunch', 'holiday', 'stock award', 'profit sharing', 'raise pay', 'bonus', 'hiring surge', 'strong quarter', 'growth');
  add('job_rumour', 'layoff', 'laid off', 'fired', 'fire', 'redundancy', 'downsizing', 'cut jobs', 'headcount', 'restructure team', 'reductions', 'cut staff', 'job losses', 'employment cuts', 'cuts', 'sacked', 'termination', 'staff reduction');
  add('harsh_policy', 'tariff', 'tariffs', 'tariff shock', 'costs rise', 'cost increase', 'costs spike', 'budget cut', 'raise costs', 'salary freeze', 'expensive', 'new policy', 'return to office', 'mandatory overtime', 'long hours', 'rollbacks', 'tightened rules', 'workday', 'hours', 'budget', 'import costs', 'shipping costs', 'office policy', 'hiring freeze', 'budget pressure', 'price rise', 'rising costs');
  add('scandal', 'scandal', 'fraud', 'cover-up', 'breach', 'misreporting', 'data leak', 'harassment', 'ethics', 'compliance', 'investigation', 'misconduct', 'cover up');
  add('poaching', 'poach', 'poaching', 'recruiter', 'rival hire', 'competitor hiring', 'counteroffer', 'jump ship', 'headhunters', 'talent raid');
  add('leadership', 'ceo', 'chief', 'vp', 'director', 'president', 'executive', 'leadership', 'manager', 'boss', 'new boss', 'shakeup', 'appointment', 'board');
  add('restructuring', 'reorg', 'reorganisation', 'reorganization', 'merge', 'split', 'department', 'restructure', 'office move', 'team realignment', 'consolidation', 'integration', 'realign', 'reorg plan');

  // The business event model is broad; the most likely pattern wins.
  const best = (Object.keys(scores) as CustomEventKind[]).sort((a, b) => scores[b] - scores[a])[0];
  return scores[best] > 0 ? best : 'harsh_policy';
}

export const CUSTOM_EVENT_LIMITS = {
  minLength: 12,
  maxLength: 140,
  maxWords: 28,
  /** Custom events waiting for the next tick. */
  maxPending: 2,
  /** Custom events accepted in one run. */
  maxPerRun: 12,
} as const;

export interface CustomEventEffectProfile {
  morale: number;
  trust: number;
  stress: number;
  burnout: number;
  productivity: number;
  churnRisk: number;
  rumorSpread: number;
  priceImpact: number;
}

export interface GeneratedCustomEvent {
  headline: string;
  kind: CustomEventKind;
  is_true: boolean;
  severity: number;
  durationTicks: number;
  summary: string;
  effects: CustomEventEffectProfile;
}

export const CUSTOM_EVENT_EFFECT_BOUNDS = {
  morale: { min: -30, max: 30 },
  trust: { min: -30, max: 30 },
  stress: { min: -20, max: 35 },
  burnout: { min: -15, max: 30 },
  productivity: { min: -25, max: 25 },
  churnRisk: { min: 0, max: 25 },
  rumorSpread: { min: 0, max: 35 },
  priceImpact: { min: -0.15, max: 0.15 },
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function clampCustomEventEffects(input: Partial<CustomEventEffectProfile>): CustomEventEffectProfile {
  const values: CustomEventEffectProfile = {
    morale: 0,
    trust: 0,
    stress: 0,
    burnout: 0,
    productivity: 0,
    churnRisk: 0,
    rumorSpread: 0,
    priceImpact: 0,
  };
  for (const key of Object.keys(values) as Array<keyof CustomEventEffectProfile>) {
    const bounds = CUSTOM_EVENT_EFFECT_BOUNDS[key];
    const raw = Number.isFinite(input[key]) ? Number(input[key]) : 0;
    values[key] = clamp(raw, bounds.min, bounds.max);
  }
  return values;
}

export const CUSTOM_EVENT_FALLBACK_EFFECTS: Record<CustomEventKind, Partial<CustomEventEffectProfile>> = {
  restructuring: { morale: -8, trust: -10, stress: 8, burnout: 6, productivity: -6, churnRisk: 8, rumorSpread: 12, priceImpact: -0.03 },
  leadership: { morale: -4, trust: -8, stress: 6, burnout: 4, productivity: -4, churnRisk: 6, rumorSpread: 8, priceImpact: -0.02 },
  harsh_policy: { morale: -12, trust: -10, stress: 12, burnout: 10, productivity: -10, churnRisk: 8, rumorSpread: 10, priceImpact: -0.05 },
  scandal: { morale: -16, trust: -18, stress: 10, burnout: 8, productivity: -8, churnRisk: 10, rumorSpread: 18, priceImpact: -0.07 },
  job_rumour: { morale: -10, trust: -8, stress: 8, burnout: 6, productivity: -5, churnRisk: 10, rumorSpread: 18, priceImpact: -0.04 },
  good_news: { morale: 12, trust: 14, stress: -6, burnout: -5, productivity: 6, churnRisk: -8, rumorSpread: -6, priceImpact: 0.03 },
  poaching: { morale: -12, trust: -8, stress: 7, burnout: 5, productivity: -7, churnRisk: 12, rumorSpread: 14, priceImpact: -0.05 },
};

export function createFallbackCustomEvent(kind: CustomEventKind, headline: string, isTrue: boolean): GeneratedCustomEvent {
  const base = CUSTOM_EVENT_FALLBACK_EFFECTS[kind];
  const effects = clampCustomEventEffects(base);
  return {
    headline: headline.trim(),
    kind,
    is_true: isTrue,
    severity: 3,
    durationTicks: 4,
    summary: `${CUSTOM_EVENT_KINDS[kind].label}: ${CUSTOM_EVENT_KINDS[kind].hint.toLowerCase()}`,
    effects,
  };
}

export type HeadlineRejection =
  | 'not_text'
  | 'too_short'
  | 'too_long'
  | 'too_many_words'
  | 'no_words'
  | 'formatting'
  | 'shouting'
  | 'spam'
  | 'links'
  | 'prompt_injection'
  | 'offensive'
  | 'off_setting';

export type HeadlineCheck =
  | { ok: true; text: string }
  | { ok: false; code: HeadlineRejection; message: string };

// Zero-width and bidirectional controls can hide text from the filters below.
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿­]/g;
// Any other control character, once ordinary whitespace has been collapsed.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

/** NFKC, invisible characters removed, whitespace collapsed, trimmed. */
export function normaliseHeadline(raw: string): string {
  return raw.normalize('NFKC').replace(INVISIBLE, '').replace(/[\t\r\n ]+/g, ' ').trim();
}

/** Lower case with common letter substitutions undone, for the word lists. */
function deobfuscate(text: string): string {
  const map: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };
  return text.toLowerCase().replace(/[013457@$!]/g, (c) => map[c]);
}

const words = (list: string[]) => new RegExp(`\\b(?:${list.join('|')})\\b`, 'i');

// Headlines go into every agent's prompt, so anything that reads as an
// instruction to a model, or mimics the reply format, is refused.
const INJECTION = [
  /\bignore\b.{0,40}\b(instructions?|rules|prompt|above|previous|prior)\b/i,
  /\b(disregard|forget|override)\b.{0,40}\b(instructions?|rules|prompt|everything)\b/i,
  /\bsystem\s*prompt\b/i,
  /\byou\s+(are|must|should|will)\s+(now|always|never)\b/i,
  /\b(respond|reply|answer|output)\s+(with|in|only)\b/i,
  /\b(chatgpt|claude|llm|language model|ai model|jailbreak|developer mode)\b/i,
  /\b(public_line|inner_monologue|claim_id)\b/i,
  /^\s*(system|user|assistant|human)\s*:/i,
  /\bjson\b/i,
];

// A starting list. With an API key the server also asks Claude, which catches
// what a word list misses.
const OFFENSIVE = words([
  'f[u*]ck\\w*', 'sh[i*]t\\w*', 'cunt\\w*', 'bitch\\w*', 'bastard\\w*', 'asshole\\w*', 'dickhead\\w*', 'wank\\w*',
  'whore\\w*', 'slut\\w*', 'porn\\w*', 'nudes?', 'naked', 'sex', 'sexy', 'orgy', 'rape[ds]?', 'raping', 'rapist\\w*',
  'molest\\w*', 'p(a)?edophil\\w*', 'nazi\\w*', 'hitler', 'kkk', 'retard\\w*', 'faggot\\w*', 'fag',
  'nigg\\w*', 'chink\\w*', 'spic', 'kike\\w*', 'tranny',
]);

// Not an office event: violence, death, disasters and the fantastical.
// Whole words only, so office idioms ("killing it", "price war", "ghosting",
// "stability", "alienated") still pass.
const OFF_SETTING = words([
  'killed', 'killings', 'kill (?:him|her|them|you|everyone|everybody|(?:the|my|our|his|her|their) (?:boss\\w*|ceo|managers?|staff|team|colleagues?|coworkers?))', 'murder\\w*', 'shooting', 'shootings', 'shot dead', 'guns?', 'gunm[ae]n',
  'gunfire', 'rifles?', 'bombs?', 'bombing\\w*', 'bomber\\w*', 'explosions?', 'terroris\\w*', 'stabb\\w*',
  'hostages?', 'kidnap\\w*', 'massacre\\w*', 'suicid\\w*', 'dies', 'died', 'found dead', 'deaths?', 'corpses?',
  'nukes?', 'apocalyp\\w*', 'zombies?', 'aliens?', 'ufos?', 'dragons?', 'wizards?', 'vampires?', 'ghosts?',
  'demons?', 'superpowers?', 'asteroids?', 'meteors?', 'time travel\\w*', 'dinosaurs?', 'end of the world',
]);

// Real people and companies: the game is about a fictional office.
const REAL_NAMES = words([
  'google', 'alphabet', 'apple', 'amazon', 'microsoft', 'meta', 'facebook', 'tesla', 'spacex', 'openai',
  'anthropic', 'nvidia', 'netflix', 'twitter', 'walmart', 'mcdonalds', 'musk', 'elon', 'bezos', 'zuckerberg',
  'trump', 'biden', 'obama', 'putin', 'xi jinping', 'king charles', 'taylor swift',
]);

const fail = (code: HeadlineRejection, message: string): HeadlineCheck => ({ ok: false, code, message });

/** Validate a player headline. Returns the cleaned text on success. */
export function checkHeadline(raw: unknown): HeadlineCheck {
  if (typeof raw !== 'string') return fail('not_text', 'Write the announcement as text.');
  const text = normaliseHeadline(raw);
  const { minLength, maxLength, maxWords } = CUSTOM_EVENT_LIMITS;

  if (text.length < minLength) return fail('too_short', `Write at least ${minLength} characters.`);
  if (text.length > maxLength) return fail('too_long', `Keep it to ${maxLength} characters.`);
  if (CONTROL.test(text)) return fail('formatting', 'Remove the hidden or control characters.');
  const wordList = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  if (wordList.length > maxWords) return fail('too_many_words', `Keep it to ${maxWords} words.`);
  const letters = text.match(/\p{L}/gu) ?? [];
  if (wordList.length < 3 || letters.length < minLength * 0.6) {
    return fail('no_words', 'Write a sentence of at least three words.');
  }
  if (/[<>{}[\]`\\|^~]/.test(text) || /&[a-z]+;|&#\d+;/i.test(text)) {
    return fail('formatting', 'Leave out code, markup and brackets.');
  }
  const upper = letters.filter((c) => c !== c.toLowerCase()).length;
  if (letters.length >= 10 && upper / letters.length > 0.6) return fail('shouting', 'Turn off caps lock.');
  if (/(.)\1{4,}/u.test(text) || /([!?.,])\1{2,}/.test(text)) return fail('spam', 'Remove the repeated characters.');
  const lower = wordList.map((w) => w.toLowerCase());
  if (new Set(lower).size < lower.length * 0.5) return fail('spam', 'Remove the repeated words.');
  if (/https?:|www\.|\.(com|net|org|io|co|uk|ai)\b|\S+@\S+\.\S+|(^|\s)[@#]\w/i.test(text)) {
    return fail('links', 'Leave out links, emails, handles and hashtags.');
  }

  const plain = deobfuscate(text);
  if (INJECTION.some((pattern) => pattern.test(text) || pattern.test(plain))) {
    return fail('prompt_injection', 'Write it as an office announcement, not instructions.');
  }
  if (OFFENSIVE.test(text) || OFFENSIVE.test(plain)) return fail('offensive', 'Keep it clean: no slurs, sexual content or abuse.');
  if (OFF_SETTING.test(plain)) return fail('off_setting', 'Keep it to things that could happen at an office: no violence, death or fantasy.');
  if (REAL_NAMES.test(plain)) return fail('off_setting', 'Leave out real people and companies.');

  return { ok: true, text };
}

/** Key for spotting the same headline twice in a run. */
export function headlineKey(text: string): string {
  return normaliseHeadline(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
