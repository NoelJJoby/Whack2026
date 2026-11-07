// Player-written billboard events. The player writes the headline and picks a
// kind; the kind decides the effects by borrowing a built-in event's tuned
// numbers, so custom text can never set its own stress, trust or price values.
// checkHeadline runs in the browser for instant feedback and again on the
// server, which is the real gate.
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

export const CUSTOM_EVENT_LIMITS = {
  minLength: 12,
  maxLength: 140,
  maxWords: 28,
  /** Custom events waiting for the next tick. */
  maxPending: 2,
  /** Custom events accepted in one run. */
  maxPerRun: 12,
} as const;

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
