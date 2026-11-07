// Plays babble in step with the dialogue typewriter. Never touches the reducer.
import { useEffect, useRef } from 'react';
import type { DialogueLine, PlayerState } from '../dialogueQueue';
import { babble, preload, prepare, unlockOnGesture, type Blip } from './babble';
import { FADE_END_MS, FADE_SKIP_MS, basePitch, voiceFor } from './voices';
import { babbleStep } from './schedule';

export interface BabbleOptions {
  state: PlayerState;
  line: DialogueLine | null;
  /** Voices on, motion allowed, no menu over the office. */
  active: boolean;
  showThoughts: boolean;
  archetypeOf: (id: string) => string | undefined;
}

export function useBabble({ state, line, active, showThoughts, archetypeOf }: BabbleOptions) {
  const blips = useRef<{ key: string; public: Map<number, Blip>; inner: Map<number, Blip> } | null>(null);
  const last = useRef({ phase: state.phase, shownPublic: state.shownPublic, shownInner: state.shownInner });
  const archetype = useRef(archetypeOf);
  archetype.current = archetypeOf;

  useEffect(unlockOnGesture, []);
  useEffect(() => { if (active) preload(); }, [active]);
  useEffect(() => () => babble.stop(FADE_SKIP_MS), []);

  // Synthesise each line once when it starts. Letters typed before it is ready stay silent.
  const key = active ? line?.key : undefined;
  useEffect(() => {
    babble.stop(FADE_SKIP_MS);
    blips.current = null;
    if (!line || key === undefined) return;
    let current = true;
    const base = basePitch(archetype.current(line.agent), line.agent);
    void Promise.all([
      prepare(line.publicLine, voiceFor(base, line.emotion)),
      line.inner ? prepare(line.inner, voiceFor(base, line.emotion, true)) : new Map<number, Blip>(),
    ]).then(([publicBlips, innerBlips]) => {
      if (current) blips.current = { key, public: publicBlips, inner: innerBlips };
    }).catch(() => { /* No voice for this line; typing carries on silently. */ });
    return () => { current = false; };
  }, [key]);

  useEffect(() => {
    const prev = last.current;
    last.current = { phase: state.phase, shownPublic: state.shownPublic, shownInner: state.shownInner };
    if (!active) { babble.stop(FADE_SKIP_MS); return; }
    const sounds = blips.current?.key === line?.key ? blips.current : null;
    const step = babbleStep(prev, last.current);
    if (step?.kind === 'blip') {
      if (step.part === 'public') babble.blip(sounds?.public.get(step.index));
      else if (showThoughts) babble.blip(sounds?.inner.get(step.index));
    } else if (step) {
      babble.stop(step.reason === 'finished' ? FADE_END_MS : FADE_SKIP_MS);
    }
  }, [state.phase, state.shownPublic, state.shownInner, line, active, showThoughts]);
}
