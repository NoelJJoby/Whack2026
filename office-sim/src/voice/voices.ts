// Every voice tunable in one place. Values are starting points: tune by ear.
import { looks } from '../design/Office';
import type { Emotion } from './emotion';

export interface Voice {
  /** animalese-tts PitchManager options. `speed` shortens each syllable without changing pitch. */
  pitch: number;
  speed: number;
  randomness: number;
  melodyRate: number;
  melodyAmplitude: number;
  /** Output volume, 0 to 1. */
  gain: number;
  /** Low-pass cutoff in Hz for a muffled whisper; omitted for normal speech. */
  lowpassHz?: number;
}

/** Per emotion: pitch multiplies the speaker's base pitch. Average syllable ≈ 470 ms / speed. */
export const EMOTION_VOICE: Record<Emotion, Omit<Voice, 'lowpassHz'>> = {
  normal: { pitch: 1.0, speed: 6, randomness: 0.1, melodyRate: 0.05, melodyAmplitude: 0.1, gain: 0.55 },
  happy: { pitch: 1.2, speed: 7, randomness: 0.15, melodyRate: 0.15, melodyAmplitude: 0.3, gain: 0.55 },
  angry: { pitch: 0.85, speed: 9, randomness: 0.35, melodyRate: 0.02, melodyAmplitude: 0.05, gain: 0.75 },
  sad: { pitch: 0.72, speed: 4.5, randomness: 0.05, melodyRate: 0.03, melodyAmplitude: 0.2, gain: 0.4 },
};

/** The inner monologue: same voice, quieter, a little lower and muffled. */
export const WHISPER = { gain: 0.35, pitch: 0.92, lowpassHz: 1800 };

/** Fades so the sound ends right after the last typed letter, or at once on a skip. */
export const FADE_END_MS = 12;
export const FADE_SKIP_MS = 8;

const LOW_PITCH = 1.15;
const HIGH_PITCH = 1.85;

/** Each archetype gets its own base pitch; anyone else (a replacement) gets one from their id. */
export function basePitch(archetype: string | undefined, id: string): number {
  const index = looks.findIndex(look => look.archetype === archetype);
  const slot = index >= 0 ? index / (looks.length - 1)
    : ([...id].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) % 997, 7) % 100) / 99;
  return Math.round((LOW_PITCH + slot * (HIGH_PITCH - LOW_PITCH)) * 100) / 100;
}

export function voiceFor(base: number, emotion: Emotion, whisper = false): Voice {
  const v = EMOTION_VOICE[emotion];
  return whisper
    ? { ...v, pitch: base * v.pitch * WHISPER.pitch, gain: v.gain * WHISPER.gain, lowpassHz: WHISPER.lowpassHz }
    : { ...v, pitch: base * v.pitch };
}
