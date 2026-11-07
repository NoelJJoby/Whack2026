// Web Audio side of the babble. The only module that imports animalese-tts.
import { AnimaleseEngine, EnglishAnalyzer, PitchManager, WebSampler } from 'animalese-tts';
import sprites from './english-sprite.json';
import { alignToText, BabbleScheduler } from './schedule';
import type { Voice } from './voices';

const SPRITE_URL = '/sounds/animalese-english.wav';

export interface Blip { buffer: AudioBuffer; gain: number; lowpassHz?: number }

let sampler: WebSampler | null = null;
let loading: Promise<void> | null = null;
const engines = new Map<string, AnimaleseEngine>();

function load() {
  if (!loading) {
    sampler = new WebSampler(SPRITE_URL, sprites);
    loading = sampler.load().catch(error => { loading = null; throw error; });
  }
  return loading;
}

/** Fetches and slices the sprite early, so the first line already has a voice. */
export function preload() {
  load().catch(() => { /* Retried on the next line. */ });
}

function engineFor(voice: Voice) {
  const { pitch, speed, randomness, melodyRate, melodyAmplitude } = voice;
  const key = [pitch, speed, randomness, melodyRate, melodyAmplitude].join();
  let engine = engines.get(key);
  if (!engine) {
    // Typing sets the pace, so the library's own space and punctuation pauses are off.
    engine = new AnimaleseEngine({
      analyzer: new EnglishAnalyzer(), sampler: sampler!, spaceDelay: 0, punctuationDelay: 0,
      effect: new PitchManager({ pitch, speed, randomness, melodyRate, melodyAmplitude }),
    });
    engines.set(key, engine);
  }
  return engine;
}

/** Synthesises a line and returns the sound for each voiced letter, keyed by text position. */
export async function prepare(text: string, voice: Voice): Promise<Map<number, Blip>> {
  await load();
  const outputs = [];
  for await (const output of engineFor(voice).synthesize(text).speak()) outputs.push(output);
  const sampleRate = sampler!.sampleRate ?? 48000;
  const blips = new Map<number, Blip>();
  for (const [index, output] of alignToText(text, outputs)) {
    const data = output.buffer instanceof Float32Array ? new Float32Array(output.buffer) : Float32Array.from(output.buffer, v => v / 32768);
    const buffer = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate });
    buffer.copyToChannel(data, 0);
    blips.set(index, { buffer, gain: voice.gain, lowpassHz: voice.lowpassHz });
  }
  return blips;
}

let context: AudioContext | null = null;
let current: { source: AudioBufferSourceNode; gain: GainNode } | null = null;

function audio() {
  context ??= new AudioContext();
  return context;
}

/** Browsers keep audio suspended until a click or key press. */
export function unlockOnGesture() {
  const unlock = () => { if (audio().state === 'suspended') void audio().resume(); };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
  return () => {
    window.removeEventListener('pointerdown', unlock, { capture: true });
    window.removeEventListener('keydown', unlock, { capture: true });
  };
}

function start(blip: Blip): number {
  const ctx = audio();
  const source = new AudioBufferSourceNode(ctx, { buffer: blip.buffer });
  const gain = new GainNode(ctx, { gain: blip.gain });
  if (blip.lowpassHz) source.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: blip.lowpassHz })).connect(gain);
  else source.connect(gain);
  gain.connect(ctx.destination);
  const playing = { source, gain };
  source.onended = () => { if (current === playing) current = null; };
  current = playing;
  source.start();
  return blip.buffer.duration;
}

function halt(fadeMs: number) {
  if (!current || !context) return;
  const { source, gain } = current;
  current = null;
  const t = context.currentTime;
  const end = t + fadeMs / 1000;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0, end);
  source.stop(end);
}

export const babble = new BabbleScheduler<Blip>(() => audio().currentTime, start, halt);
