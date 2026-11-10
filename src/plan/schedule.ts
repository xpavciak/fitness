import { addDays, daysBetween, isValidIsoDate, weekdayIndex } from './dates';
import { DAYS_PER_WEEK, PLAN_WEEKS, defaultStartDate } from './generator';

/**
 * Chooses the plan start date. A previously stored start is kept while its
 * plan is still running (so "today" stays inside the plan over the month);
 * otherwise the next Monday on/after today is used.
 */
export function resolvePlanStart(stored: string | null, todayIso: string): string {
  if (stored && isValidIsoDate(stored) && weekdayIndex(stored) === 0) {
    const end = addDays(stored, PLAN_WEEKS * DAYS_PER_WEEK - 1);
    const startsWithinAWeek = daysBetween(todayIso, stored) <= 7;
    if (todayIso <= end && startsWithinAWeek) return stored;
  }
  return defaultStartDate(todayIso);
}
