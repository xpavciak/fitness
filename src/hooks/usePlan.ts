import { useEffect, useMemo } from 'react';
import { generatePlan, resolvePlanStart, type TrainingPlan } from '../plan';

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

/** The current plan; its start date is persisted so the month stays stable. */
export function usePlan(todayIso: string): TrainingPlan {
  const start = useMemo(() => resolvePlanStart(readStoredStart(), todayIso), [todayIso]);
  useEffect(() => storeStart(start), [start]);
  return useMemo(() => generatePlan(start), [start]);
}
