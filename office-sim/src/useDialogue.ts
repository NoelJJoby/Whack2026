// Drives the dialogue bar: new rounds from history, typing and auto timers, hold-for-dialogue and keys.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { TickFrame } from '../shared/api';
import { buildRound, current, idle, playerReducer, readingDelay, typeDelay } from './dialogueQueue';

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
  /** Pause (false) or resume (true) the simulation for Hold for dialogue. */
  setPlaying: (play: boolean) => void;
  /** Space: the existing pause/play toggle. */
  onSpace: () => void;
}

export function useDialogue({ history, paused, setPlaying, onSpace }: DialogueOptions) {
  const [state, dispatch] = useReducer(playerReducer, idle);
  const [auto, setAuto] = useState(true);
  const [showThoughts, setShowThoughts] = useState(true);
  const [hold, setHold] = useState(false);
  const reduced = useReducedMotion();
  const line = current(state);
  const held = useRef(false);
  const seen = useRef(history);
  const latest = useRef({ hold, auto, paused, setPlaying, onSpace });
  latest.current = { hold, auto, paused, setPlaying, onSpace };

  // Appended frames start a round. A replaced history (connect, reconnect, reset) never replays.
  useEffect(() => {
    const prev = seen.current;
    seen.current = history;
    if (history === prev) return;
    if (history.length !== prev.length + 1 || history.at(-2) !== prev.at(-1)) {
      dispatch({ type: 'clear' });
      held.current = false;
      return;
    }
    const lines = buildRound(history.at(-1)!, history.at(-2));
    dispatch({ type: 'round', lines });
    if (lines.length && latest.current.hold && !held.current) {
      held.current = true;
      latest.current.setPlaying(false);
    }
  }, [history]);

  const releaseHold = useCallback(() => { held.current = false; }, []);
  // Resume once this round and anything pending has played, or when the setting is turned off.
  useEffect(() => {
    if (held.current && (state.phase === 'idle' || !hold)) {
      held.current = false;
      latest.current.setPlaying(true);
    }
  }, [state.phase, hold]);

  const typingPhase = state.phase === 'public' || state.phase === 'inner';
  useEffect(() => {
    if (!line || paused || !typingPhase) return;
    if (reduced || (state.phase === 'inner' && !showThoughts)) { dispatch({ type: 'complete' }); return; }
    const text = state.phase === 'public' ? line.publicLine : line.inner;
    const shown = state.phase === 'public' ? state.shownPublic : state.shownInner;
    const timer = setTimeout(() => dispatch({ type: 'type', showThoughts }), typeDelay(text, shown));
    return () => clearTimeout(timer);
  }, [line, typingPhase, state.phase, state.shownPublic, state.shownInner, paused, reduced, showThoughts]);

  // Auto's reading delay starts only once typing has finished.
  useEffect(() => {
    if (!line || !auto || paused || state.phase !== 'reading') return;
    const timer = setTimeout(() => dispatch({ type: 'auto' }), readingDelay(line, showThoughts));
    return () => clearTimeout(timer);
  }, [line, auto, paused, state.phase, showThoughts]);

  const next = useCallback(() => dispatch({ type: 'next', auto: latest.current.auto }), []);
  const skip = useCallback(() => dispatch({ type: 'skip' }), []);

  // Space pause/play, Enter or N next, S skip round, A auto. Ignored while typing, with modifiers, or under a menu.
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
      }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space' && !ignored(e)) e.preventDefault(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [next, skip]);

  return { state, line, auto, setAuto, showThoughts, setShowThoughts, hold, setHold, next, skip, releaseHold };
}
