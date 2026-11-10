import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  generatePlan,
  isSelectableStart,
  isValidSwap,
  resolvePlanStart,
  sanitizeSwaps,
  type ExerciseSwaps,
  type TrainingPlan,
} from '../plan';

export const START_STORAGE_KEY = 'treningovy-plan:start';
export const SWAPS_STORAGE_KEY = 'treningovy-plan:vymeny';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    // Storage can be blocked (privacy mode); the plan then simply is not persisted.
    console.warn(`Cannot read ${key} from storage`, error);
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`Cannot persist ${key}`, error);
  }
}

function readStoredSwaps(): ExerciseSwaps {
  const raw = readStorage(SWAPS_STORAGE_KEY);
  if (!raw) return {};
  try {
    return sanitizeSwaps(JSON.parse(raw));
  } catch {
    return {};
  }
}

export interface PlanState {
  plan: TrainingPlan;
  /** Choose a new start Monday (this week or next week). */
  setStart: (start: string) => void;
  /** Replace an exercise in the whole plan; `null` restores the original. */
  swapExercise: (original: string, replacement: string | null) => void;
}

/** The current plan; its start date and exercise swaps are persisted. */
export function usePlan(todayIso: string): PlanState {
  const [chosen, setChosen] = useState<string | null>(() => readStorage(START_STORAGE_KEY));
  const [swaps, setSwaps] = useState<ExerciseSwaps>(readStoredSwaps);
  const start = resolvePlanStart(chosen, todayIso);
  // Once resolved, the start becomes the chosen one (also in memory when storage
  // is blocked), so a date change in an open tab never moves a running plan.
  // Adjusting state during render is React's recommended pattern for derived state.
  if (start !== chosen) setChosen(start);
  useEffect(() => writeStorage(START_STORAGE_KEY, start), [start]);
  useEffect(() => writeStorage(SWAPS_STORAGE_KEY, JSON.stringify(swaps)), [swaps]);
  const plan = useMemo(() => generatePlan(start, swaps), [start, swaps]);
  const setStart = useCallback(
    (next: string) => {
      if (!isSelectableStart(next, todayIso)) {
        throw new Error(`Invalid plan start: ${next}`);
      }
      setChosen(next);
    },
    [todayIso],
  );
  const swapExercise = useCallback((original: string, replacement: string | null) => {
    if (replacement !== null && !isValidSwap(original, replacement)) {
      throw new Error(`Invalid exercise swap: ${original} -> ${replacement}`);
    }
    setSwaps((current) => {
      const next: Record<string, string> = { ...current };
      if (replacement === null) delete next[original];
      else next[original] = replacement;
      return next;
    });
  }, []);
  return { plan, setStart, swapExercise };
}
