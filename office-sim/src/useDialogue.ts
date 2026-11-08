// Plays only the presented hour. Completing its round releases the presentation cursor.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { DEFAULT_PARAMS } from '../server/params';
import type { TickFrame } from '../shared/api';
import { FAST_TICK_MS, isFastForward } from '../shared/playback';
import { buildRound, current, idle, playerReducer, readingDelay, typeDelay } from './dialogueQueue';
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
  frame?: TickFrame;
  previous?: TickFrame;
  playing: boolean;
  epoch: number;
  speed: number;
  onDone: (tick: number) => void;
  /** A modal menu is open: the bar is hidden, so typing, auto and keys wait. */
  paused: boolean;
  blocked?: boolean;
  /** Space: the existing pause/play toggle. */
  onSpace: () => void;
  /** The speaker's archetype, which sets their voice's base pitch. */
  archetypeOf: (id: string) => string | undefined;
}

export function useDialogue({ frame, previous, playing, epoch, speed, onDone, paused, blocked, onSpace, archetypeOf }: DialogueOptions) {
  const [state, dispatch] = useReducer(playerReducer, idle);
  const [auto, setAuto] = useState(true);
  const [showThoughts, setShowThoughts] = useState(true);
  const [voices, setVoices] = useState(true);
  const reduced = useReducedMotion();
  const fastForward = isFastForward(speed);
  const line = current(state);
  const latest = useRef({ auto, paused, blocked, onSpace, onDone });
  latest.current = { auto, paused, blocked, onSpace, onDone };

  useEffect(() => {
    if (!playing || !frame) { dispatch({ type: 'clear' }); return; }
    const lines = buildRound(frame, previous);
    dispatch({ type: 'round', lines: fastForward ? lines.slice(0, 1) : lines, tick: frame.tick });
  }, [frame, playing, epoch, fastForward]);

  // A brief fully revealed highlight replaces the long dialogue queue in fast-forward.
  // The full round remains in the committed history and Office wire.
  useEffect(() => {
    if (!fastForward || !playing || !frame || paused) return;
    const timer = setTimeout(() => {
      dispatch({ type: 'skip' });
      latest.current.onDone(frame.tick);
    }, FAST_TICK_MS);
    return () => clearTimeout(timer);
  }, [fastForward, playing, frame, paused]);

  useEffect(() => {
    if (fastForward || !playing || !frame || paused || state.tick !== frame.tick || state.phase !== 'idle') return;
    const delay = state.round.length ? 0 : DEFAULT_PARAMS.playback.quietDwellMs / speed;
    const timer = setTimeout(() => latest.current.onDone(frame.tick), delay);
    return () => clearTimeout(timer);
  }, [frame, playing, paused, state.tick, state.phase, state.round.length, speed, fastForward]);

  const typingPhase = state.phase === 'public' || state.phase === 'inner';
  useEffect(() => {
    if (!line || paused || !typingPhase) return;
    if (fastForward || reduced || (state.phase === 'inner' && !showThoughts)) { dispatch({ type: 'complete' }); return; }
    const text = state.phase === 'public' ? line.publicLine : line.inner;
    const shown = state.phase === 'public' ? state.shownPublic : state.shownInner;
    const timer = setTimeout(() => dispatch({ type: 'type', showThoughts }), typeDelay(text, shown) / speed);
    return () => clearTimeout(timer);
  }, [line, typingPhase, state.phase, state.shownPublic, state.shownInner, paused, reduced, showThoughts, speed, fastForward]);

  // Auto's reading delay starts only once typing has finished.
  useEffect(() => {
    if (fastForward || !line || !auto || paused || state.phase !== 'reading') return;
    const timer = setTimeout(() => dispatch({ type: 'auto' }), readingDelay(line, showThoughts) / speed);
    return () => clearTimeout(timer);
  }, [line, auto, paused, state.phase, showThoughts, speed, fastForward]);

  useBabble({ state, line, active: voices && line?.kind === 'agent' && !reduced && !paused && !fastForward, showThoughts, archetypeOf });

  const next = useCallback(() => dispatch({ type: 'next', auto: latest.current.auto }), []);
  const skip = useCallback(() => dispatch({ type: 'skip' }), []);

  // Space pause/play, Enter or N next, S skip round, A auto, M voices. Ignored while typing, with modifiers, or under a menu.
  useEffect(() => {
    const ignored = (e: KeyboardEvent) => e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || latest.current.blocked;
    const down = (e: KeyboardEvent) => {
      if (ignored(e) || latest.current.paused && e.code !== 'Space') return;
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

  return { state, line, auto, setAuto, showThoughts, setShowThoughts, voices, setVoices, next, skip };
}
