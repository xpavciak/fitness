import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  isMonday,
  isValidTimeZone,
  isWithinWeek,
  toEpochDay,
  weekdayIndex,
} from './dates.js';

describe('date helpers', () => {
  it('computes Monday-based weekday indexes', () => {
    expect(weekdayIndex('2026-10-05')).toBe(0);
    expect(weekdayIndex('2026-10-11')).toBe(6);
    expect(isMonday('2026-10-05')).toBe(true);
    expect(isMonday('2026-10-06')).toBe(false);
  });

  it('adds days across month and leap-year boundaries', () => {
    expect(addDays('2026-10-29', 7)).toBe('2026-11-05');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(daysBetween('2026-10-12', '2026-10-05')).toBe(-7);
  });

  it('checks membership in a 7-day week', () => {
    expect(isWithinWeek('2026-10-11', '2026-10-05')).toBe(true);
    expect(isWithinWeek('2026-10-12', '2026-10-05')).toBe(false);
    expect(isWithinWeek('2026-10-04', '2026-10-05')).toBe(false);
  });

  it('throws on malformed dates', () => {
    expect(() => toEpochDay('2026/10/05')).toThrow(RangeError);
  });

  it('validates IANA time zones', () => {
    expect(isValidTimeZone('Europe/Bratislava')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
