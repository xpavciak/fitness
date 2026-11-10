import { requireExercise } from './exercises';
import type { DayPlan, StrengthItem, WorkoutItem, WorkoutSection } from './types';

/** Time to unrack/set up before each set. */
export const SETUP_SECONDS_PER_SET = 20;
/** Extra time to switch sides on unilateral exercises. */
export const SIDE_SWITCH_SECONDS = 10;

/** Seconds per repetition from a tempo string such as "3-1-1". */
export function secondsPerRep(tempo: string): number {
  const parts = tempo.split('-').map(Number);
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error(`Invalid tempo: ${tempo}`);
  }
  return Math.max(
    1,
    parts.reduce((sum, n) => sum + n, 0),
  );
}

/**
 * Seconds a strength item takes: work + setup for every set, plus rest after
 * every set (the last rest doubles as transition to the next exercise).
 */
export function strengthItemSeconds(item: StrengthItem): number {
  if (item.sets < 1) throw new Error(`Invalid set count for ${item.exerciseId}`);
  const exercise = requireExercise(item.exerciseId);
  const sides = exercise.unilateral ? 2 : 1;
  const work = item.workSecondsPerSet * sides + (sides - 1) * SIDE_SWITCH_SECONDS;
  return item.sets * (work + SETUP_SECONDS_PER_SET + item.restSeconds);
}

export function itemSeconds(item: WorkoutItem): number {
  return item.kind === 'strength' ? strengthItemSeconds(item) : item.minutes * 60;
}

export function sectionMinutes(section: WorkoutSection): number {
  return section.items.reduce((sum, item) => sum + itemSeconds(item), 0) / 60;
}

/** Estimated session length in whole minutes (rounded to the nearest 5 is done in UI). */
export function estimateMinutes(sections: WorkoutSection[]): number {
  return Math.round(sections.reduce((sum, s) => sum + sectionMinutes(s), 0));
}

export function totalSets(day: Pick<DayPlan, 'sections'>): number {
  return day.sections
    .flatMap((s) => s.items)
    .reduce((sum, item) => sum + (item.kind === 'strength' ? item.sets : 0), 0);
}
