import { DEFAULT_PARAMS } from '../server/params';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TickFrame } from '../shared/api';
import type { SimulationState } from '../shared/types';
import { finishPresentation, initialPresentation, reconcilePresentation } from './presentation';

export function usePresentation(history: TickFrame[], epoch: number, live: SimulationState | null, acknowledge: (tick: number) => Promise<boolean>, paused: boolean, fastForward = false) {
  const [cursor, setCursor] = useState(initialPresentation);
  useEffect(() => {
    setCursor(p => paused && p.epoch === epoch ? p : reconcilePresentation(p, history, epoch, live, fastForward));
  }, [history, epoch, live, cursor.active, paused, fastForward]);
  const frame = history.find(f => f.tick === cursor.tick);
  const previous = history.find(f => f.tick === cursor.tick - 1);
  const visibleHistory = useMemo(() => history.filter(f => f.tick <= cursor.tick), [history, cursor.tick]);
  const done = useCallback((tick: number) => setCursor(p => finishPresentation(p, tick)), []);
  // Acknowledgements don't apply their live HTTP snapshot to visible state.
  useEffect(() => {
    if (cursor.epoch !== epoch || !cursor.baseline) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const send = async () => {
      const ok = await acknowledge(cursor.tick);
      if (!ok && !cancelled) timer = setTimeout(send, DEFAULT_PARAMS.playback.ackRetryMs);
    };
    void send();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [cursor.tick, cursor.epoch, epoch, Boolean(cursor.baseline), acknowledge]);
  return { frame, previous, history: visibleHistory, state: frame?.state ?? cursor.baseline ?? live, playing: cursor.active, done, tick: cursor.tick, epoch: cursor.epoch };
}
