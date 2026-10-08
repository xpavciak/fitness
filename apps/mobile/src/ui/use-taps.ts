import { useEffect, useRef, useState } from 'react';
import { acceptTap, clockMs, confirmStep, CONFIRM_WINDOW_MS, settled } from '../logic/taps';

/**
 * Two-step confirmation for destructive actions: the first tap arms (`armed(key)` becomes true),
 * a second tap within the next 600 ms is ignored (a double tap), and a later deliberate tap runs
 * the action. The armed state (and its "Tap again…" label) clears itself after 6 s.
 */
export function useTwoStepConfirm<K extends string>() {
  const [armed, setArmed] = useState<{ key: K; at: number } | null>(null);
  useEffect(() => {
    if (!armed) {
      return undefined;
    }
    const timeout = setTimeout(
      () => {
        setArmed(null);
      },
      Math.max(0, armed.at + CONFIRM_WINDOW_MS - clockMs()),
    );
    return () => {
      clearTimeout(timeout);
    };
  }, [armed]);
  return {
    armed: (key: K): boolean => armed?.key === key,
    press: (key: K, onConfirm: () => void): void => {
      const now = clockMs();
      const step = confirmStep(armed?.key === key ? armed.at : null, now);
      if (step === 'arm') {
        setArmed({ key, at: now });
      } else if (step === 'confirm') {
        setArmed(null);
        onConfirm();
      }
    },
    cancel: (): void => {
      setArmed(null);
    },
  };
}

/**
 * Double-tap guard for screens whose layout changes after a tap.
 * - Per control: a repeat tap on the same `id` within 600 ms is dropped; a tap on a different
 *   control (e.g. "Accept" right after "Can't make it" revealed it) goes through.
 * - Settle: when `focusKey` changes after mount (the screen regained focus, e.g. after
 *   "Finish workout", or the app was foregrounded), every guarded control ignores taps for
 *   400 ms, so the second tap of a double tap on the previous screen cannot land here.
 */
export function useTapGuard(focusKey: number) {
  const last = useRef(new Map<string, number>());
  // Never updated: the focus clock only increases, so any value other than the mount-time one
  // means the screen regained focus after mounting.
  const mountKey = useRef(focusKey);
  const settledFrom = useRef<number | null>(null);
  useEffect(() => {
    if (focusKey !== mountKey.current) {
      settledFrom.current = clockMs();
      last.current.clear();
    }
  }, [focusKey]);
  return <A extends unknown[]>(id: string, handler: (...args: A) => void) =>
    (...args: A): void => {
      const now = clockMs();
      if (!settled(settledFrom.current, now) || !acceptTap(last.current.get(id) ?? null, now)) {
        return;
      }
      last.current.set(id, now);
      handler(...args);
    };
}
