import type { TickEvent } from '../shared/api';
export interface Announcement { id: number; event: TickEvent }
/** New arrivals queue in order. Reconnected history never enters this queue. */
export function createAnnouncements(
  publish: (value: Announcement | null) => void,
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0; let active = false;
  const pending: TickEvent[] = [];
  const stopTimer = () => { if (timer !== undefined) cancel(timer); timer = undefined; };
  const next = () => {
    stopTimer(); const event = pending.shift(); active = !!event;
    publish(event ? { id: ++sequence,event } : null);
    if (event) timer = schedule(next,10_000);
  };
  const clear = () => { pending.length = 0; active = false; stopTimer(); publish(null); };
  return {
    clear, dismiss: next,
    receive(events: TickEvent[]) { pending.push(...events); if (!active && pending.length) next(); },
    dispose() { pending.length = 0; active = false; stopTimer(); },
  };
}
