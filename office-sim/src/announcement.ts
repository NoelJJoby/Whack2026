import type { TickEvent } from '../shared/api';
export interface Announcement { id: number; event: TickEvent }
/** Wall-clock timer, independent of playback. History is deliberately never passed here. */
export function createAnnouncements(
  publish: (value: Announcement | null) => void,
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  const clear = () => { if (timer !== undefined) cancel(timer); timer = undefined; publish(null); };
  return {
    clear,
    receive(events: TickEvent[]) {
      if (!events.length) return;
      clear();
      publish({ id: ++sequence, event: events[events.length - 1] });
      timer = schedule(clear, 10_000);
    },
    dispose() { if (timer !== undefined) cancel(timer); timer = undefined; },
  };
}
