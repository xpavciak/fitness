import type { Exercise, ExerciseId } from '../schemas/index.js';
import { EXERCISES } from './exercises.js';

/** The seed exercise catalog (validated by tests against ExerciseCatalogSchema). */
export const EXERCISE_CATALOG: readonly Exercise[] = EXERCISES;

const byId = new Map<ExerciseId, Exercise>(
  EXERCISE_CATALOG.map((exercise) => [exercise.id, exercise]),
);

/** Looks up a catalog exercise; returns undefined for unknown ids. */
export function getExerciseById(id: ExerciseId): Exercise | undefined {
  return byId.get(id);
}
