import type { Exercise, PlannedExerciseRow, SessionVariant } from '../schemas/index.js';

/**
 * Session time model (used by plan generation, shortening and the minimum dose):
 *
 *   seconds = warm-up(variant)
 *           + sum over exercises of [ TRANSITION + sets x (sides x work + rest_sec) ]
 *
 * - work: reps x SECONDS_PER_REP for rep-based sets (reps = midpoint of rep_min..rep_max,
 *   rounded); the midpoint in seconds for timed sets.
 * - sides: 2 for unilateral exercises (sets are per side), otherwise 1.
 * - rest_sec is counted after every set, including the last (it covers moving on).
 * - TRANSITION covers setup and loading per exercise.
 * - warm-up: 5 min for full sessions (it includes ramp-up sets for key lifts),
 *   3 min for short sessions and 2 min for the minimum dose.
 *
 * `est_minutes` is `Math.round(seconds / 60)`, at least 1.
 */
export const TIME_MODEL = {
  secondsPerRep: 3,
  transitionSec: 30,
  warmupSec: { full: 300, short: 180, minimum_dose: 120 } satisfies Record<SessionVariant, number>,
} as const;

type TimedExercise = Pick<
  PlannedExerciseRow,
  'sets' | 'measure' | 'rep_min' | 'rep_max' | 'rest_sec'
>;

/** Seconds of work in one set (both sides for unilateral exercises). */
export function setWorkSeconds(
  pe: Pick<PlannedExerciseRow, 'measure' | 'rep_min' | 'rep_max'>,
  exercise: Pick<Exercise, 'unilateral'>,
): number {
  const midpoint = Math.round((pe.rep_min + pe.rep_max) / 2);
  const perSide = pe.measure === 'reps' ? midpoint * TIME_MODEL.secondsPerRep : midpoint;
  return perSide * (exercise.unilateral ? 2 : 1);
}

/** Seconds one additional set adds (work + rest). */
export function secondsPerSet(pe: TimedExercise, exercise: Pick<Exercise, 'unilateral'>): number {
  return setWorkSeconds(pe, exercise) + pe.rest_sec;
}

/** Seconds for one exercise block, including the transition. */
export function exerciseSeconds(pe: TimedExercise, exercise: Pick<Exercise, 'unilateral'>): number {
  return TIME_MODEL.transitionSec + pe.sets * secondsPerSet(pe, exercise);
}

export function estimateSessionSeconds(
  exercises: readonly (TimedExercise & Pick<PlannedExerciseRow, 'exercise_id'>)[],
  variant: SessionVariant,
  lookup: (id: string) => Pick<Exercise, 'unilateral'>,
): number {
  return exercises.reduce(
    (total, pe) => total + exerciseSeconds(pe, lookup(pe.exercise_id)),
    TIME_MODEL.warmupSec[variant],
  );
}

export function secondsToEstMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

export function estimateSessionMinutes(
  exercises: readonly (TimedExercise & Pick<PlannedExerciseRow, 'exercise_id'>)[],
  variant: SessionVariant,
  lookup: (id: string) => Pick<Exercise, 'unilateral'>,
): number {
  return secondsToEstMinutes(estimateSessionSeconds(exercises, variant, lookup));
}
