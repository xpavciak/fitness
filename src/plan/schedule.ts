import { addDays, daysBetween, isValidIsoDate, weekdayIndex } from './dates';
import { DAYS_PER_WEEK, PLAN_WEEKS, defaultStartDate } from './generator';

const PLAN_DAYS = PLAN_WEEKS * DAYS_PER_WEEK;
/** How long a finished plan stays visible (with a restart prompt). */
export const ENDED_PLAN_GRACE_DAYS = 7;

export function planEndDate(start: string): string {
  return addDays(start, PLAN_DAYS - 1);
}

/** Monday of the week containing the given day. */
export function mondayOfWeek(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

export interface StartOptions {
  /** Monday of the current week; days before today are shown as past. */
  thisWeek: string;
  /** Monday of the following week. */
  nextWeek: string;
}

export function startOptions(todayIso: string): StartOptions {
  const thisWeek = mondayOfWeek(todayIso);
  return { thisWeek, nextWeek: addDays(thisWeek, DAYS_PER_WEEK) };
}

export type PlanStatus = 'upcoming' | 'running' | 'ended';

export function planStatus(start: string, todayIso: string): PlanStatus {
  if (todayIso < start) return 'upcoming';
  return todayIso <= planEndDate(start) ? 'running' : 'ended';
}

/** A start the user may choose: a Monday no later than next week's Monday. */
export function isSelectableStart(start: string, todayIso: string): boolean {
  return (
    isValidIsoDate(start) &&
    weekdayIndex(start) === 0 &&
    daysBetween(todayIso, start) <= DAYS_PER_WEEK
  );
}

/**
 * Chooses the plan start date. A stored (user-chosen) start is kept while its
 * plan runs and for a short grace period afterwards, so the user can see the
 * finished month and restart it. Otherwise the next Monday on/after today is used.
 */
export function resolvePlanStart(stored: string | null, todayIso: string): string {
  if (stored && isValidIsoDate(stored) && weekdayIndex(stored) === 0) {
    const notTooFarAhead = daysBetween(todayIso, stored) <= DAYS_PER_WEEK;
    const stillRelevant = daysBetween(planEndDate(stored), todayIso) <= ENDED_PLAN_GRACE_DAYS;
    if (notTooFarAhead && stillRelevant) return stored;
  }
  return defaultStartDate(todayIso);
}
