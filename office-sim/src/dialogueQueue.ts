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

export type Phase = 'idle' | 'public' | 'inner' | 'reading';
export interface PlayerState {
  round: DialogueLine[];
  index: number;
  phase: Phase;
  shownPublic: number;
  shownInner: number;
  /** The newest round that arrived while this one was still playing. */
  pending: DialogueLine[] | null;
}
export type PlayerAction =
  | { type: 'round'; lines: DialogueLine[] }
  /** Reveal one more character. */
  | { type: 'type'; showThoughts: boolean }
  /** Finish the current line's typing at once. */
  | { type: 'complete' }
  /** Next: complete typing, otherwise advance. */
  | { type: 'next'; auto: boolean }
  /** Auto's reading delay elapsed. */
  | { type: 'auto' }
  | { type: 'skip' }
  | { type: 'clear' };

export const idle: PlayerState = { round: [], index: 0, phase: 'idle', shownPublic: 0, shownInner: 0, pending: null };

const start = (lines: DialogueLine[] | null): PlayerState => lines?.length
  ? { round: lines, index: 0, phase: 'public', shownPublic: 0, shownInner: 0, pending: null } : idle;

function advance(state: PlayerState, auto: boolean): PlayerState {
  // Auto on: a newer round replaces the rest of this one. Auto off: it waits for the end.
  if (state.pending && auto) return start(state.pending);
  if (state.index + 1 < state.round.length) return { ...state, index: state.index + 1, phase: 'public', shownPublic: 0, shownInner: 0 };
  return start(state.pending);
}

export function current(state: PlayerState): DialogueLine | null {
  return state.phase === 'idle' ? null : state.round[state.index] ?? null;
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  const line = current(state);
  switch (action.type) {
    case 'clear': return idle;
    case 'round':
      if (!action.lines.length) return state;
      return state.phase === 'idle' ? start(action.lines) : { ...state, pending: action.lines };
    case 'skip': return start(state.pending);
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
      if (state.phase === 'idle') return start(state.pending);
      if (state.phase !== 'reading') return playerReducer(state, { type: 'complete' });
      return advance(state, action.auto);
    case 'auto': return state.phase === 'reading' ? advance(state, true) : state;
  }
}
