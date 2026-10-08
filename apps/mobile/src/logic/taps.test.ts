import { describe, expect, it } from 'vitest';
import {
  acceptTap,
  confirmStep,
  CONFIRM_MIN_DELAY_MS,
  CONFIRM_WINDOW_MS,
  TAP_GUARD_MS,
} from './taps';

describe('confirmStep (two-step confirm for delete and regenerate)', () => {
  it('arms on the first tap and ignores a double tap', () => {
    expect(confirmStep(null, 1000)).toBe('arm');
    expect(confirmStep(1000, 1000 + 80)).toBe('ignore');
    expect(confirmStep(1000, 1000 + CONFIRM_MIN_DELAY_MS - 1)).toBe('ignore');
  });

  it('confirms a deliberate second tap and re-arms after the window', () => {
    expect(confirmStep(1000, 1000 + CONFIRM_MIN_DELAY_MS)).toBe('confirm');
    expect(confirmStep(1000, 1000 + CONFIRM_WINDOW_MS)).toBe('confirm');
    expect(confirmStep(1000, 1000 + CONFIRM_WINDOW_MS + 1)).toBe('arm');
    expect(confirmStep(1000, 500)).toBe('arm'); // clock went backwards
  });
});

describe('acceptTap (double-tap guard)', () => {
  it('drops a second tap within the guard window', () => {
    expect(acceptTap(null, 0)).toBe(true);
    expect(acceptTap(1000, 1000 + 50)).toBe(false);
    expect(acceptTap(1000, 1000 + TAP_GUARD_MS)).toBe(true);
    expect(acceptTap(1000, 10)).toBe(true);
  });
});
