// The dialogue bar's round queue and playback state. Pure: no React, no timers.
import type { TickFrame } from '../shared/api';
import { playerText } from './hudModel';
import type { Action } from '../shared/types';
import { emotionFor, type Emotion } from './voice/emotion';

/** Lines shown per round; the rest stay in the Office wire only. */
export const DIALOGUE_CAP = 5;
/** Typing speed. A 30-word line (~170 characters) types in about 2.5 seconds. */
export const CHARS_PER_SECOND = 70;
/** Extra pause after these characters while typing. */
export const PUNCTUATION_PAUSE_MS = 100;
/** Auto mode's reading delay, counted from the end of typing. */
export const AUTO_BASE_MS = 1500;
export const AUTO_PER_WORD_MS = 250;
/** Maximum future rounds kept for dialogue before their lines remain in the Office wire only. */
export const MAX_WAITING_ROUNDS = 2;
/** A stress change this large ranks above an ordinary line. */
export const STRESS_JUMP = 10;

export interface DialogueLine {
  key: string;
  tick: number;
  agent: string;
  publicLine: string;
  inner: string;
  quit: boolean;
  action: Action;
  emotion: Emotion;
  /** 1 plays first: quit, leak, event reaction, gossip, stress jump, other. */
  tier: number;
  stress: number;
  stressDelta: number;
}

/** This round's lines, most dramatic first, capped at DIALOGUE_CAP. */
export function buildRound(frame: TickFrame, prev?: TickFrame): DialogueLine[] {
  const lines = frame.records.flatMap((record, order) => {
    const publicLine = playerText(record.public_line?.trim() ?? '');
    if (!publicLine) return [];
    const stress = frame.state.agents[record.agent]?.stress ?? record.state?.stress ?? 0;
    const stressDelta = stress - (prev?.state.agents[record.agent]?.stress ?? stress);
    const agent = frame.state.agents[record.agent] ?? record.state;
    const emotion = emotionFor({
      quit: Boolean(record.quit), action: record.action, stress, stressDelta,
      burnout: agent?.burnout ?? 0, trust: agent?.trust_mgmt ?? 50, events: frame.events.map(e => e.type),
    });
    const tier = record.quit ? 1 : record.action === 'leak' ? 2 : frame.events.length ? 3
      : record.action === 'gossip' ? 4 : Math.abs(stressDelta) >= STRESS_JUMP ? 5 : 6;
    return [{ order, line: {
      key: `${frame.tick}-${record.agent}`, tick: frame.tick, agent: record.agent, publicLine,
      inner: playerText(record.inner_monologue?.trim() ?? ''), quit: Boolean(record.quit), action: record.action, emotion, tier, stress, stressDelta,
    } }];
  });
  return lines
    .sort((a, b) => a.line.tier - b.line.tier
      || Math.abs(b.line.stressDelta) - Math.abs(a.line.stressDelta) || a.order - b.order)
    .slice(0, DIALOGUE_CAP)
    .map(entry => entry.line);
}

/** Delay before revealing the character after `shown` characters are visible. */
export function typeDelay(text: string, shown: number): number {
  return 1000 / CHARS_PER_SECOND + (/[.,!?;:]/.test(text[shown - 1] ?? '') ? PUNCTUATION_PAUSE_MS : 0);
}

export function readingDelay(line: DialogueLine, showThoughts: boolean): number {
  const text = showThoughts && line.inner ? `${line.publicLine} ${line.inner}` : line.publicLine;
  return AUTO_BASE_MS + AUTO_PER_WORD_MS * text.split(/\s+/).filter(Boolean).length;
}

/** Presentation uses the simulation's selected speed for every dialogue timer. */
export const playbackDelay = (delay: number, speed: number) => delay / speed;

