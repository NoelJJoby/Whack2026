// Ticks as the agents experience them: days and times of day, never tick
// numbers. Times come from shared/workday.ts, the one workday definition.
import { workdayTime } from '../../shared/workday';
import type { VoiceParams } from '../params';

type Clock = VoiceParams['clock'];

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export function clockAt(tick: number): { day: number; hour: number } {
  const { day, hour } = workdayTime(tick);
  return { day, hour };
}

function partOfDay(hour: number, c: Clock): 'morning' | 'afternoon' | 'evening' {
  return hour < c.afternoonFrom ? 'morning' : hour < c.eveningFrom ? 'afternoon' : 'evening';
}

/** When something heard at `then` was heard, seen from `now`. */
export function heardWhen(now: number, then: number, c: Clock): string {
  if (then >= now) return 'just now';
  const a = clockAt(now);
  const b = clockAt(then);
  const part = partOfDay(b.hour, c);
  if (a.day === b.day) {
    const hours = a.hour - b.hour;
    if (hours <= 1) return 'an hour ago';
    if (hours <= 2) return 'a couple of hours ago';
    return part === partOfDay(a.hour, c) ? `earlier this ${part}` : `this ${part}`;
  }
  const days = a.day - b.day;
  if (days === 1) return `yesterday ${part}`;
  return days <= 10 ? `${WORDS[days]} days ago` : 'weeks ago';
}

/** A deadline in the same workday calendar used by the employee's clock. */
export function dueWhen(now: number, then: number): string {
  const a = clockAt(now), b = clockAt(then);
  const time = `${String(b.hour).padStart(2, '0')}:00`;
  if (then < now) return `overdue since day ${b.day}, ${time}`;
  if (a.day === b.day) return `by ${time} today`;
  if (b.day === a.day + 1) return `by tomorrow ${time}`;
  const days = b.day - a.day;
  return `in ${WORDS[days] ?? days} days, by ${time}`;
}
