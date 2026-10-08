/**
 * Pure calendar helpers for `YYYY-MM-DD` dates. Dates are treated as calendar days
 * (computed in UTC so results never depend on the host time zone).
 */

const MS_PER_DAY = 86_400_000;

/** Parses a `YYYY-MM-DD` string into a UTC epoch day number. Throws on malformed input. */
export function toEpochDay(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new RangeError(`Invalid calendar date "${date}" (expected YYYY-MM-DD)`);
  }
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

export function fromEpochDay(epochDay: number): string {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromEpochDay(toEpochDay(date) + days);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** 0 = Monday ... 6 = Sunday (matches `WEEKDAYS` and `day_index`). */
export function weekdayIndex(date: string): number {
  const sundayBased = new Date(toEpochDay(date) * MS_PER_DAY).getUTCDay();
  return (sundayBased + 6) % 7;
}

export function isMonday(date: string): boolean {
  return weekdayIndex(date) === 0;
}

/** True when `date` falls in the 7-day week starting on `weekStart` (inclusive). */
export function isWithinWeek(date: string, weekStart: string): boolean {
  const offset = daysBetween(weekStart, date);
  return offset >= 0 && offset <= 6;
}

/** True when `timeZone` is an IANA zone name the runtime recognises (e.g. `Europe/Bratislava`). */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.trim() === '') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch (error) {
    if (error instanceof RangeError) {
      return false;
    }
    throw error;
  }
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

/** The Monday on or after `date`. */
export function nextMondayOnOrAfter(date: string): string {
  const offset = weekdayIndex(date);
  return offset === 0 ? date : addDays(date, 7 - offset);
}

/**
 * Local calendar date (`YYYY-MM-DD`) of an ISO 8601 instant in an IANA time zone,
 * e.g. `2026-10-04T23:30:00Z` in `Europe/Bratislava` -> `2026-10-05`.
 */
export function localDateOf(instant: string, timeZone: string): string {
  const epochMs = Date.parse(instant);
  if (Number.isNaN(epochMs)) {
    throw new RangeError(`Invalid ISO 8601 instant "${instant}"`);
  }
  if (!isValidTimeZone(timeZone)) {
    throw new RangeError(`Unknown IANA time zone "${timeZone}"`);
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const part = (type: 'year' | 'month' | 'day'): string => {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined) {
      throw new RangeError(`Could not format ${instant} in ${timeZone}`);
    }
    return value;
  };
  return `${part('year')}-${part('month')}-${part('day')}`;
}
