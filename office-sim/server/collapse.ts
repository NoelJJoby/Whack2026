// "CEO resign" button: the CEO walks out, the office panics, stress and burnout climb every hour,
// and people resign one by one as their burnout bar fills (at most three in any hour). When nobody
// is left the run ends and the end-of-quarter report takes over. All numbers are rules, seeded.
import type { Params } from './params';
import type { World } from './engine-types';
import { applyDelta } from './rules';
import { stream } from './rng';

export interface Collapse { startTick: number }
type CollapseWorld = World & { collapse?: Collapse };

/** At most this many resignations in one hour, so the walk-outs read one wave at a time. */
export const MAX_RESIGNATIONS_PER_TICK = 3;
/** A full burnout bar. */
const FULL = 100;

export const collapseOf = (w: World): Collapse | undefined => (w as CollapseWorld).collapse;

export function ceoId(w: World): string | undefined {
  return w.ids.find(id => w.agents[id].profile.archetype === 'CEO' || w.business?.positions?.[id]?.role === 'ceo');
}

/** Queue the collapse for the next hour. */
export function scheduleCollapse(w: World): World {
  return { ...w, collapse: { startTick: w.tick + 1 } } as World;
}

/** Start of the first collapse hour: the CEO resigns. Returns their id if they left this hour. */
export function ceoResigns(w: World): string | null {
  const c = collapseOf(w), ceo = ceoId(w);
  if (!c || c.startTick !== w.tick || !ceo || w.agents[ceo].status !== 'active') return null;
  w.agents[ceo].status = 'quit';
  w.agents[ceo].quitTick = w.tick;
  w.quits.push({ agent: ceo, tick: w.tick });
  return ceo;
}

/**
 * Every collapse hour: everyone left stays in the office (no going home) and stress and burnout climb.
 * Each person's pace is seeded, nudged by personality (impulsive people crack faster, people who need
 * the money hold on a little longer), so the bars fill at different times.
 */
export function collapsePressure(w: World, p: Params): void {
  const c = collapseOf(w);
  if (!c || w.tick < c.startTick) return;
  const ceo = ceoId(w);
  for (const id of w.ids) {
    const a = w.agents[id];
    if (id === ceo || a.status !== 'active') continue;
    a.present = true;
    const traits = a.profile.traits;
    const pace = 9 + stream(w.seed, c.startTick, id, 'collapse').next() * 10 + traits.impulsivity * 0.05 - traits.financial_need * 0.03;
    applyDelta(a, { stress: pace * 1.4, burnout: pace, trust_mgmt: -6, loyalty: -5 }, p);
  }
}

/** Who resigns this hour: full burnout bars, fullest first, never more than three. */
export function collapseResignations(w: World): string[] {
  const c = collapseOf(w);
  if (!c || w.tick < c.startTick) return [];
  const ceo = ceoId(w);
  const ready = w.ids
    .filter(id => id !== ceo && w.agents[id].status === 'active' && w.agents[id].state.burnout >= FULL)
    .sort((a, b) => w.agents[b].state.burnout - w.agents[a].state.burnout || a.localeCompare(b))
    .slice(0, MAX_RESIGNATIONS_PER_TICK);
  for (const id of ready) {
    w.agents[id].status = 'quit';
    w.agents[id].quitTick = w.tick;
    w.quits.push({ agent: id, tick: w.tick });
  }
  return ready;
}

/** Nobody left but the departed: the run is over. */
export function everyoneGone(w: World): boolean {
  return Boolean(collapseOf(w)) && w.ids.every(id => w.agents[id].status !== 'active');
}

const PANIC_LINES = [
  "Who's even in charge now?",
  'Did the CEO really just walk out?',
  'Is anyone getting paid this month?',
  "I'm updating my CV. Right now.",
  'Everyone stay calm! Nobody is calm!',
  'This place is falling apart.',
];
const PANIC_THOUGHTS = [
  "I can't keep doing this.",
  'Get out while you still can.',
  'My chest is tight. Breathe.',
  "If they're gone, why am I still here?",
];

/** Rules-mode words during a collapse (no AI reply), so the dialogue matches the panic on screen. */
export function collapseLines(w: World, id: string): { public_line: string; inner_monologue: string } | null {
  const c = collapseOf(w);
  if (!c || w.tick < c.startTick) return null;
  const rng = stream(w.seed, w.tick, id, 'collapse');
  return { public_line: PANIC_LINES[rng.int(PANIC_LINES.length)], inner_monologue: PANIC_THOUGHTS[rng.int(PANIC_THOUGHTS.length)] };
}
