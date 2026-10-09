import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ids, samples, uuid } from '../__fixtures__/samples.js';
import { EXERCISE_CATALOG } from '../catalog/index.js';
import {
  GoalSchema,
  PlannedExerciseRowSchema,
  PlannedExerciseSchema,
  PlannedSessionRowSchema,
  PlanRowSchema,
  PlanSchema,
  PlanWeekRowSchema,
  ProfileRowSchema,
  ProfileSchema,
  ScheduleChangeRowSchema,
  SetLogRowSchema,
  SetLogSchema,
  WorkoutLogRowSchema,
  WorkoutLogSchema,
  ageOn,
  checkProfile,
  createCatalogValidators,
  type Plan,
} from './index.js';

/** Batch 1 rework (review B1, B2 and should-fix items). */

function issues(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

function ok(schema: z.ZodType, value: unknown): void {
  expect(schema.safeParse(value).error?.issues).toBeUndefined();
}

const validators = createCatalogValidators(EXERCISE_CATALOG);

/** A plan with `weekCount` consecutive empty-ish weeks after the fixture week. */
function planWithWeeks(weekCount: number): Plan {
  const plan = samples.plan();
  for (let index = 1; index < weekCount; index += 1) {
    plan.weeks.push({
      id: uuid(200 + index),
      plan_id: ids.plan,
      index,
      start_date: ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'][index] ?? '',
      phase: 'accumulation',
      sessions: [],
    });
  }
  return plan;
}

describe('B1: timed work (measure = seconds)', () => {
  const twentyMinutesBike = {
    ...samples.plannedExercise(),
    exercise_id: 'stationary_bike',
    measure: 'seconds' as const,
    sets: 1,
    rep_min: 1200,
    rep_max: 1200,
    rest_sec: 0,
  };
  const { target_load_kg: _load, ...bikePrescription } = twentyMinutesBike;

  it('accepts a 20-minute cardio prescription, also against the catalog', () => {
    ok(PlannedExerciseSchema, bikePrescription);
    ok(validators.PlannedExercise, bikePrescription);
  });

  it('accepts a logged 20-minute cardio set inside a workout log', () => {
    const log = samples.workoutLog();
    log.sets = [
      {
        ...samples.setLog(),
        exercise_id: 'stationary_bike',
        measure: 'seconds',
        reps: 1200,
        load_kg: 0,
      },
    ];
    ok(WorkoutLogSchema, log);
    ok(validators.WorkoutLog, log);
  });

  it('caps seconds at 3600 and reps at 300', () => {
    expect(issues(PlannedExerciseSchema, { ...bikePrescription, rep_max: 3601 })).toContain(
      'rep_max: Too big: expected number to be <=3600',
    );
    expect(
      issues(PlannedExerciseSchema, { ...samples.plannedExercise(), rep_min: 1200, rep_max: 1200 }),
    ).toEqual(['rep_max: rep_max must be at most 300 for measure "reps"']);
    expect(issues(SetLogSchema, { ...samples.setLog(), reps: 301 })).toEqual([
      'reps: reps must be at most 300 for measure "reps"',
    ]);
    ok(SetLogSchema, { ...samples.setLog(), measure: 'seconds', reps: 3600 });
  });
});

describe('row schemas (flat, unrefined)', () => {
  it('support omit/partial/extend without throwing', () => {
    expect(() => PlanRowSchema.omit({ id: true })).not.toThrow();
    expect(() => PlanWeekRowSchema.partial()).not.toThrow();
    expect(() => PlannedSessionRowSchema.omit({ id: true, plan_week_id: true })).not.toThrow();
    expect(() => PlannedExerciseRowSchema.partial()).not.toThrow();
    expect(() => WorkoutLogRowSchema.omit({ id: true })).not.toThrow();
    expect(() => SetLogRowSchema.omit({ id: true })).not.toThrow();
    expect(() => ScheduleChangeRowSchema.partial()).not.toThrow();
    expect(() => ProfileRowSchema.omit({ parq: true })).not.toThrow();
  });

  it('describe one table row: nested children are not part of the row', () => {
    const { weeks: _weeks, ...row } = samples.plan();
    ok(PlanRowSchema, row);
    expect(Object.keys(PlanRowSchema.shape)).not.toContain('weeks');
  });

  it('let forms re-apply the exported cross-field checks', () => {
    const OnboardingForm = ProfileRowSchema.omit({ user_id: true }).superRefine(checkProfile);
    const { user_id: _user, ...form } = samples.profile();
    ok(OnboardingForm, form);
    expect(issues(OnboardingForm, { ...form, days_per_week: 5 })).toEqual([
      'available_days: available_days must contain at least days_per_week (5) days',
    ]);
  });
});

describe('ids, time zone, birth year and goals', () => {
  it('requires UUID entity ids but keeps slug exercise ids', () => {
    expect(issues(GoalSchema, { ...samples.goal(), id: 'goal-1' })).toEqual(['id: Invalid UUID']);
    ok(PlannedExerciseSchema, samples.plannedExercise());
  });

  it('requires a valid IANA time zone', () => {
    ok(ProfileSchema, { ...samples.profile(), timezone: 'America/New_York' });
    expect(issues(ProfileSchema, { ...samples.profile(), timezone: 'Bratislava' })).toEqual([
      'timezone: Unknown IANA time zone',
    ]);
    const { timezone: _tz, ...withoutTimezone } = samples.profile();
    expect(issues(ProfileSchema, withoutTimezone)[0]).toMatch(/^timezone:/);
  });

  it('rejects a birth year in the future', () => {
    const nextYear = new Date().getUTCFullYear() + 1;
    expect(issues(ProfileSchema, { ...samples.profile(), birth_year: nextYear })).toEqual([
      'birth_year: birth_year must not be in the future',
    ]);
  });

  it('ageOn returns the age reached in that calendar year', () => {
    expect(ageOn({ birth_year: 1990 }, '2026-10-08')).toBe(36);
    expect(ageOn({ birth_year: 2008 }, '2026-01-01')).toBe(18);
    expect(() => ageOn({ birth_year: 1990 }, '08.10.2026')).toThrow(RangeError);
  });

  it('only accepts goal types the MVP engine serves', () => {
    for (const type of ['strength', 'hypertrophy', 'fat_loss', 'general']) {
      ok(GoalSchema, { ...samples.goal(), type });
    }
    for (const type of ['endurance', 'hybrid']) {
      expect(issues(GoalSchema, { ...samples.goal(), type })[0]).toMatch(/^type:/);
    }
  });
});

describe('week and date invariants', () => {
  it('accepts consecutive Monday-aligned weeks', () => {
    ok(PlanSchema, planWithWeeks(3));
  });

  it('rejects weeks that are not 7 days apart', () => {
    const plan = planWithWeeks(3);
    const third = plan.weeks[2];
    if (!third) throw new Error('fixture shape changed');
    third.start_date = '2026-10-26';
    expect(issues(PlanSchema, plan)).toEqual([
      'weeks.2.start_date: Weeks must be consecutive (each start_date 7 days after the previous one)',
    ]);
  });

  it('rejects a plan start_date that differs from the first week', () => {
    expect(issues(PlanSchema, { ...samples.plan(), start_date: '2026-10-12' })).toEqual([
      'start_date: Plan start_date must equal the first week start_date',
    ]);
  });

  it('rejects a session scheduled outside its week (no cross-week moves)', () => {
    const plan = samples.plan();
    const session = plan.weeks[0]?.sessions[0];
    if (!session) throw new Error('fixture shape changed');
    session.scheduled_date = '2026-10-11'; // Sunday: still in the week
    ok(PlanSchema, plan);
    session.scheduled_date = '2026-10-12'; // next Monday
    expect(issues(PlanSchema, plan)).toEqual([
      'weeks.0.sessions.0.scheduled_date: scheduled_date must fall within the week starting 2026-10-05',
    ]);
  });
});

describe('uniqueness and set consistency', () => {
  it('requires is_key on planned exercises', () => {
    const { is_key: _key, ...pe } = samples.plannedExercise();
    expect(issues(PlannedExerciseSchema, pe)[0]).toMatch(/^is_key:/);
  });

  it('rejects a duplicate (exercise_id, set_index) pair in a workout log', () => {
    const log = samples.workoutLog();
    log.sets.push({ ...samples.setLog(), id: ids.other1 });
    expect(issues(WorkoutLogSchema, log)).toEqual([
      'sets: Duplicate (exercise_id, set_index) pairs: goblet_squat#0',
    ]);
    const nextSet = samples.workoutLog();
    nextSet.sets.push({ ...samples.setLog(), id: ids.other1, set_index: 1 });
    ok(WorkoutLogSchema, nextSet);
  });

  it('rejects a completed set with 0 reps', () => {
    expect(issues(SetLogSchema, { ...samples.setLog(), reps: 0, completed: true })).toEqual([
      'completed: A set with 0 reps cannot be completed',
    ]);
  });

  it('rejects session and planned exercise ids duplicated across weeks', () => {
    const plan = planWithWeeks(2);
    const firstSession = plan.weeks[0]?.sessions[0];
    const secondWeek = plan.weeks[1];
    if (!firstSession || !secondWeek) throw new Error('fixture shape changed');
    secondWeek.sessions.push({
      ...structuredClone(firstSession),
      plan_week_id: secondWeek.id,
      scheduled_date: '2026-10-12',
    });
    expect(issues(PlanSchema, plan)).toEqual([
      `weeks: Duplicate session (plan-wide) ids: ${ids.session}`,
      `weeks: Duplicate planned exercise (plan-wide) ids: ${ids.pe1}, ${ids.pe2}`,
    ]);
  });
});

describe('catalog validators: measure and loadability', () => {
  it('rejects a prescription whose measure differs from the catalog', () => {
    const plank = { ...samples.plannedExercise(), exercise_id: 'plank' };
    const { target_load_kg: _load, ...pe } = plank;
    expect(issues(validators.PlannedExercise, pe)).toEqual([
      'measure: "plank" is measured in seconds, not reps',
    ]);
    ok(validators.PlannedExercise, { ...pe, measure: 'seconds', rep_min: 20, rep_max: 40 });
  });

  it('rejects target_load_kg on a non-loadable exercise', () => {
    const pe = { ...samples.plannedExercise(), exercise_id: 'push_up', target_load_kg: 10 };
    expect(issues(validators.PlannedExercise, pe)).toEqual([
      'target_load_kg: "push_up" is not loadable, so target_load_kg must not be set',
    ]);
  });

  it('reports measure mismatches with their full path inside a workout log', () => {
    const log = samples.workoutLog();
    log.sets.push({
      ...samples.setLog(),
      id: ids.other1,
      exercise_id: 'plank',
      measure: 'reps',
      load_kg: 0,
    });
    expect(issues(validators.WorkoutLog, log)).toEqual([
      'sets.1.measure: "plank" is measured in seconds, not reps',
    ]);
  });
});
