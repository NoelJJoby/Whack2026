export const TICKS_PER_DAY = 5;
export const DAYS_PER_WEEK = 5;
export const WEEKS_PER_MONTH = 2;
export const DAYS_PER_MONTH = DAYS_PER_WEEK * WEEKS_PER_MONTH; // 10 simulated days per month
export const MONTHS_PER_QUARTER = 3;
export const DAYS_PER_QUARTER = DAYS_PER_MONTH * MONTHS_PER_QUARTER; // 30 simulated days per quarter

export const TICKS_PER_WEEK = TICKS_PER_DAY * DAYS_PER_WEEK; // 25 ticks
export const TICKS_PER_MONTH = TICKS_PER_DAY * DAYS_PER_MONTH; // 50 ticks
export const TICKS_PER_QUARTER = TICKS_PER_DAY * DAYS_PER_QUARTER; // 150 ticks

const WORKDAY_HOURS = [9, 11, 13, 15, 17] as const;

/**
 * 5 ticks per workday (09:00, 11:00, 13:00, 15:00, 17:00),
 * 5 days per workweek (25 ticks), 10 simulated days per month (50 ticks),
 * and 30 simulated days per quarter (150 ticks).
 */
export function workdayTime(tick: number) {
  if (tick <= 0) {
    return { quarter: 1, month: 1, week: 1, day: 1, dayOfMonth: 1, hour: 8, progress: 0 };
  }
  const elapsed = ((tick - 1) % TICKS_PER_DAY) + 1;
  const dayIndex = Math.floor((tick - 1) / TICKS_PER_DAY);
  const day = dayIndex + 1;
  const week = Math.floor(dayIndex / DAYS_PER_WEEK) + 1;
  const month = Math.floor(dayIndex / DAYS_PER_MONTH) + 1;
  const quarter = Math.floor((month - 1) / MONTHS_PER_QUARTER) + 1;
  const dayOfMonth = (dayIndex % DAYS_PER_MONTH) + 1;
  const hour = WORKDAY_HOURS[elapsed - 1];
  const progress = (elapsed / TICKS_PER_DAY) * 100;
  return { quarter, month, week, day, dayOfMonth, hour, progress };
}

/** An hour ending after 17:00 is overtime. Normal 5-tick workdays end at 17:00. */
export function isOvertime(tick: number): boolean {
  return tick > 0 && workdayTime(tick).hour > 17;
}
