import { z } from 'zod';
import { ExerciseIdSchema, IdSchema, IsoDateTimeSchema } from './common.js';

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
 * One performed set. For exercises measured in seconds, `reps` holds seconds.
 * `load_kg` is the external load (0 for bodyweight).
 */
export const SetLogSchema = z.object({
  id: IdSchema,
  workout_log_id: IdSchema,
  exercise_id: ExerciseIdSchema,
  /** The prescription this set fulfils; absent for substituted or added exercises. */
  planned_exercise_id: IdSchema.optional(),
  set_index: z.int().min(0),
  reps: z.int().min(0).max(1000),
  load_kg: z.number().min(0).max(1000),
  /** Reps in reserve as reported by the user; absent if not entered. */
  rir: z.int().min(0).max(MAX_LOGGED_RIR).optional(),
  is_warmup: z.boolean(),
  /** false = the set was failed or abandoned before reaching the target. */
  completed: z.boolean(),
  performed_at: IsoDateTimeSchema,
});
export type SetLog = z.infer<typeof SetLogSchema>;

export const WorkoutLogSchema = z
  .object({
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
    sets: z.array(SetLogSchema),
  })
  .superRefine((log, ctx) => {
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
  });
export type WorkoutLog = z.infer<typeof WorkoutLogSchema>;
