// Ticks as the agents experience them: days and times of day, never tick
// numbers. Mirrors src/Workday.tsx (tick 1 is Day 1, 09:00; 16 ticks a day).
import type { VoiceParams } from '../params';

type Clock = VoiceParams['clock'];

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export function clockAt(tick: number, c: Clock): { day: number; hour: number } {
  if (tick <= 0) return { day: 1, hour: c.firstHour - 1 };
  return { day: Math.floor((tick - 1) / c.ticksPerDay) + 1, hour: c.firstHour + ((tick - 1) % c.ticksPerDay) };
}

function partOfDay(hour: number, c: Clock): 'morning' | 'afternoon' | 'evening' {
  return hour < c.afternoonFrom ? 'morning' : hour < c.eveningFrom ? 'afternoon' : 'evening';
}

/** "Day 2, 10:00"; the hour after 23:00 reads as midnight. */
export function clockPhrase(tick: number, c: Clock): string {
  const { day, hour } = clockAt(tick, c);
  return `Day ${day}, ${hour >= 24 ? 'midnight' : `${String(hour).padStart(2, '0')}:00`}`;
}

/** When something heard at `then` was heard, seen from `now`. */
export function heardWhen(now: number, then: number, c: Clock): string {
  if (then >= now) return 'just now';
  const a = clockAt(now, c);
  const b = clockAt(then, c);
  const part = partOfDay(b.hour, c);
  if (a.day === b.day) {
    if (now - then === 1) return 'an hour ago';
    return part === partOfDay(a.hour, c) ? `earlier this ${part}` : `this ${part}`;
  }
  const days = a.day - b.day;
  if (days === 1) return `yesterday ${part}`;
  return `${WORDS[days] ?? days} days ago`;
}
