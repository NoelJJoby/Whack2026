// Drives the dialogue bar: new rounds from history, typing and auto timers, hold-for-dialogue and keys.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { TickFrame } from '../shared/api';
import { buildRound, current, idle, playbackDelay, playerReducer, readingDelay, typeDelay } from './dialogueQueue';
import { useBabble } from './voice/useBabble';

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
/** Enter already activates these natively. */
const activatable = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest('button, a[href], summary, [role="button"]'));

function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const list = matchMedia(query);
    const change = () => setReduced(list.matches);
    list.addEventListener('change', change);
    return () => list.removeEventListener('change', change);
  }, []);
  return reduced;
}

export interface DialogueOptions {
  history: TickFrame[];
  /** A modal menu is open: the bar is hidden, so typing, auto and keys wait. */
  paused: boolean;
  /** Backend playback state. A manual simulation pause freezes dialogue too. */
  running: boolean;
  /** Dialogue timers use the same playback multiplier as simulation ticks. */
  speed: number;
  /** Pause (false) or resume (true) the simulation for Hold for dialogue. Returns whether it acted. */
  setPlaying: (play: boolean) => boolean;
  /** Space: the existing pause/play toggle. */
  onSpace: () => void;
  /** The speaker's archetype, which sets their voice's base pitch. */
  archetypeOf: (id: string) => string | undefined;
}

export function useDialogue({ history, paused, running, speed, setPlaying, onSpace, archetypeOf }: DialogueOptions) {
  // A first history/reconnect resumes at its newest completed tick without replaying old dialogue.
  const [state, dispatch] = useReducer(playerReducer, history, frames => ({ ...idle, presentedTick: frames.at(-1)?.tick ?? 0 }));
  const [auto, setAuto] = useState(true);
  const [showThoughts, setShowThoughts] = useState(true);
  const [hold, setHold] = useState(false);
  const [voices, setVoices] = useState(true);
  const [holding, setHolding] = useState(false);
  const reduced = useReducedMotion();
  const line = current(state);
  const held = useRef(false);
  const seen = useRef(history);
  const latest = useRef({ hold, auto, paused, setPlaying, onSpace });
  latest.current = { hold, auto, paused, setPlaying, onSpace };

  // Only appended, ordered frames enter presentation. History replacement resumes at its newest tick.
  useEffect(() => {
    const prev = seen.current;
    seen.current = history;
    if (history === prev) return;
    const appended = history.length >= prev.length && prev.every((frame, index) => history[index]?.tick === frame.tick);
    if (!appended) {
      dispatch(history.length ? { type: 'resume', tick: history.at(-1)!.tick } : { type: 'clear', tick: 0 });
      held.current = false;
      setHolding(false);
      return;
    }
    for (let index = prev.length; index < history.length; index++) {
      const frame = history[index];
      const lines = buildRound(frame, history[index - 1]);
      dispatch({ type: 'round', tick: frame.tick, lines });
      if (lines.length && latest.current.hold && !held.current) {
        held.current = latest.current.setPlaying(false);
        setHolding(held.current);
      }
    }
  }, [history]);

  const releaseHold = useCallback(() => { held.current = false; setHolding(false); }, []);
  // Resume once this round and anything pending has played, or when the setting is turned off.
  useEffect(() => {
    if (held.current && (state.phase === 'idle' || !hold)) {
      held.current = false;
      setHolding(false);
      latest.current.setPlaying(true);
    }
  }, [state.phase, hold]);

  const presentationPaused = paused || (!running && !holding);
  const typingPhase = state.phase === 'public' || state.phase === 'inner';
  useEffect(() => {
    if (!line || presentationPaused || !typingPhase) return;
    if (reduced || (state.phase === 'inner' && !showThoughts)) { dispatch({ type: 'complete' }); return; }
    const text = state.phase === 'public' ? line.publicLine : line.inner;
    const shown = state.phase === 'public' ? state.shownPublic : state.shownInner;
    const timer = setTimeout(() => dispatch({ type: 'type', showThoughts }), playbackDelay(typeDelay(text, shown), speed));
    return () => clearTimeout(timer);
  }, [line, typingPhase, state.phase, state.shownPublic, state.shownInner, presentationPaused, reduced, showThoughts, speed]);

  // Auto's reading delay starts only once typing has finished.
  useEffect(() => {
    if (!line || !auto || presentationPaused || state.phase !== 'reading') return;
    const timer = setTimeout(() => dispatch({ type: 'auto' }), playbackDelay(readingDelay(line, showThoughts), speed));
    return () => clearTimeout(timer);
  }, [line, auto, presentationPaused, state.phase, showThoughts, speed]);

  useBabble({ state, line, active: voices && !reduced && !presentationPaused, showThoughts, archetypeOf });

  const next = useCallback(() => dispatch({ type: 'next', auto: latest.current.auto }), []);
  const skip = useCallback(() => dispatch({ type: 'skip' }), []);

  // Space pause/play, Enter or N next, S skip round, A auto, M voices. Ignored while typing, with modifiers, or under a menu.
  useEffect(() => {
    const ignored = (e: KeyboardEvent) => e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || latest.current.paused;
    const down = (e: KeyboardEvent) => {
      if (ignored(e)) return;
      if (e.code === 'Space') {
        // Stop a focused button from also being clicked.
        e.preventDefault();
        if (!e.repeat) latest.current.onSpace();
      } else if (e.repeat) {
        return;
      } else if (e.code === 'KeyN' || (e.key === 'Enter' && !activatable(e.target))) {
        e.preventDefault();
        next();
      } else if (e.code === 'KeyS') {
        skip();
      } else if (e.code === 'KeyA') {
        setAuto(value => !value);
      } else if (e.code === 'KeyM') {
        setVoices(value => !value);
      }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space' && !ignored(e)) e.preventDefault(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [next, skip]);

  return { state, line, presentedTick: state.presentedTick, waitingRounds: state.queued.length, auto, setAuto, showThoughts, setShowThoughts, hold, setHold, voices, setVoices, next, skip, releaseHold };
}
