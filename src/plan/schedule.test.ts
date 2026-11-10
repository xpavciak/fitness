import { describe, expect, it } from 'vitest';
import {
  isSelectableStart,
  mondayOfWeek,
  planEndDate,
  planStatus,
  resolvePlanStart,
  startOptions,
} from './schedule';

describe('resolvePlanStart', () => {
  it('uses the next Monday when nothing is stored', () => {
    expect(resolvePlanStart(null, '2026-11-10')).toBe('2026-11-16');
    expect(resolvePlanStart(null, '2026-11-16')).toBe('2026-11-16');
  });

  it('keeps a stored plan while it runs, including a start earlier this week', () => {
    expect(resolvePlanStart('2026-11-16', '2026-11-25')).toBe('2026-11-16');
    expect(resolvePlanStart('2026-11-09', '2026-11-10')).toBe('2026-11-09');
    expect(resolvePlanStart('2026-11-16', '2026-12-13')).toBe('2026-11-16');
  });

  it('keeps a finished plan for a 7-day grace period, then starts a new one', () => {
    expect(resolvePlanStart('2026-11-16', '2026-12-20')).toBe('2026-11-16');
    expect(resolvePlanStart('2026-11-16', '2026-12-21')).toBe('2026-12-21');
    expect(resolvePlanStart('2026-11-16', '2026-12-22')).toBe('2026-12-28');
  });

  it('ignores invalid, non-Monday or far-future stored values', () => {
    expect(resolvePlanStart('garbage', '2026-11-10')).toBe('2026-11-16');
    expect(resolvePlanStart('2026-11-17', '2026-11-10')).toBe('2026-11-16');
    expect(resolvePlanStart('2027-05-03', '2026-11-10')).toBe('2026-11-16');
  });
});

describe('start options and status', () => {
  it('offers this week and next week Mondays', () => {
    expect(startOptions('2026-11-10')).toEqual({ thisWeek: '2026-11-09', nextWeek: '2026-11-16' });
    expect(startOptions('2026-11-16')).toEqual({ thisWeek: '2026-11-16', nextWeek: '2026-11-23' });
    expect(startOptions('2026-11-22')).toEqual({ thisWeek: '2026-11-16', nextWeek: '2026-11-23' });
    expect(mondayOfWeek('2027-01-01')).toBe('2026-12-28');
  });

  it('reports upcoming / running / ended', () => {
    expect(planEndDate('2026-11-16')).toBe('2026-12-13');
    expect(planStatus('2026-11-16', '2026-11-15')).toBe('upcoming');
    expect(planStatus('2026-11-16', '2026-11-16')).toBe('running');
    expect(planStatus('2026-11-16', '2026-12-13')).toBe('running');
    expect(planStatus('2026-11-16', '2026-12-14')).toBe('ended');
  });

  it('validates selectable starts', () => {
    expect(isSelectableStart('2026-11-09', '2026-11-10')).toBe(true);
    expect(isSelectableStart('2026-11-16', '2026-11-10')).toBe(true);
    expect(isSelectableStart('2026-11-23', '2026-11-10')).toBe(false);
    expect(isSelectableStart('2026-11-10', '2026-11-10')).toBe(false);
  });
});