export type Phase = 'idle' | 'public' | 'inner' | 'reading';
export interface PlayerState {
  round: DialogueLine[];
  /** Tick currently presented by the HUD, office scene and dialogue. */
  presentedTick: number;
  index: number;
  phase: Phase;
  shownPublic: number;
  shownInner: number;
  /** The next round waiting to be presented (kept for the dialogue bar badge). */
  pending: DialogueLine[] | null;
  /** Ordered future rounds. Unlike the old pending slot, none are overwritten. */
  queued: Array<{ tick: number; lines: DialogueLine[] }>;
  /** Rounds removed from dialogue during catch-up; their records remain in the Office wire. */
  skippedTicks: number[];
}
export type PlayerAction =
  | { type: 'round'; tick?: number; lines: DialogueLine[] }
  /** Reveal one more character. */
  | { type: 'type'; showThoughts: boolean }
  /** Finish the current line's typing at once. */
  | { type: 'complete' }
  /** Next: complete typing, otherwise advance. */
  | { type: 'next'; auto: boolean }
  /** Auto's reading delay elapsed. */
  | { type: 'auto' }
  | { type: 'skip' }
  /** Resume a reconnect/history replacement at its newest completed frame. */
  | { type: 'resume'; tick: number }
  | { type: 'clear'; tick?: number };

export const idle: PlayerState = { round: [], presentedTick: 0, index: 0, phase: 'idle', shownPublic: 0, shownInner: 0, pending: null, queued: [], skippedTicks: [] };

const withPending = (state: Omit<PlayerState, 'pending'>): PlayerState => ({ ...state, pending: state.queued[0]?.lines ?? null });

/** Starts the first queued speaking round; empty rounds advance the presentation clock immediately. */
function startNext(state: PlayerState): PlayerState {
  let queued = state.queued;
  let presentedTick = state.presentedTick;
  while (queued.length) {
    const [next, ...rest] = queued;
    queued = rest;
    presentedTick = Math.max(presentedTick, next.tick);
    if (next.lines.length) {
      return withPending({ ...state, round: next.lines, presentedTick, index: 0, phase: 'public', shownPublic: 0, shownInner: 0, queued });
    }
  }
  return withPending({ ...state, round: [], presentedTick, index: 0, phase: 'idle', shownPublic: 0, shownInner: 0, queued });
}

function advance(state: PlayerState): PlayerState {
  if (state.index + 1 < state.round.length) return { ...state, index: state.index + 1, phase: 'public', shownPublic: 0, shownInner: 0 };
  return startNext(state);
}

export function current(state: PlayerState): DialogueLine | null {
  return state.phase === 'idle' ? null : state.round[state.index] ?? null;
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  const line = current(state);
  switch (action.type) {
    case 'clear': return action.tick ? { ...idle, presentedTick: action.tick } : idle;
    case 'resume': return { ...idle, presentedTick: Math.max(state.presentedTick, action.tick) };
    case 'round': {
      const tick = action.tick ?? action.lines[0]?.tick ?? state.presentedTick;
      if (tick <= state.presentedTick || state.queued.some(round => round.tick === tick)) return state;
      const queued = [...state.queued, { tick, lines: action.lines }].sort((a, b) => a.tick - b.tick);
      const skippedTicks = [...state.skippedTicks];
      while (queued.length > MAX_WAITING_ROUNDS) skippedTicks.push(queued.shift()!.tick);
      const next = withPending({ ...state, queued, skippedTicks });
      return next.phase === 'idle' ? startNext(next) : next;
    }
    case 'skip': return startNext(state);
    case 'type':
      if (!line) return state;
      if (state.phase === 'public') {
        const shownPublic = state.shownPublic + 1;
        if (shownPublic < line.publicLine.length) return { ...state, shownPublic };
        return { ...state, shownPublic, phase: action.showThoughts && line.inner ? 'inner' : 'reading' };
      }
      if (state.phase === 'inner') {
        const shownInner = state.shownInner + 1;
        return { ...state, shownInner, phase: shownInner < line.inner.length ? 'inner' : 'reading' };
      }
      return state;
    case 'complete':
      if (!line || state.phase === 'reading') return state;
      return { ...state, phase: 'reading', shownPublic: line.publicLine.length, shownInner: line.inner.length };
    case 'next':
      if (state.phase === 'idle') return startNext(state);
      if (state.phase !== 'reading') return playerReducer(state, { type: 'complete' });
      return advance(state);
    case 'auto': return state.phase === 'reading' ? advance(state) : state;
  }
}
