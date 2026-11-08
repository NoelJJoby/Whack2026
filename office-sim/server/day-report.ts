import type { DayReport, TickFrame } from '../shared/api';
import { dayIndexOf, isDayEnd, isOvertime, workdayTime, TICKS_PER_DAY } from '../shared/workday';
import type { World } from './engine-types';

/** Facts from the committed day; never asks a model to invent a summary. */
export function dayReport(world: World, frames: TickFrame[]): DayReport | undefined {
  if (!isDayEnd(world.tick)) return undefined;
  const today = frames.filter(f => dayIndexOf(f.tick) === dayIndexOf(world.tick));
  const { dayOfMonth: day, fillerDays } = workdayTime(world.tick);
  const start = world.tick - TICKS_PER_DAY + 1;
  const announcements = today.flatMap(f => f.events.map(e => e.text));
  const lines = announcements.length ? announcements.map(text => `Announcement: ${text}`) : ['No announcements today.'];
  for (const e of world.eventState.cases) {
    if (e.openedTick >= start) lines.push(`Case opened: ${e.headline}.`);
    if (['resolved', 'failed'].includes(e.status) && e.milestones.some(m => m.tick >= start && m.text === e.outcome)) {
      lines.push(`Case ${e.status}: ${e.headline}. ${e.outcome ?? ''}`);
    }
  }
  for (const id of world.ids) {
    const agent = world.agents[id];
    const previous = frames.find(f => f.tick === start - 1)?.state.agents[id]?.status ?? 'active';
    if (agent.status !== 'active' && previous === 'active') {
      // A departure before this day is not a new departure if history starts after recovery.
      if (agent.quitTick !== null && agent.quitTick >= start || today.some(f => f.records.some(r => r.agent === id && r.quit))) {
        lines.push(`${agent.profile.name} ${agent.status === 'laid_off' ? 'was laid off' : 'resigned'}.`);
      }
    }
    const last = today.filter(f => isOvertime(f.tick) && f.records.some(r => r.agent === id)).at(-1);
    if (last) lines.push(`${agent.profile.name} worked late until ${workdayTime(last.tick).hour}:00.`);
  }
  lines.push('The office is closed. Everyone has gone home.');
  return { day, lines, fillerDays };
}
