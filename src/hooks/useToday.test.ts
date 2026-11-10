import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { msUntilNextLocalMidnight, useToday } from './useToday';

afterEach(() => {
  vi.useRealTimers();
});

describe('useToday', () => {
  it('computes the delay to just after local midnight', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 10, 10, 23, 59, 0))).toBe(61_000);
  });

  it('rolls over at local midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 10, 23, 59, 50));
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-11-10');
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(result.current).toBe('2026-11-11');
  });

  it('refreshes when the tab becomes visible again', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 10, 12, 0, 0));
    const { result } = renderHook(() => useToday());
    // Simulate a suspended tab: the clock jumps without timers firing.
    vi.setSystemTime(new Date(2026, 10, 12, 8, 0, 0));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe('2026-11-12');
  });
});
