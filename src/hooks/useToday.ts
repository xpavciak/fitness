import { useEffect, useState } from 'react';
import { toLocalIsoDate } from '../plan';

/** Milliseconds until just after the next local midnight. */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return next.getTime() - now.getTime();
}

/**
 * Today's local date (ISO). Refreshes at local midnight and when the tab
 * becomes visible again (timers are throttled in background tabs).
 */
export function useToday(): string {
  const [today, setToday] = useState(() => toLocalIsoDate(new Date()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => setToday(toLocalIsoDate(new Date()));
    const schedule = () => {
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, msUntilNextLocalMidnight(new Date()));
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
        clearTimeout(timer);
        schedule();
      }
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return today;
}
