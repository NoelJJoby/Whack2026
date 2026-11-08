// The presentation cursor is independent of the newest computed server hour.
import type { TickFrame } from '../shared/api';
import type { SimulationState } from '../shared/types';
import { isDayStart, isOvertime } from '../shared/workday';

export interface Presentation {
  epoch: number;
  tick: number;
  active: boolean;
  baseline: SimulationState | null;
}
export const initialPresentation: Presentation = { epoch: -1, tick: 0, active: false, baseline: null };

export function reconcilePresentation(p: Presentation, history: TickFrame[], epoch: number, live: SimulationState | null): Presentation {
  // Reconnect/reset: show the latest committed snapshot without replaying it.
  if (epoch !== p.epoch || !p.baseline && live) return { epoch, tick: history.at(-1)?.tick ?? live?.tick ?? 0, active: false, baseline: live };
  if (p.active) return p;
  const next = history.find(f => f.tick > p.tick);
  return next ? { ...p, tick: next.tick, active: true } : p;
}
export function finishPresentation(p: Presentation, tick: number): Presentation {
  return p.tick === tick && p.active ? { ...p, active: false } : p;
}

/** Presence at the start of the presented hour, until dialogue finishes. */
export function presentedPresence(frame: TickFrame | undefined, previous: TickFrame | undefined, id: string, finished: boolean): boolean {
  const agent = frame?.state.agents[id];
  if (!agent || agent.status !== 'active') return false;
  if (finished) return agent.present !== false;
  if (isDayStart(frame!.tick)) return true;
  return previous?.state.agents[id]?.present ?? (isOvertime(frame!.tick) ? frame!.records.some(r => r.agent === id) : true);
}
