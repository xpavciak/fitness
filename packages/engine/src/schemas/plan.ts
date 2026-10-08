import { z } from 'zod';
import {
  DayIndexSchema,
  ExerciseIdSchema,
  IdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  hasNoDuplicates,
} from './common.js';

export const MAX_TARGET_RIR = 5;

/**
 * One exercise prescription inside a planned session.
 * For exercises measured in seconds, `rep_min`/`rep_max` are seconds.
 */
export const PlannedExerciseSchema = z
  .object({
    id: IdSchema,
    planned_session_id: IdSchema,
    exercise_id: ExerciseIdSchema,
    order: z.int().min(0),
    sets: z.int().min(1).max(10),
    rep_min: z.int().min(1).max(300),
    rep_max: z.int().min(1).max(300),
    /** Target reps in reserve (0 = to failure). */
    target_rir: z.int().min(0).max(MAX_TARGET_RIR),
    /** Working load in kg; omitted for bodyweight or not-yet-calibrated exercises. */
    target_load_kg: z.number().min(0).max(1000).optional(),
    rest_sec: z.int().min(0).max(600),
    /** Exercises sharing a group label are performed as a superset. */
    superset_group: z.string().trim().min(1).max(8).optional(),
  })
  .refine((pe) => pe.rep_min <= pe.rep_max, {
    path: ['rep_min'],
    message: 'rep_min must be less than or equal to rep_max',
  });
export type PlannedExercise = z.infer<typeof PlannedExerciseSchema>;

export const SESSION_PRIORITIES = ['key', 'normal', 'optional'] as const;
export const SessionPrioritySchema = z.enum(SESSION_PRIORITIES);
export type SessionPriority = z.infer<typeof SessionPrioritySchema>;

export const SESSION_STATUSES = ['planned', 'done', 'skipped', 'moved', 'merged'] as const;
export const SessionStatusSchema = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/** `short` is the ~30-minute version, `minimum_dose` the 10-15 minute version (feature C). */
export const SESSION_VARIANTS = ['full', 'short', 'minimum_dose'] as const;
export const SessionVariantSchema = z.enum(SESSION_VARIANTS);
export type SessionVariant = z.infer<typeof SessionVariantSchema>;

export const PlannedSessionSchema = z
  .object({
    id: IdSchema,
    plan_week_id: IdSchema,
    /** Template slot within the week (0 = Monday). Unchanged when the session is moved. */
    day_index: DayIndexSchema,
    scheduled_date: IsoDateSchema,
    title: z.string().trim().min(1).max(80),
    est_minutes: z.int().min(1).max(240),
    priority: SessionPrioritySchema,
    status: SessionStatusSchema,
    variant: SessionVariantSchema,
    exercises: z.array(PlannedExerciseSchema),
  })
  .superRefine((session, ctx) => {
    session.exercises.forEach((exercise, index) => {
      if (exercise.planned_session_id !== session.id) {
        ctx.addIssue({
          code: 'custom',
          path: ['exercises', index, 'planned_session_id'],
          message: 'planned_session_id must match the parent session id',
        });
      }
    });
    if (!hasNoDuplicates(session.exercises.map((exercise) => exercise.order))) {
      ctx.addIssue({
        code: 'custom',
        path: ['exercises'],
        message: 'Exercise order values must be unique within a session',
      });
    }
  });
export type PlannedSession = z.infer<typeof PlannedSessionSchema>;

export const PLAN_PHASES = ['accumulation', 'intensification', 'deload'] as const;
export const PlanPhaseSchema = z.enum(PLAN_PHASES);
export type PlanPhase = z.infer<typeof PlanPhaseSchema>;

export const PlanWeekSchema = z
  .object({
    id: IdSchema,
    plan_id: IdSchema,
    /** 0-based position of the week in the plan. */
    index: z.int().min(0),
    /** Monday of this week. */
    start_date: IsoDateSchema,
    phase: PlanPhaseSchema,
    focus: z.string().trim().max(120).optional(),
    sessions: z.array(PlannedSessionSchema),
  })
  .superRefine((week, ctx) => {
    week.sessions.forEach((session, index) => {
      if (session.plan_week_id !== week.id) {
        ctx.addIssue({
          code: 'custom',
          path: ['sessions', index, 'plan_week_id'],
          message: 'plan_week_id must match the parent week id',
        });
      }
    });
  });
export type PlanWeek = z.infer<typeof PlanWeekSchema>;

export const PLAN_STATUSES = ['active', 'archived'] as const;
export const PlanStatusSchema = z.enum(PLAN_STATUSES);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const PLAN_GENERATORS = ['rules', 'llm_hybrid'] as const;
export const PlanGeneratorSchema = z.enum(PLAN_GENERATORS);
export type PlanGenerator = z.infer<typeof PlanGeneratorSchema>;

/** A versioned training plan. Changes create a new version or ScheduleChange records. */
export const PlanSchema = z
  .object({
    id: IdSchema,
    user_id: IdSchema,
    goal_id: IdSchema,
    template_id: z.string().trim().min(1).max(64).optional(),
    version: z.int().min(1),
    status: PlanStatusSchema,
    start_date: IsoDateSchema,
    generated_by: PlanGeneratorSchema,
    rationale_text: z.string().max(4000).optional(),
    created_at: IsoDateTimeSchema,
    weeks: z.array(PlanWeekSchema).min(1).max(16),
  })
  .superRefine((plan, ctx) => {
    plan.weeks.forEach((week, index) => {
      if (week.plan_id !== plan.id) {
        ctx.addIssue({
          code: 'custom',
          path: ['weeks', index, 'plan_id'],
          message: 'plan_id must match the parent plan id',
        });
      }
      if (week.index !== index) {
        ctx.addIssue({
          code: 'custom',
          path: ['weeks', index, 'index'],
          message: `Week index must be ${index} (weeks are ordered and 0-based)`,
        });
      }
    });
  });
export type Plan = z.infer<typeof PlanSchema>;
