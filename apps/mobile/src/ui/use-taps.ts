import { useRef, useState } from 'react';
import { acceptTap, clockMs, confirmStep } from '../logic/taps';

/**
 * Two-step confirmation for destructive actions: the first tap arms (`armed(key)` becomes true),
 * a second tap within the next 600 ms is ignored (a double tap), and a later deliberate tap runs
 * the action. `cancel()` disarms.
 */
export function useTwoStepConfirm<K extends string>() {
  const [armed, setArmed] = useState<{ key: K; at: number } | null>(null);
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
 * Wraps handlers so a second tap within 600 ms of the last guarded tap is dropped. The guard only
 * applies within one visit: a new `resetKey` (e.g. the store's focus clock) starts afresh, so
 * quickly leaving and returning to a screen never swallows the first tap.
 */
export function useTapGuard(resetKey: number) {
  const last = useRef<{ key: number; at: number } | null>(null);
  return <A extends unknown[]>(handler: (...args: A) => void) =>
    (...args: A): void => {
      const now = clockMs();
      const previous = last.current?.key === resetKey ? last.current.at : null;
      if (!acceptTap(previous, now)) {
        return;
      }
      last.current = { key: resetKey, at: now };
      handler(...args);
    };
}
