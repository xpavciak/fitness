/**
 * Calendar helpers working on plain ISO dates (YYYY-MM-DD) in UTC arithmetic,
 * so daylight-saving changes never shift a day.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const WEEKDAY_NAMES = [
  'pondelok',
  'utorok',
  'streda',
  'štvrtok',
  'piatok',
  'sobota',
  'nedeľa',
] as const;

export const WEEKDAY_SHORT = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'] as const;

export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function toUtcMs(iso: string): number {
  if (!isValidIsoDate(iso)) {
    throw new Error(`Invalid ISO date: ${iso}`);
  }
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromUtcMs(toUtcMs(iso) + days * 86_400_000);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(iso: string): number {
  return (new Date(toUtcMs(iso)).getUTCDay() + 6) % 7;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUtcMs(toIso) - toUtcMs(fromIso)) / 86_400_000);
}

/** Local calendar date of a Date object as ISO string. */
export function toLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The given day if it is a Monday, otherwise the next Monday. */
export function nextMondayOnOrAfter(iso: string): string {
  const offset = (7 - weekdayIndex(iso)) % 7;
  return addDays(iso, offset);
}

/** Slovak numeric date, e.g. "16. 11. 2026". */
export function formatDateSk(iso: string, withYear = true): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return withYear ? `${d}. ${m}. ${y}` : `${d}. ${m}.`;
}

/** E.g. "pondelok 16. 11. 2026". */
export function formatLongDateSk(iso: string): string {
  return `${WEEKDAY_NAMES[weekdayIndex(iso)]} ${formatDateSk(iso)}`;
}
