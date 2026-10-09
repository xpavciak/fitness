import type { z } from 'zod';
import type { Exercise, ExerciseMeasure } from './exercise.js';
import { PlannedExerciseSchema, PlannedSessionSchema, PlanSchema, PlanWeekSchema } from './plan.js';
import { SetLogSchema, WorkoutLogSchema } from './workout.js';

type IssuePath = (string | number)[];
type CatalogEntry = Pick<Exercise, 'id' | 'measure' | 'loadable'>;

/** The fields of a prescription or set log that must agree with the catalog. */
interface ExerciseReference {
  exercise_id: string;
  measure: ExerciseMeasure;
  /** Only prescriptions carry a target load. */
  target_load_kg?: number | undefined;
}

interface LocatedReference {
  ref: ExerciseReference;
  path: IssuePath;
}

function located(refs: readonly ExerciseReference[], prefix: IssuePath): LocatedReference[] {
  return refs.map((ref, index) => ({ ref, path: [...prefix, index] }));
}

/**
 * Builds schemas that, on top of the structural checks, verify every exercise reference
 * against the catalog:
 * - `exercise_id` exists in the catalog;
 * - `measure` equals the catalog exercise's measure (reps vs seconds);
 * - `target_load_kg` is not set for a non-loadable exercise.
 * Use these at every boundary where plans or logs enter the engine (LLM output, storage, sync).
 */
export function createCatalogValidators(catalog: readonly CatalogEntry[]) {
  const byId = new Map<string, CatalogEntry>(catalog.map((exercise) => [exercise.id, exercise]));

  const check = (refs: readonly LocatedReference[], ctx: z.RefinementCtx) => {
    for (const { ref, path } of refs) {
      const exercise = byId.get(ref.exercise_id);
      if (!exercise) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'exercise_id'],
          message: `Unknown exercise_id "${ref.exercise_id}" (not in the exercise catalog)`,
        });
        continue;
      }
      if (ref.measure !== exercise.measure) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'measure'],
          message: `"${exercise.id}" is measured in ${exercise.measure}, not ${ref.measure}`,
        });
      }
      if (ref.target_load_kg !== undefined && !exercise.loadable) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'target_load_kg'],
          message: `"${exercise.id}" is not loadable, so target_load_kg must not be set`,
        });
      }
    }
  };

  return {
    isKnownExerciseId: (id: string): boolean => byId.has(id),

    PlannedExercise: PlannedExerciseSchema.superRefine((pe, ctx) => {
      check([{ ref: pe, path: [] }], ctx);
    }),

    PlannedSession: PlannedSessionSchema.superRefine((session, ctx) => {
      check(located(session.exercises, ['exercises']), ctx);
    }),

    PlanWeek: PlanWeekSchema.superRefine((week, ctx) => {
      check(
        week.sessions.flatMap((session, s) =>
          located(session.exercises, ['sessions', s, 'exercises']),
        ),
        ctx,
      );
    }),

    Plan: PlanSchema.superRefine((plan, ctx) => {
      check(
        plan.weeks.flatMap((week, w) =>
          week.sessions.flatMap((session, s) =>
            located(session.exercises, ['weeks', w, 'sessions', s, 'exercises']),
          ),
        ),
        ctx,
      );
    }),

    SetLog: SetLogSchema.superRefine((set, ctx) => {
      check([{ ref: set, path: [] }], ctx);
    }),

    WorkoutLog: WorkoutLogSchema.superRefine((log, ctx) => {
      check(located(log.sets, ['sets']), ctx);
    }),
  };
}

export type CatalogValidators = ReturnType<typeof createCatalogValidators>;
