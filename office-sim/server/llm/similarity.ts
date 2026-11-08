// Line comparisons shared by the tick's anti-repetition check (server/speech.ts)
// and the metrics script (server/scripts/voice-metrics.ts). Pure functions.
import type { EventType } from '../../shared/types';
import type { VoiceParams } from '../params';

/** Lowercase words: curly quotes straightened, hyphens and slashes split, other punctuation dropped. */
export function tokens(line: string): string[] {
  return line
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[-–—/]/g, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

function trigramSet(t: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 < t.length; i++) out.add(`${t[i]} ${t[i + 1]} ${t[i + 2]}`);
  return out;
}

/** Jaccard similarity of word trigrams. Lines under three words score 1 only if identical. */
export function trigramSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  if (ta.length < 3 || tb.length < 3) return ta.join(' ') === tb.join(' ') ? 1 : 0;
  const A = trigramSet(ta);
  const B = trigramSet(tb);
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return shared / (A.size + B.size - shared);
}

/** Same first `n` words. A line shorter than `n` words matches only an identical line. */
export function openerMatch(a: string, b: string, n: number): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.length < n || tb.length < n) return ta.join(' ') === tb.join(' ');
  return ta.slice(0, n).join(' ') === tb.slice(0, n).join(' ');
}

export function sentences(line: string): string[] {
  return line.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

const padded = (t: string[]) => ` ${t.join(' ')} `;

/** Banned phrases (anywhere) and banned sentences (whole sentence only) found in a line. */
export function bannedHits(line: string, p: Pick<VoiceParams, 'bannedPhrases' | 'bannedSentences'>): string[] {
  const text = padded(tokens(line));
  const hits = p.bannedPhrases.filter((phrase) => text.includes(padded(tokens(phrase))));
  const said = sentences(line).map((s) => tokens(s).join(' '));
  for (const s of p.bannedSentences) if (said.includes(tokens(s).join(' '))) hits.push(s);
  return hits;
}

export function patternHits(line: string, patterns: readonly string[]): string[] {
  return patterns.filter((source) => new RegExp(source, 'i').test(line));
}

const NUMBER_WORDS: Record<number, string> = {
  1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine',
  10: 'ten', 11: 'eleven', 12: 'twelve', 13: 'thirteen', 14: 'fourteen', 15: 'fifteen', 16: 'sixteen',
  17: 'seventeen', 18: 'eighteen', 19: 'nineteen', 20: 'twenty', 24: 'twenty four', 25: 'twenty five',
  30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty', 90: 'ninety', 100: 'hundred',
};

const STOPWORDS = new Set([
  'about', 'after', 'again', 'their', 'there', 'these', 'those', 'which', 'while', 'would', 'everyone',
  'every', 'being', 'today', 'until', 'where', 'other', 'could', 'should', 'month', 'months', 'starting',
]);

/**
 * Words that name an event: its type's key terms, plus every number in its
 * text as digits and as words. A player-written event also contributes the
 * headline's content words (five letters or more).
 */
export function eventTerms(
  event: { type: EventType | null; text: string; custom?: boolean },
  keyTerms: VoiceParams['eventKeyTerms'],
): string[] {
  const terms = new Set<string>(event.type && !event.custom ? keyTerms[event.type] ?? [] : []);
  for (const m of event.text.matchAll(/\d+/g)) {
    const n = Number(m[0]);
    terms.add(m[0]);
    if (NUMBER_WORDS[n]) terms.add(NUMBER_WORDS[n]);
  }
  if (event.custom || !event.type) {
    for (const t of tokens(event.text)) if (t.length >= 5 && !STOPWORDS.has(t)) terms.add(t);
  }
  return [...terms].map((t) => tokens(t).join(' ')).filter(Boolean);
}

/** True if any term starts a word (or word run) in these tokens. */
function hasTerm(t: string[], terms: readonly string[]): boolean {
  const text = padded(t);
  return terms.some((term) => text.includes(` ${term}`));
}

/** A headline repeated back as a question ("Twenty-hour days? Sure.").
 * Concrete questions about consequences are welcome; the caller separately
 * checks verbatim headline similarity, including questions with an interrogative.
 */
export function isEchoOpener(line: string, terms: readonly string[], _firstWords?: number): boolean {
  if (terms.length === 0) return false;
  const first = sentences(line)[0] ?? '';
  const inquiry = /\b(?:what|how|why|who|when|where|does|do|can|could|will|would|has|have)\b/i.test(first);
  return first.endsWith('?') && !inquiry && hasTerm(tokens(first), terms);
}
