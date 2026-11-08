// The dialogue bar's round queue and playback state. Pure: no React, no timers.
import { DEFAULT_PARAMS } from '../server/params';
import type { TickEvent, TickFrame } from '../shared/api';
import { playerText } from './hudModel';
import type { Action } from '../shared/types';
import { emotionFor, type Emotion } from './voice/emotion';

/** Lines shown per round; the rest stay in the Office wire only. */
export const DIALOGUE_CAP = DEFAULT_PARAMS.playback.dialogueCap;
/** Typing speed. A 30-word line (~170 characters) types in about 2.5 seconds. */
export const CHARS_PER_SECOND = DEFAULT_PARAMS.playback.charsPerSecond;
/** Extra pause after these characters while typing. */
export const PUNCTUATION_PAUSE_MS = DEFAULT_PARAMS.playback.punctuationPauseMs;
/** Auto mode's reading delay, counted from the end of typing. */
export const AUTO_BASE_MS = DEFAULT_PARAMS.playback.autoBaseMs;
export const AUTO_PER_WORD_MS = DEFAULT_PARAMS.playback.autoPerWordMs;
/** A stress change this large ranks above an ordinary line. */
export const STRESS_JUMP = DEFAULT_PARAMS.playback.stressJump;

export interface DialogueLine {
  kind: 'agent' | 'narrator';
  announcement?: TickEvent;
  report?: boolean;
  calendarDay?: number;
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
      kind: 'agent' as const, key: `${frame.tick}-${record.agent}`, tick: frame.tick, agent: record.agent, publicLine,
      inner: playerText(record.inner_monologue?.trim() ?? ''), quit: Boolean(record.quit), action: record.action, emotion, tier, stress, stressDelta,
    } }];
  });
  const agents = lines
    .sort((a, b) => a.line.tier - b.line.tier
      || Math.abs(b.line.stressDelta) - Math.abs(a.line.stressDelta) || a.order - b.order)
    .slice(0, DIALOGUE_CAP)
    .map(entry => entry.line);
  const narrator = (text: string, key: string, extra: Partial<DialogueLine> = {}): DialogueLine => ({
    kind: 'narrator', key: `${frame.tick}-${key}`, tick: frame.tick, agent: '', publicLine: playerText(text), inner: '', quit: false,
    action: 'work', emotion: 'normal', tier: 0, stress: 0, stressDelta: 0, ...extra,
  });
  return [
    ...frame.events.map((event, i) => narrator(event.text, `announcement-${i}`, { announcement: event })),
    ...agents,
    ...(frame.day_report ? [
      ...frame.day_report.lines.map((text, i) => narrator(i === 0 ? `Day ${frame.day_report!.day} report. ${text}` : text, `report-${i}`, { report: true })),
      ...frame.day_report.fillerDays.map(day => narrator(`Day ${day}: a routine day; nothing happened.`, `filler-${day}`, { report: true, calendarDay: day })),
    ] : []),
  ];
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
  tick: number | null;
}
export type PlayerAction =
  | { type: 'round'; lines: DialogueLine[]; tick?: number }
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

export const idle: PlayerState = { round: [], index: 0, phase: 'idle', shownPublic: 0, shownInner: 0, tick: null };

const start = (lines: DialogueLine[], tick: number | null): PlayerState => ({ ...idle, round: lines, tick, phase: lines.length ? 'public' : 'idle' });
const finish = (state: PlayerState): PlayerState => ({ ...state, index: state.round.length, phase: 'idle', shownPublic: 0, shownInner: 0 });
function advance(state: PlayerState): PlayerState {
  if (state.index + 1 < state.round.length) return { ...state, index: state.index + 1, phase: 'public', shownPublic: 0, shownInner: 0 };
  return finish(state);
}

export function current(state: PlayerState): DialogueLine | null {
  return state.phase === 'idle' ? null : state.round[state.index] ?? null;
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  const line = current(state);
  switch (action.type) {
    case 'clear': return idle;
    case 'round':
      return start(action.lines, action.tick ?? action.lines[0]?.tick ?? null);
    case 'skip': return finish(state);
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
      if (state.phase === 'idle') return state;
      if (state.phase !== 'reading') return playerReducer(state, { type: 'complete' });
      return advance(state);
    case 'auto': return state.phase === 'reading' ? advance(state) : state;
  }
}
