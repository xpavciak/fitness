import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ids, samples } from '../__fixtures__/samples.js';
import {
  ExerciseSchema,
  GoalSchema,
  PlannedExerciseSchema,
  PlanSchema,
  ProfileSchema,
  ScheduleChangeSchema,
  SetLogSchema,
  WorkoutLogSchema,
  parqHasRedFlag,
  parqRedFlags,
} from './index.js';

/** Returns the issue paths (joined with '.') of a failed parse; fails the test if parsing succeeds. */
function issuePaths(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('valid samples are accepted', () => {
  it.each([
    ['Profile', ProfileSchema, samples.profile()],
    ['Goal', GoalSchema, samples.goal()],
    ['Exercise', ExerciseSchema, samples.exercise()],
    ['PlannedExercise', PlannedExerciseSchema, samples.plannedExercise()],
    ['Plan', PlanSchema, samples.plan()],
    ['SetLog', SetLogSchema, samples.setLog()],
    ['WorkoutLog', WorkoutLogSchema, samples.workoutLog()],
    ['ScheduleChange', ScheduleChangeSchema, samples.scheduleChange()],
  ] as const)('%s', (_name, schema, value) => {
    const result = schema.safeParse(value);
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('accepts a profile with no training slots and no optional body data', () => {
    const { sex: _sex, height_cm: _h, weight_kg: _w, ...profile } = samples.profile();
    expect(ProfileSchema.safeParse({ ...profile, training_slots: [] }).success).toBe(true);
  });

  it('accepts rep_min equal to rep_max', () => {
    const pe = { ...samples.plannedExercise(), rep_min: 10, rep_max: 10 };
    expect(PlannedExerciseSchema.safeParse(pe).success).toBe(true);
  });

  it('accepts a failed set with zero reps and a skip change without a target date', () => {
    expect(SetLogSchema.safeParse({ ...samples.setLog(), reps: 0, completed: false }).success).toBe(
      true,
    );
    const { to_date: _to, ...skip } = { ...samples.scheduleChange(), kind: 'skip' as const };
    expect(ScheduleChangeSchema.safeParse(skip).success).toBe(true);
  });
});

describe('SetLog / WorkoutLog', () => {
  it('rejects negative reps', () => {
    expect(issuePaths(SetLogSchema, { ...samples.setLog(), reps: -1 })).toContain('reps');
  });

  it('rejects negative load, fractional reps and out-of-range RIR', () => {
    expect(issuePaths(SetLogSchema, { ...samples.setLog(), load_kg: -2.5 })).toContain('load_kg');
    expect(issuePaths(SetLogSchema, { ...samples.setLog(), reps: 8.5 })).toContain('reps');
    expect(issuePaths(SetLogSchema, { ...samples.setLog(), rir: 11 })).toContain('rir');
  });

  it('rejects negative reps nested inside a workout log', () => {
    const log = samples.workoutLog();
    log.sets[0] = { ...samples.setLog(), reps: -3 };
    expect(issuePaths(WorkoutLogSchema, log)).toContain('sets.0.reps');
  });

  it('rejects ended_at before started_at and mismatched parent ids', () => {
    const log = { ...samples.workoutLog(), ended_at: '2026-10-05T06:00:00Z' };
    expect(issuePaths(WorkoutLogSchema, log)).toContain('ended_at');
    const orphan = samples.workoutLog();
    orphan.sets[0] = { ...samples.setLog(), workout_log_id: ids.other1 };
    expect(issuePaths(WorkoutLogSchema, orphan)).toContain('sets.0.workout_log_id');
  });

  it('rejects a malformed exercise id', () => {
    expect(
      issuePaths(SetLogSchema, { ...samples.setLog(), exercise_id: 'Goblet Squat' }),
    ).toContain('exercise_id');
  });
});

describe('PlannedExercise / Plan', () => {
  it('rejects rep_min > rep_max', () => {
    const pe = { ...samples.plannedExercise(), rep_min: 12, rep_max: 8 };
    expect(issuePaths(PlannedExerciseSchema, pe)).toEqual(['rep_min']);
  });

  it('rejects rep_min > rep_max nested in a plan', () => {
    const plan = samples.plan();
    const session = plan.weeks[0]?.sessions[0];
    if (!session) throw new Error('fixture missing session');
    session.exercises[0] = { ...samples.plannedExercise(), rep_min: 15, rep_max: 5 };
    expect(issuePaths(PlanSchema, plan)).toContain('weeks.0.sessions.0.exercises.0.rep_min');
  });

  it('rejects zero sets, target RIR above 5 and negative rest', () => {
    const base = samples.plannedExercise();
    expect(issuePaths(PlannedExerciseSchema, { ...base, sets: 0 })).toContain('sets');
    expect(issuePaths(PlannedExerciseSchema, { ...base, target_rir: 6 })).toContain('target_rir');
    expect(issuePaths(PlannedExerciseSchema, { ...base, rest_sec: -30 })).toContain('rest_sec');
  });

  it('rejects out-of-order week indexes and duplicate exercise order', () => {
    const plan = samples.plan();
    const week = plan.weeks[0];
    const session = week?.sessions[0];
    if (!week || !session) throw new Error('fixture missing week/session');
    week.index = 1;
    session.exercises.forEach((pe) => (pe.order = 0));
    const paths = issuePaths(PlanSchema, plan);
    expect(paths).toContain('weeks.0.index');
    expect(paths).toContain('weeks.0.sessions.0.exercises');
  });

  it('rejects an invalid calendar date and an empty plan', () => {
    expect(issuePaths(PlanSchema, { ...samples.plan(), start_date: '2026-02-30' })).toContain(
      'start_date',
    );
    expect(issuePaths(PlanSchema, { ...samples.plan(), weeks: [] })).toContain('weeks');
  });
});

describe('Profile', () => {
  it('rejects fewer available days than days_per_week', () => {
    const profile = { ...samples.profile(), days_per_week: 5 };
    expect(issuePaths(ProfileSchema, profile)).toContain('available_days');
  });

  it('rejects a training slot on a day that is not available, and duplicate slot days', () => {
    const profile = samples.profile();
    profile.training_slots.push({ day: 'sun', start_time: '09:00', location: 'park' });
    expect(issuePaths(ProfileSchema, profile)).toContain('training_slots.3.day');

    const dup = samples.profile();
    dup.training_slots.push({ day: 'mon', start_time: '19:00', location: 'gym' });
    expect(issuePaths(ProfileSchema, dup)).toContain('training_slots');
  });

  it('rejects bad times, unknown equipment and too-short sessions', () => {
    const p = samples.profile();
    const badTime = {
      ...p,
      training_slots: [{ day: 'mon', start_time: '7:00', location: 'home' }],
    };
    expect(issuePaths(ProfileSchema, badTime)).toContain('training_slots.0.start_time');
    expect(issuePaths(ProfileSchema, { ...p, equipment: ['rowing_boat'] })).toContain(
      'equipment.0',
    );
    expect(issuePaths(ProfileSchema, { ...p, session_minutes: 5 })).toContain('session_minutes');
  });

  it('rejects a profile without PAR-Q+ answers', () => {
    const { parq: _parq, ...profile } = samples.profile();
    expect(issuePaths(ProfileSchema, profile)).toContain('parq');
  });

  it('flags any PAR-Q+ "yes" answer', () => {
    const profile = samples.profile();
    expect(parqHasRedFlag(profile.parq)).toBe(false);
    profile.parq.chest_pain = true;
    profile.parq.medically_supervised_activity_only = true;
    expect(parqHasRedFlag(profile.parq)).toBe(true);
    expect(parqRedFlags(profile.parq)).toEqual([
      'chest_pain',
      'medically_supervised_activity_only',
    ]);
  });
});

describe('Exercise', () => {
  it('rejects bodyweight combined with other equipment', () => {
    const exercise = { ...samples.exercise(), equipment: ['bodyweight', 'dumbbells'] };
    expect(issuePaths(ExerciseSchema, exercise)).toContain('equipment');
  });

  it('rejects self-substitution, empty primary muscles and missing cues', () => {
    const base = samples.exercise();
    expect(issuePaths(ExerciseSchema, { ...base, substitutes: [base.id] })).toContain(
      'substitutes',
    );
    expect(issuePaths(ExerciseSchema, { ...base, primary_muscles: [] })).toContain(
      'primary_muscles',
    );
    expect(issuePaths(ExerciseSchema, { ...base, cues: [] })).toContain('cues');
  });

  it('rejects a muscle listed as both primary and secondary', () => {
    const exercise = { ...samples.exercise(), secondary_muscles: ['quads'] };
    expect(issuePaths(ExerciseSchema, exercise)).toContain('secondary_muscles');
  });
});

describe('ScheduleChange', () => {
  it('requires to_date for a move and rejects a no-op move', () => {
    const { to_date: _to, ...move } = samples.scheduleChange();
    expect(issuePaths(ScheduleChangeSchema, move)).toContain('to_date');
    const noop = { ...samples.scheduleChange(), to_date: '2026-10-05' };
    expect(issuePaths(ScheduleChangeSchema, noop)).toContain('to_date');
  });

  it('requires merged_into_session_id for a merge and new_est_minutes for a shorten', () => {
    const base = samples.scheduleChange();
    expect(issuePaths(ScheduleChangeSchema, { ...base, kind: 'merge' })).toContain(
      'merged_into_session_id',
    );
    expect(issuePaths(ScheduleChangeSchema, { ...base, kind: 'shorten' })).toContain(
      'new_est_minutes',
    );
  });

  it('rejects merging a session into itself and an empty reason', () => {
    const base = samples.scheduleChange();
    const self = { ...base, kind: 'merge', merged_into_session_id: base.planned_session_id };
    expect(issuePaths(ScheduleChangeSchema, self)).toContain('merged_into_session_id');
    expect(issuePaths(ScheduleChangeSchema, { ...base, reason: '  ' })).toContain('reason');
  });
});
