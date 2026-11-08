// Per-tick collector for task diagnostics. It is keyed on the tick's world object, so nothing
// is added to World and nothing persists in simulation state. With no collector registered,
// every hook returns before computing anything: diagnostics can never change behaviour.
import type { TaskEvent } from '../../shared/inbox';
import type { World } from '../engine-types';
import type { Params } from '../params';

interface Sink { events: TaskEvent[]; params: Params }
const sinks = new WeakMap<object, Sink>();

export function beginDiagnostics(w: World, params: Params) {
  sinks.set(w, { events: [], params });
}
export function collecting(w: World): boolean {
  return sinks.has(w);
}
export function diagnosticsParams(w: World): Params | undefined {
  return sinks.get(w)?.params;
}
export function takeDiagnostics(w: World): TaskEvent[] {
  const events = sinks.get(w)?.events ?? [];
  sinks.delete(w);
  return events;
}
export function note(w: World, event: Omit<TaskEvent, 'turn'>) {
  sinks.get(w)?.events.push({ turn: w.tick, ...event });
}
