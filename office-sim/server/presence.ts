// Who is in the office. Everyone is in from 09:00. At 17:00, and again after
// each evening hour, people stay only if they are working hard (overwork) or
// carrying a high workload; everyone else goes home. At 23:00 everyone is sent
// home. Evening hours are overtime for whoever is still in.
import type { Decision, World } from './engine-types';
import type { Params } from './params';
import { isDayEnd, isDayStart, isOfficeClose, isOvertime } from '../shared/workday';

export const isPresent = (w: World, id: string) => w.agents[id]?.status === 'active' && w.agents[id].present !== false;

/** Start of a tick: everyone still employed is back at 09:00. */
export function arrive(w: World): void {
  if (!isDayStart(w.tick)) return;
  for (const id of w.ids) if (w.agents[id].status === 'active') w.agents[id].present = true;
}

export function staysLate(w: World, id: string, decision: Decision | undefined, p: Params): boolean {
  return decision?.action === 'overwork' || w.agents[id].state.workload >= p.rules.stayLate.workloadMin;
}

export interface PresenceLog {
  /** Still in for the next hour. */
  stayed: string[];
  /** Went home after this hour. */
  left: string[];
}

/** End of a tick: decide who is still in for the next hour. Null on ordinary office hours. */
export function depart(w: World, decisions: Record<string, Decision | undefined>, p: Params): PresenceLog | null {
  const t = w.tick;
  if (!isOfficeClose(t) && !isOvertime(t)) return null;
  const log: PresenceLog = { stayed: [], left: [] };
  for (const id of w.ids) {
    if (!isPresent(w, id)) continue;
    const stay = !isDayEnd(t) && staysLate(w, id, decisions[id], p);
    w.agents[id].present = stay;
    (stay ? log.stayed : log.left).push(id);
  }
  return log;
}
