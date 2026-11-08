// Part B: the CEO is the single source of truth. Official events (params.events[type].official) are
// announced by the CEO on the open floor and are always true. Only agents on the floor that hour hear
// it first-hand; everyone else learns it later through the normal gossip spread (with its trust and hops).
// Unofficial items (scandal, layoff rumours, poaching) keep entering through the grapevine, never the CEO.
import type { Action, QueuedEvent, World } from './engine-types';
import type { Params } from './params';
import { isPresent } from './presence';

/** ENABLE_ANNOUNCEMENTS=false restores the previous behaviour (official news reaches everyone at once). */
export const ANNOUNCEMENTS = process.env.ENABLE_ANNOUNCEMENTS !== 'false';

export interface Announcement { tick: number; type: QueuedEvent['type']; firstHand: string[] }
type AnnouncementWorld = World & { lastActions?: Record<string, Action>; announcements?: Announcement[] };

/** Last hour's actions that put someone away from the open floor (lounge, visiting a colleague, outside, at a window). */
const OFF_FLOOR: readonly Action[] = ['slack_off', 'interview', 'complain', 'gossip', 'verify', 'support_colleague', 'leak'];

export function ceoOf(w: World): string | undefined {
  return Object.values(w.business?.positions ?? {}).find(p => p.role === 'ceo')?.id;
}

/** Who is on the open floor to hear the CEO this hour. */
export function floorListeners(w: World): string[] {
  const last = (w as AnnouncementWorld).lastActions ?? {};
  const ceo = ceoOf(w);
  return w.ids.filter(id => id !== ceo && isPresent(w, id) && !OFF_FLOOR.includes(last[id] as Action));
}

/** Turn this hour's true official events into CEO announcements, heard first-hand by the floor only. */
export function prepareAnnouncements(w: World, pending: QueuedEvent[], p: Params): QueuedEvent[] {
  const aw = w as AnnouncementWorld;
  if (!ANNOUNCEMENTS || !ceoOf(w) || !isPresent(w, ceoOf(w)!)) return pending;
  return pending.map(ev => {
    // A player can inject a false 'official' item; the CEO never announces anything untrue, so it keeps its old path.
    if (ev.templateId || !p.events[ev.type]?.official || (ev.isTrue ?? p.events[ev.type].isTrue) === false) return ev;
    const firstHand = floorListeners(w);
    (aw.announcements ??= []).push({ tick: w.tick, type: ev.type, firstHand });
    return { ...ev, isTrue: true, hearers: firstHand, firstHand: true };
  });
}

export function announcementsAt(w: World, tick: number): Announcement[] {
  return ((w as AnnouncementWorld).announcements ?? []).filter(a => a.tick === tick);
}

/** Remember where people were (by action) for the next hour's announcement. */
export function rememberActions(w: World, decisions: Record<string, { action: Action } | undefined>): void {
  (w as AnnouncementWorld).lastActions = Object.fromEntries(Object.entries(decisions).flatMap(([id, d]) => (d ? [[id, d.action]] : [])));
}
