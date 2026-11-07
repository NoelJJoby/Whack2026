// Pure parts of the babble: mapping synthesis output onto the text, and one-voice gating.

export interface SynthOutput { char: string; phoneme: string; buffer: { length: number } }

/**
 * Text position → output for each voiced letter. Spaces, punctuation and unsupported
 * characters come out silent (or grouped), so each voiced letter is found in the text
 * from a moving cursor rather than by counting.
 */
export function alignToText<T extends SynthOutput>(text: string, outputs: T[]): Map<number, T> {
  const lower = text.toLowerCase();
  const map = new Map<number, T>();
  let cursor = 0;
  for (const output of outputs) {
    if (!output.buffer.length || !output.phoneme.trim()) continue;
    const letter = output.char.toLowerCase();
    if (!/\p{L}/u.test(letter)) continue;
    const index = lower.indexOf(letter, cursor);
    if (index < 0) continue;
    map.set(index, output);
    cursor = index + letter.length;
  }
  return map;
}

/**
 * One voice per speaker: a letter only sounds if the previous syllable has finished,
 * so the syllable rate follows the voice's speed while typing stays fixed.
 */
export class BabbleScheduler<T> {
  private busyUntil = 0;
  constructor(
    private readonly now: () => number,
    /** Starts the sound and returns its length in the same unit as `now`. */
    private readonly start: (item: T) => number,
    private readonly halt: (fadeMs: number) => void,
  ) {}

  blip(item: T | undefined): boolean {
    if (item === undefined) return false;
    const t = this.now();
    if (t < this.busyUntil) return false;
    this.busyUntil = t + this.start(item);
    return true;
  }

  stop(fadeMs: number) {
    this.busyUntil = 0;
    this.halt(fadeMs);
  }
}

export interface TypingSnapshot { phase: 'idle' | 'public' | 'inner' | 'reading'; shownPublic: number; shownInner: number }
export type BabbleStep =
  | { kind: 'blip'; part: 'public' | 'inner'; index: number }
  | { kind: 'stop'; reason: 'finished' | 'cut' }
  | null;

/**
 * What the voice does when the typewriter moves from `prev` to `next`:
 * a typed letter blips; typing the last letter ends the sound; any other phase change cuts it.
 */
export function babbleStep(prev: TypingSnapshot, next: TypingSnapshot): BabbleStep {
  if (next.phase === 'public' && prev.phase === 'public' && next.shownPublic === prev.shownPublic + 1) {
    return { kind: 'blip', part: 'public', index: next.shownPublic - 1 };
  }
  if (next.phase === 'inner' && prev.phase === 'inner' && next.shownInner === prev.shownInner + 1) {
    return { kind: 'blip', part: 'inner', index: next.shownInner - 1 };
  }
  if (prev.phase === next.phase) return null;
  const finished = (prev.phase === 'public' && next.shownPublic === prev.shownPublic + 1)
    || (prev.phase === 'inner' && next.shownInner === prev.shownInner + 1);
  return { kind: 'stop', reason: finished ? 'finished' : 'cut' };
}
