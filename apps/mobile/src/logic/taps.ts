/**
 * Tap timing rules for destructive or layout-changing actions. A double tap (two taps within a
 * few hundred milliseconds) must never confirm a destructive action, and the second tap of a
 * double tap must not land on whatever moved under the finger after the first one.
 */

/** A confirming second tap must come at least this long after the first. */
export const CONFIRM_MIN_DELAY_MS = 600;
/** After this long the first tap expires and the next tap arms again. */
export const CONFIRM_WINDOW_MS = 6000;
/** Taps on guarded controls closer together than this are treated as one (double-tap guard). */
export const TAP_GUARD_MS = 600;

export type ConfirmStep = 'arm' | 'ignore' | 'confirm';

/** What a tap does for a two-step confirmation armed at `armedAt` (null = not armed). */
export function confirmStep(armedAt: number | null, now: number): ConfirmStep {
  if (armedAt === null || now - armedAt > CONFIRM_WINDOW_MS || now < armedAt) {
    return 'arm';
  }
  return now - armedAt < CONFIRM_MIN_DELAY_MS ? 'ignore' : 'confirm';
}

/** True when a guarded tap at `now` should run (the previous accepted one was `lastAt`). */
export function acceptTap(lastAt: number | null, now: number): boolean {
  return lastAt === null || now < lastAt || now - lastAt >= TAP_GUARD_MS;
}

/** Wall clock in ms (a module function so components never call `Date.now` during render). */
export function clockMs(): number {
  return Date.now();
}
