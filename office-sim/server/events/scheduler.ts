import type { Rarity } from '../../shared/events';
import type { World } from '../engine-types';
import { stream } from '../rng';
import { dayIndexOf } from '../../shared/workday';
import { CATALOG, eligible } from './catalog';
import { arrival, openEvent, terminal } from './lifecycle';
export function consumeSlot(w: World, rarity: Rarity, reason: string, eventId?: string) {
  const state = w.eventState; const slot = state.scheduler[rarity];
  state.scheduling.push({ tick: w.tick, rarity, slot: slot.index, nominal: slot.nominal, reason, eventId });
  const index = slot.index + 1;
  const due = arrival(w.seed, rarity, index, w.tick);
  state.scheduler[rarity] = { index, nominal: due, due };
}
export function scheduleEvents(w: World) {
  for (const rarity of ['common','rare'] as const) {
    const s = w.eventState; const slot = s.scheduler[rarity]; if (w.tick < slot.due) continue;
    let reason: string | null = null;
    if (s.cases.some(e => e.origin === 'external' && dayIndexOf(e.openedTick) === dayIndexOf(w.tick))) reason = 'active_day_limit';
    if (s.cases.filter(e => e.severity === 'high' && !terminal(e)).length >= 2) reason = 'high_severity_capacity';
    let pool = CATALOG.filter(d => d.rarity === rarity && eligible(w,d));
    if (!pool.length) reason ??= 'no_eligible_template';
    if (reason) { s.scheduling.push({ tick: w.tick, rarity, slot: slot.index, nominal: slot.nominal, reason }); slot.due = w.tick + 1; continue; }
    const rng = stream(w.seed, slot.index, `template-${rarity}`, 'event');
    const recent = s.cases.slice(-8); const positive = recent.filter(e => e.valence === 'positive').length / Math.max(1,recent.length);
    const desired = rng.chance(Math.max(0.5, Math.min(0.7, 0.6 + (0.6-positive)*0.12))) ? 'positive' : 'negative';
    const matching = pool.filter(d => d.valence === desired);
    if (matching.length) pool = matching;
    else s.scheduling.push({ tick: w.tick, rarity, slot: slot.index, nominal: slot.nominal, reason: 'desired_valence_ineligible' });
    const d = pool[rng.int(pool.length)];
    const e = openEvent(w, d);
    consumeSlot(w, rarity, 'scheduled', e.id);
  }
}
