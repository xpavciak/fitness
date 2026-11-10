import { describe, expect, it } from 'vitest';
import { formatDateSk, formatLongDateSk, isValidIsoDate, toLocalIsoDate } from './dates';
import { secondsPerRep } from './duration';

describe('dates', () => {
  it('validates ISO dates including leap years', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2027-02-29')).toBe(false);
    expect(isValidIsoDate('2026-1-5')).toBe(false);
  });

  it('formats Slovak dates', () => {
    expect(formatDateSk('2026-11-16')).toBe('16. 11. 2026');
    expect(formatDateSk('2026-11-16', false)).toBe('16. 11.');
    expect(formatLongDateSk('2026-11-19')).toBe('štvrtok 19. 11. 2026');
  });

  it('uses the local calendar date', () => {
    expect(toLocalIsoDate(new Date(2026, 10, 10, 23, 59))).toBe('2026-11-10');
  });
});

describe('secondsPerRep', () => {
  it('sums tempo parts and enforces a 1 s minimum', () => {
    expect(secondsPerRep('3-1-1')).toBe(5);
    expect(secondsPerRep('0-0-0')).toBe(1);
    expect(() => secondsPerRep('a-b')).toThrow(/Invalid tempo/);
  });
});
