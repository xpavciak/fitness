import { describe, expect, it } from 'vitest';
import { resolvePlanStart } from './schedule';

describe('resolvePlanStart', () => {
  it('uses the next Monday when nothing is stored', () => {
    expect(resolvePlanStart(null, '2026-11-10')).toBe('2026-11-16');
  });

  it('keeps a stored plan while it is running', () => {
    expect(resolvePlanStart('2026-11-16', '2026-11-25')).toBe('2026-11-16');
    expect(resolvePlanStart('2026-11-16', '2026-12-13')).toBe('2026-11-16');
  });

  it('starts a new plan after the stored one ends', () => {
    expect(resolvePlanStart('2026-11-16', '2026-12-14')).toBe('2026-12-14');
    expect(resolvePlanStart('2026-11-16', '2026-12-15')).toBe('2026-12-21');
  });

  it('ignores invalid, non-Monday or far-future stored values', () => {
    expect(resolvePlanStart('garbage', '2026-11-10')).toBe('2026-11-16');
    expect(resolvePlanStart('2026-11-17', '2026-11-10')).toBe('2026-11-16');
    expect(resolvePlanStart('2027-05-03', '2026-11-10')).toBe('2026-11-16');
  });
});
