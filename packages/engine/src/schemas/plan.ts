import { z } from 'zod';
import { addDays, isMonday, isWithinWeek } from '../dates.js';
import {
  DayIndexSchema,
  ExerciseIdSchema,
  IdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  findDuplicates,
} from './common.js';
import { ExerciseMeasureSchema, MAX_SECONDS_PER_SET, maxPerSet } from './exercise.js';

/*
 * Each entity has:
 * - `XRowSchema`: a flat, unrefined `z.object` (one Supabase row; safe for `.omit()`,
 *   `.partial()` and `.extend()` in forms and storage code), and
 * - `XSchema`: the nested, refined schema used at engine boundaries.
 * The `checkX` functions hold the cross-field rules so derived schemas can re-apply them.
 */

type Ctx = z.RefinementCtx;

function reportDuplicateIds(
  ids: readonly string[],
  path: (string | number)[],
  what: string,
  ctx: Ctx,
): void {
  const duplicates = findDuplicates(ids);
  if (duplicates.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path,
      message: `Duplicate ${what} ids: ${duplicates.join(', ')}`,
    });
  }
}

export const MAX_TARGET_RIR = 5;

// ---------------------------------------------------------------------------
// PlannedExercise
// ---------------------------------------------------------------------------

/**
 * One exercise prescription inside a planned session.
 * `rep_min`/`rep_max` are reps or seconds depending on `measure`, which must match the
 * catalog exercise (checked by `createCatalogValidators`).
 *
 * Load convention: `target_load_kg` is per implement (per dumbbell/kettlebell); for a
 * barbell it is the total including the bar. See `loads.ts`.
 */
export const PlannedExerciseRowSchema = z.object({
  id: IdSchema,
  planned_session_id: IdSchema,
  exercise_id: ExerciseIdSchema,
  order: z.int().min(0),
  sets: z.int().min(1).max(10),
  measure: ExerciseMeasureSchema,
  rep_min: z.int().min(1).max(MAX_SECONDS_PER_SET),
  rep_max: z.int().min(1).max(MAX_SECONDS_PER_SET),
  /** Target reps in reserve (0 = to failure). */
  target_rir: z.int().min(0).max(MAX_TARGET_RIR),
  /** Working load in kg; omitted for bodyweight or not-yet-calibrated exercises. */
  target_load_kg: z.number().min(0).max(1000).optional(),
  rest_sec: z.int().min(0).max(600),
  /** Exercises sharing a group label are performed as a superset. */
  superset_group: z.string().trim().min(1).max(8).optional(),
  /** Priority exercise: kept first when a session is shortened or merged. */
  is_key: z.boolean(),
});
export type PlannedExerciseRow = z.infer<typeof PlannedExerciseRowSchema>;

export function checkPlannedExercise(
  pe: Pick<PlannedExerciseRow, 'rep_min' | 'rep_max' | 'measure'>,
  ctx: Ctx,
): void {
  if (pe.rep_min > pe.rep_max) {
    ctx.addIssue({
      code: 'custom',
      path: ['rep_min'],
      message: 'rep_min must be less than or equal to rep_max',
    });
  }
  const max = maxPerSet(pe.measure);
  if (pe.rep_max > max) {
    ctx.addIssue({
      code: 'custom',
      path: ['rep_max'],
      message: `rep_max must be at most ${max} for measure "${pe.measure}"`,
    });
  }
}

export const PlannedExerciseSchema = PlannedExerciseRowSchema.superRefine(checkPlannedExercise);
export type PlannedExercise = z.infer<typeof PlannedExerciseSchema>;

// ---------------------------------------------------------------------------
// PlannedSession
// ---------------------------------------------------------------------------

export const SESSION_PRIORITIES = ['key', 'normal', 'optional'] as const;
export const SessionPrioritySchema = z.enum(SESSION_PRIORITIES);
export type SessionPriority = z.infer<typeof SessionPrioritySchema>;

/**
 * Session status and its adherence semantics (feature D, T7):
 * - `planned`: not done yet. A planned session whose `scheduled_date` is in the past is
 *   **missed**; "missed" is derived, never stored.
 * - `done`: completed; counts as planned and completed.
 * - `moved`: rescheduled to a new `scheduled_date` (a ScheduleChange records the old date).
 *   It still counts as planned and only counts as completed once it becomes `done`.
 * - `merged`: absorbed into another session of the same week. It counts as completed when
 *   the absorbing session is `done` (and not separately as planned-but-missed).
 * - `skipped`: deliberately dropped; counts as planned and not completed.
 */
export const SESSION_STATUSES = ['planned', 'done', 'skipped', 'moved', 'merged'] as const;
export const SessionStatusSchema = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/** `short` is the ~30-minute version, `minimum_dose` the 10-15 minute version (feature C). */
export const SESSION_VARIANTS = ['full', 'short', 'minimum_dose'] as const;
export const SessionVariantSchema = z.enum(SESSION_VARIANTS);
export type SessionVariant = z.infer<typeof SessionVariantSchema>;

/**
 * Rescheduling never crosses a week boundary in the MVP: a moved session keeps a
 * `scheduled_date` inside its own week (enforced by `checkPlanWeek`).
 */
export const PlannedSessionRowSchema = z.object({
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
});
export type PlannedSessionRow = z.infer<typeof PlannedSessionRowSchema>;

