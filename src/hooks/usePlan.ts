import { useCallback, useEffect, useMemo, useState } from 'react';
import { generatePlan, isSelectableStart, resolvePlanStart, type TrainingPlan } from '../plan';

export const START_STORAGE_KEY = 'treningovy-plan:start';

function readStoredStart(): string | null {
  try {
    return window.localStorage.getItem(START_STORAGE_KEY);
  } catch (error) {
    // Storage can be blocked (privacy mode); the plan then simply is not persisted.
    console.warn('Cannot read plan start from storage', error);
    return null;
  }
}

function storeStart(start: string): void {
  try {
    window.localStorage.setItem(START_STORAGE_KEY, start);
  } catch (error) {
    console.warn('Cannot persist plan start', error);
  }
}

export interface PlanState {
  plan: TrainingPlan;
  /** Choose a new start Monday (this week or next week). */
  setStart: (start: string) => void;
}

/** The current plan; its start date is persisted so the month stays stable. */
export function usePlan(todayIso: string): PlanState {
  const [chosen, setChosen] = useState<string | null>(readStoredStart);
  const start = resolvePlanStart(chosen, todayIso);
  // Once resolved, the start becomes the chosen one (also in memory when storage
  // is blocked), so a date change in an open tab never moves a running plan.
  // Adjusting state during render is React's recommended pattern for derived state.
  if (start !== chosen) setChosen(start);
  useEffect(() => storeStart(start), [start]);
  const plan = useMemo(() => generatePlan(start), [start]);
  const setStart = useCallback(
    (next: string) => {
      if (!isSelectableStart(next, todayIso)) {
        throw new Error(`Invalid plan start: ${next}`);
      }
      setChosen(next);
    },
    [todayIso],
  );
  return { plan, setStart };
}
