/** 09:00 to 23:00, two hours apart. 09:00-17:00 are office hours; 19:00-23:00 are overtime for people who stay late. */
export const TICKS_PER_DAY = 8;
export const OFFICE_TICKS_PER_DAY = 5;
export const DAYS_PER_WEEK = 5;
export const WEEKS_PER_MONTH = 2;
export const DAYS_PER_MONTH = DAYS_PER_WEEK * WEEKS_PER_MONTH; // 10 active simulated workdays per month
export const CALENDAR_DAYS_PER_WORKDAY = 3; // 1 active workday + 2 fast-forwarded routine filler days
export const CALENDAR_DAYS_PER_MONTH = DAYS_PER_MONTH * CALENDAR_DAYS_PER_WORKDAY; // 30 calendar days per month
export const MONTHS_PER_QUARTER = 3;
export const DAYS_PER_QUARTER = DAYS_PER_MONTH * MONTHS_PER_QUARTER; // 30 active simulated workdays per quarter
export const CALENDAR_DAYS_PER_QUARTER = CALENDAR_DAYS_PER_MONTH * MONTHS_PER_QUARTER; // 90 calendar days per quarter

export const TICKS_PER_WEEK = TICKS_PER_DAY * DAYS_PER_WEEK; // 40 ticks
export const TICKS_PER_MONTH = TICKS_PER_DAY * DAYS_PER_MONTH; // 80 ticks
export const TICKS_PER_QUARTER = TICKS_PER_DAY * DAYS_PER_QUARTER; // 240 ticks

const WORKDAY_HOURS = [9, 11, 13, 15, 17, 19, 21, 23] as const;

/**
 * 8 ticks per active workday (09:00 to 23:00, two hours apart; after 17:00 only people working late are in),
 * 10 active workdays per month mapped across a full 30-day calendar month
 * (each active workday is followed by 2 routine filler days after 17:00,
 * rolling smoothly from Day 1 through Day 30 before advancing to the next month).
 */
export function workdayTime(tick: number) {
  if (tick <= 0) {
    return {
      quarter: 1,
      month: 1,
      week: 1,
      day: 1,
      dayOfMonth: 1,
      fillerDays: [] as number[],
      hour: 8,
      progress: 0,
    };
  }
  const elapsed = ((tick - 1) % TICKS_PER_DAY) + 1;
  const dayIndex = Math.floor((tick - 1) / TICKS_PER_DAY);
  const day = dayIndex + 1;
  const week = Math.floor(dayIndex / DAYS_PER_WEEK) + 1;
  const month = Math.floor(dayIndex / DAYS_PER_MONTH) + 1;
  const quarter = Math.floor((month - 1) / MONTHS_PER_QUARTER) + 1;
  const simDayOfMonth = dayIndex % DAYS_PER_MONTH;
  const dayOfMonth = simDayOfMonth * CALENDAR_DAYS_PER_WORKDAY + 1;
  const fillerDays = elapsed === TICKS_PER_DAY ? [dayOfMonth + 1, dayOfMonth + 2] : [];
  const hour = WORKDAY_HOURS[elapsed - 1];
  const progress = (elapsed / TICKS_PER_DAY) * 100;
  return { quarter, month, week, day, dayOfMonth, fillerDays, hour, progress };
}

/** An hour after 17:00 is overtime: only people who stayed late are in. */
export function isOvertime(tick: number): boolean {
  return tick > 0 && workdayTime(tick).hour > 17;
}

/** 09:00 to 17:00. */
export function isOfficeHour(tick: number): boolean {
  return tick > 0 && !isOvertime(tick);
}

/** 17:00, the last office hour: people decide whether to stay late. */
export function isOfficeClose(tick: number): boolean {
  return tick > 0 && ((tick - 1) % TICKS_PER_DAY) + 1 === OFFICE_TICKS_PER_DAY;
}

/** 09:00. */
export function isDayStart(tick: number): boolean {
  return tick > 0 && (tick - 1) % TICKS_PER_DAY === 0;
}

/** 23:00: everyone is sent home and the day's report is written. */
export function isDayEnd(tick: number): boolean {
  return tick > 0 && tick % TICKS_PER_DAY === 0;
}

/** Zero-based active workday of a tick. */
export function dayIndexOf(tick: number): number {
  return tick > 0 ? Math.floor((tick - 1) / TICKS_PER_DAY) : 0;
}

/** A duration of `n` active workdays in ticks (at least one tick). */
export function days(n: number): number {
  return Math.max(1, Math.round(n * TICKS_PER_DAY));
}

/** Financial calendar elapsed, including the two routine days after each workday. */
export function calendarDaysElapsed(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY) * CALENDAR_DAYS_PER_WORKDAY + (tick % TICKS_PER_DAY) / TICKS_PER_DAY;
}
export function calendarSpan(fromTick: number, toTick: number): number {
  if (fromTick < 0 || toTick < fromTick) throw new Error('Invalid calendar span');
  return Math.round((calendarDaysElapsed(toTick) - calendarDaysElapsed(fromTick)) * TICKS_PER_DAY) / TICKS_PER_DAY;
}