export const PlannedSessionSchema = PlannedSessionRowSchema.extend({
  exercises: z.array(PlannedExerciseSchema),
}).superRefine(checkPlannedSession);
export type PlannedSession = z.infer<typeof PlannedSessionSchema>;

export function checkPlannedSession(
  session: PlannedSessionRow & { exercises: readonly PlannedExerciseRow[] },
  ctx: Ctx,
): void {
  session.exercises.forEach((exercise, index) => {
    if (exercise.planned_session_id !== session.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['exercises', index, 'planned_session_id'],
        message: 'planned_session_id must match the parent session id',
      });
    }
  });
  reportDuplicateIds(
    session.exercises.map((exercise) => exercise.id),
    ['exercises'],
    'planned exercise',
    ctx,
  );
  if (findDuplicates(session.exercises.map((exercise) => exercise.order)).length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['exercises'],
      message: 'Exercise order values must be unique within a session',
    });
  }
}

// ---------------------------------------------------------------------------
// PlanWeek
// ---------------------------------------------------------------------------

export const PLAN_PHASES = ['accumulation', 'intensification', 'deload'] as const;
export const PlanPhaseSchema = z.enum(PLAN_PHASES);
export type PlanPhase = z.infer<typeof PlanPhaseSchema>;

export const PlanWeekRowSchema = z.object({
  id: IdSchema,
  plan_id: IdSchema,
  /** 0-based position of the week in the plan. */
  index: z.int().min(0),
  /** Monday of this week. */
  start_date: IsoDateSchema,
  phase: PlanPhaseSchema,
  focus: z.string().trim().max(120).optional(),
});
export type PlanWeekRow = z.infer<typeof PlanWeekRowSchema>;

export function checkPlanWeek(
  week: PlanWeekRow & { sessions: readonly PlannedSessionRow[] },
  ctx: Ctx,
): void {
  const startIsValid = isMonday(week.start_date);
  if (!startIsValid) {
    ctx.addIssue({
      code: 'custom',
      path: ['start_date'],
      message: 'Week start_date must be a Monday',
    });
  }
  week.sessions.forEach((session, index) => {
    if (session.plan_week_id !== week.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['sessions', index, 'plan_week_id'],
        message: 'plan_week_id must match the parent week id',
      });
    }
    if (!isWithinWeek(session.scheduled_date, week.start_date)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sessions', index, 'scheduled_date'],
        message: `scheduled_date must fall within the week starting ${week.start_date}`,
      });
    }
  });
  reportDuplicateIds(
    week.sessions.map((session) => session.id),
    ['sessions'],
    'session',
    ctx,
  );
}

export const PlanWeekSchema = PlanWeekRowSchema.extend({
  sessions: z.array(PlannedSessionSchema),
}).superRefine(checkPlanWeek);
export type PlanWeek = z.infer<typeof PlanWeekSchema>;

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export const PLAN_STATUSES = ['active', 'archived'] as const;
export const PlanStatusSchema = z.enum(PLAN_STATUSES);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const PLAN_GENERATORS = ['rules', 'llm_hybrid'] as const;
export const PlanGeneratorSchema = z.enum(PLAN_GENERATORS);
export type PlanGenerator = z.infer<typeof PlanGeneratorSchema>;

/** A versioned training plan. Changes create a new version or ScheduleChange records. */
export const PlanRowSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  goal_id: IdSchema,
  template_id: z.string().trim().min(1).max(64).optional(),
  version: z.int().min(1),
  status: PlanStatusSchema,
  /** Monday of the first week; equals `weeks[0].start_date`. */
  start_date: IsoDateSchema,
  generated_by: PlanGeneratorSchema,
  rationale_text: z.string().max(4000).optional(),
  created_at: IsoDateTimeSchema,
});
export type PlanRow = z.infer<typeof PlanRowSchema>;

export function checkPlan(
  plan: PlanRow & {
    weeks: readonly (PlanWeekRow & {
      sessions: readonly (PlannedSessionRow & { exercises: readonly PlannedExerciseRow[] })[];
    })[];
  },
  ctx: Ctx,
): void {
  const firstWeek = plan.weeks[0];
  if (firstWeek && firstWeek.start_date !== plan.start_date) {
    ctx.addIssue({
      code: 'custom',
      path: ['start_date'],
      message: 'Plan start_date must equal the first week start_date',
    });
  }
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
    if (firstWeek && index > 0 && week.start_date !== addDays(firstWeek.start_date, 7 * index)) {
      ctx.addIssue({
        code: 'custom',
        path: ['weeks', index, 'start_date'],
        message: 'Weeks must be consecutive (each start_date 7 days after the previous one)',
      });
    }
  });
  reportDuplicateIds(
    plan.weeks.map((week) => week.id),
    ['weeks'],
    'week',
    ctx,
  );
  // Ids must also be unique across weeks (within a week this is reported by checkPlanWeek).
  const sessions = plan.weeks.flatMap((week) => week.sessions);
  reportDuplicateIds(
    sessions.map((session) => session.id),
    ['weeks'],
    'session (plan-wide)',
    ctx,
  );
  reportDuplicateIds(
    sessions.flatMap((session) => session.exercises.map((exercise) => exercise.id)),
    ['weeks'],
    'planned exercise (plan-wide)',
    ctx,
  );
}

export const PlanSchema = PlanRowSchema.extend({
  weeks: z.array(PlanWeekSchema).min(1).max(16),
}).superRefine(checkPlan);
export type Plan = z.infer<typeof PlanSchema>;
