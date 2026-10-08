import type { z } from 'zod';
import type { Exercise } from './exercise.js';
import { PlannedExerciseSchema, PlannedSessionSchema, PlanSchema, PlanWeekSchema } from './plan.js';
import { SetLogSchema, WorkoutLogSchema } from './workout.js';

type IssuePath = (string | number)[];

interface ExerciseReference {
  exercise_id: string;
  path: IssuePath;
}

function unknownIdIssue(id: string, path: IssuePath) {
  return {
    code: 'custom' as const,
    path,
    message: `Unknown exercise_id "${id}" (not in the exercise catalog)`,
  };
}

function plannedExerciseRefs(
  exercises: readonly { exercise_id: string }[],
  prefix: IssuePath,
): ExerciseReference[] {
  return exercises.map((exercise, index) => ({
    exercise_id: exercise.exercise_id,
    path: [...prefix, index, 'exercise_id'],
  }));
}

/**
 * Builds schemas that, on top of the structural checks, reject any `exercise_id`
 * that is not present in the given catalog. Use these at every boundary where
 * plans or logs enter the engine (LLM output, storage, sync).
 */
export function createCatalogValidators(catalog: readonly Pick<Exercise, 'id'>[]) {
  const knownIds = new Set(catalog.map((exercise) => exercise.id));

  const check = (refs: ExerciseReference[], ctx: z.RefinementCtx) => {
    for (const ref of refs) {
      if (!knownIds.has(ref.exercise_id)) {
        ctx.addIssue(unknownIdIssue(ref.exercise_id, ref.path));
      }
    }
  };

  return {
    isKnownExerciseId: (id: string): boolean => knownIds.has(id),

    PlannedExercise: PlannedExerciseSchema.superRefine((pe, ctx) => {
      check([{ exercise_id: pe.exercise_id, path: ['exercise_id'] }], ctx);
    }),

    PlannedSession: PlannedSessionSchema.superRefine((session, ctx) => {
      check(plannedExerciseRefs(session.exercises, ['exercises']), ctx);
    }),

    PlanWeek: PlanWeekSchema.superRefine((week, ctx) => {
      check(
        week.sessions.flatMap((session, s) =>
          plannedExerciseRefs(session.exercises, ['sessions', s, 'exercises']),
        ),
        ctx,
      );
    }),

    Plan: PlanSchema.superRefine((plan, ctx) => {
      check(
        plan.weeks.flatMap((week, w) =>
          week.sessions.flatMap((session, s) =>
            plannedExerciseRefs(session.exercises, ['weeks', w, 'sessions', s, 'exercises']),
          ),
        ),
        ctx,
      );
    }),

    SetLog: SetLogSchema.superRefine((set, ctx) => {
      check([{ exercise_id: set.exercise_id, path: ['exercise_id'] }], ctx);
    }),

    WorkoutLog: WorkoutLogSchema.superRefine((log, ctx) => {
      check(plannedExerciseRefs(log.sets, ['sets']), ctx);
    }),
  };
}

export type CatalogValidators = ReturnType<typeof createCatalogValidators>;
