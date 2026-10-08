import { z } from 'zod';
import { ExerciseIdSchema, IdSchema, IsoDateTimeSchema, findDuplicates } from './common.js';
import { ExerciseMeasureSchema, MAX_SECONDS_PER_SET, maxPerSet } from './exercise.js';

/** 1 (worst) to 5 (best); for soreness and stress 5 means "very high". */
const RatingSchema = z.int().min(1).max(5);

export const PreCheckinSchema = z.object({
  sleep: RatingSchema,
  energy: RatingSchema,
  soreness: RatingSchema,
  stress: RatingSchema,
});
export type PreCheckin = z.infer<typeof PreCheckinSchema>;

export const MAX_LOGGED_RIR = 10;

/**
 * One performed set. `reps` holds reps or seconds depending on `measure`, which must match
 * the catalog exercise (checked by `createCatalogValidators`).
 *
 * Load convention: `load_kg` is per implement (per dumbbell/kettlebell, i.e. per hand);
 * for a barbell it is the total including the bar; 0 for bodyweight. See `loads.ts`.
 */
export const SetLogRowSchema = z.object({
  id: IdSchema,
  workout_log_id: IdSchema,
  exercise_id: ExerciseIdSchema,
  /** The prescription this set fulfils; absent for substituted or added exercises. */
  planned_exercise_id: IdSchema.optional(),
  set_index: z.int().min(0),
  measure: ExerciseMeasureSchema,
  reps: z.int().min(0).max(MAX_SECONDS_PER_SET),
  load_kg: z.number().min(0).max(1000),
  /** Reps in reserve as reported by the user; absent if not entered. */
  rir: z.int().min(0).max(MAX_LOGGED_RIR).optional(),
  is_warmup: z.boolean(),
  /** false = the set was failed or abandoned before reaching the target. */
  completed: z.boolean(),
  performed_at: IsoDateTimeSchema,
});
export type SetLogRow = z.infer<typeof SetLogRowSchema>;

export function checkSetLog(
  set: Pick<SetLogRow, 'reps' | 'measure' | 'completed'>,
  ctx: z.RefinementCtx,
): void {
  const max = maxPerSet(set.measure);
  if (set.reps > max) {
    ctx.addIssue({
      code: 'custom',
      path: ['reps'],
      message: `reps must be at most ${max} for measure "${set.measure}"`,
    });
  }
  if (set.completed && set.reps === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['completed'],
      message: 'A set with 0 reps cannot be completed',
    });
  }
}

export const SetLogSchema = SetLogRowSchema.superRefine(checkSetLog);
export type SetLog = z.infer<typeof SetLogSchema>;

export const WorkoutLogRowSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  /** Absent for unplanned (ad-hoc) workouts. */
  planned_session_id: IdSchema.optional(),
  started_at: IsoDateTimeSchema,
  ended_at: IsoDateTimeSchema.optional(),
  pre_checkin: PreCheckinSchema.optional(),
  /** Session RPE, 1-10. */
  session_rpe: z.int().min(1).max(10).optional(),
  notes: z.string().max(1000).optional(),
});
export type WorkoutLogRow = z.infer<typeof WorkoutLogRowSchema>;

export function checkWorkoutLog(
  log: WorkoutLogRow & { sets: readonly SetLogRow[] },
  ctx: z.RefinementCtx,
): void {
  if (log.ended_at !== undefined && Date.parse(log.ended_at) < Date.parse(log.started_at)) {
    ctx.addIssue({
      code: 'custom',
      path: ['ended_at'],
      message: 'ended_at must not be before started_at',
    });
  }
  log.sets.forEach((set, index) => {
    if (set.workout_log_id !== log.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['sets', index, 'workout_log_id'],
        message: 'workout_log_id must match the parent workout log id',
      });
    }
  });
  const duplicateIds = findDuplicates(log.sets.map((set) => set.id));
  if (duplicateIds.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['sets'],
      message: `Duplicate set ids: ${duplicateIds.join(', ')}`,
    });
  }
  const duplicateSlots = findDuplicates(
    log.sets.map((set) => `${set.exercise_id}#${set.set_index}`),
  );
  if (duplicateSlots.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['sets'],
      message: `Duplicate (exercise_id, set_index) pairs: ${duplicateSlots.join(', ')}`,
    });
  }
}

export const WorkoutLogSchema = WorkoutLogRowSchema.extend({
  sets: z.array(SetLogSchema),
}).superRefine(checkWorkoutLog);
export type WorkoutLog = z.infer<typeof WorkoutLogSchema>;
