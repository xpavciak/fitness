import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ids, samples } from '../__fixtures__/samples.js';
import { EXERCISE_CATALOG } from '../catalog/index.js';
import {
  GoalSchema,
  IdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  ParqAnswersSchema,
  PlannedExerciseSchema,
  PlanSchema,
  ProfileSchema,
  ScheduleChangeSchema,
  SetLogSchema,
  TimeOfDaySchema,
  WorkoutLogSchema,
  createCatalogValidators,
} from './index.js';

/** QA edge-case probes (batch 1, T2) beyond the developer's own tests. */

function accepts(schema: z.ZodType, value: unknown): void {
  const result = schema.safeParse(value);
  expect(result.error?.issues).toBeUndefined();
}

function rejects(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('non-finite numbers', () => {
  it.each([NaN, Infinity, -Infinity])('rejects load_kg = %s on a set log', (load) => {
    expect(rejects(SetLogSchema, { ...samples.setLog(), load_kg: load })).toEqual(['load_kg']);
  });

  it.each([NaN, Infinity])('rejects target_load_kg = %s on a planned exercise', (load) => {
    expect(
      rejects(PlannedExerciseSchema, { ...samples.plannedExercise(), target_load_kg: load }),
    ).toEqual(['target_load_kg']);
  });

  it('rejects NaN reps and NaN body weight, and numeric strings', () => {
    rejects(SetLogSchema, { ...samples.setLog(), reps: NaN });
    rejects(ProfileSchema, { ...samples.profile(), weight_kg: NaN });
    rejects(SetLogSchema, { ...samples.setLog(), load_kg: '12' });
  });

  it('accepts zero and fractional loads', () => {
    accepts(SetLogSchema, { ...samples.setLog(), load_kg: 0 });
    accepts(SetLogSchema, { ...samples.setLog(), load_kg: 1.25 });
  });
});

describe('empty and whitespace-only strings', () => {
  it.each(['', '   '])('rejects id %j', (id) => {
    rejects(IdSchema, id);
  });

  it('rejects empty exercise_id, slot location, goal target, superset group and change reason', () => {
    rejects(SetLogSchema, { ...samples.setLog(), exercise_id: '' });
    const profile = samples.profile();
    profile.training_slots[0] = { day: 'mon', start_time: '07:00', location: '  ' };
    expect(rejects(ProfileSchema, profile)).toEqual(['training_slots.0.location']);
    rejects(GoalSchema, { ...samples.goal(), target: '' });
    rejects(PlannedExerciseSchema, { ...samples.plannedExercise(), superset_group: '' });
    rejects(ScheduleChangeSchema, { ...samples.scheduleChange(), reason: ' \n ' });
  });

  it('rejects non-slug exercise ids', () => {
    for (const id of ['Goblet Squat', 'goblet-squat', '_squat', 'squat_', 'drep_č']) {
      rejects(PlannedExerciseSchema, { ...samples.plannedExercise(), exercise_id: id });
    }
  });

  it('accepts UUIDs and rejects free-text entity ids (ids are client-generated UUIDs)', () => {
    accepts(IdSchema, ids.user);
    rejects(IdSchema, 'užívateľ-1');
    rejects(IdSchema, 'week-1');
  });
});

describe('dates and times', () => {
  it.each([
    '2026-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-1-5',
    '20261005',
    '',
    '2026-10-05T00:00:00Z',
  ])('rejects calendar date %j', (value) => {
    rejects(IsoDateSchema, value);
  });

  it('accepts a leap day', () => {
    accepts(IsoDateSchema, '2024-02-29');
  });

  it.each([
    '2026-10-05T07:10:00',
    '2026-10-05T25:00:00Z',
    '2026-02-30T07:00:00Z',
    '2026-10-05 07:10:00Z',
    '2026-10-05T07:10:00+0200',
    'not a date',
  ])('rejects datetime %j', (value) => {
    rejects(IsoDateTimeSchema, value);
  });

  it('accepts datetimes with offsets and fractional seconds', () => {
    accepts(IsoDateTimeSchema, '2026-10-05T07:10:00+02:00');
    accepts(IsoDateTimeSchema, '2026-10-05T07:10:00.123Z');
  });

  it.each(['24:00', '7:00', '07:60', '07:00:00', ''])('rejects time of day %j', (value) => {
    rejects(TimeOfDaySchema, value);
  });

  it('accepts 00:00 and 23:59', () => {
    accepts(TimeOfDaySchema, '00:00');
    accepts(TimeOfDaySchema, '23:59');
  });

  it('compares ended_at and started_at as instants across time zones', () => {
    // 08:30+02:00 is 06:30Z, i.e. before the 07:00Z start.
    expect(
      rejects(WorkoutLogSchema, {
        ...samples.workoutLog(),
        started_at: '2026-10-05T07:00:00Z',
        ended_at: '2026-10-05T08:30:00+02:00',
      }),
    ).toEqual(['ended_at']);
    // 09:00+02:00 is 07:00Z, before the 07:30Z end.
    accepts(WorkoutLogSchema, {
      ...samples.workoutLog(),
      started_at: '2026-10-05T09:00:00+02:00',
      ended_at: '2026-10-05T07:30:00Z',
    });
  });
});

describe('PAR-Q+ answers', () => {
  it('rejects each missing answer individually', () => {
    const parq = samples.profile().parq;
    for (const key of Object.keys(parq)) {
      const partial: Record<string, unknown> = { ...parq };
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete partial[key];
      expect(rejects(ParqAnswersSchema, partial)).toEqual([key]);
    }
  });

  it('rejects null, string and numeric answers', () => {
    const parq = samples.profile().parq;
    for (const value of [null, 'no', 0, undefined]) {
      expect(rejects(ParqAnswersSchema, { ...parq, chest_pain: value })).toEqual(['chest_pain']);
    }
  });

  it('rejects an empty PAR-Q+ object inside a profile', () => {
    const paths = rejects(ProfileSchema, { ...samples.profile(), parq: {} });
    expect(paths).toHaveLength(8);
    expect(paths.every((path) => path.startsWith('parq.'))).toBe(true);
  });
});

describe('mismatched parent ids', () => {
  it('reports each level of mismatch in a plan with the full path', () => {
    const plan = samples.plan();
    const week = plan.weeks[0];
    const session = week?.sessions[0];
    const exercise = session?.exercises[1];
    if (!week || !session || !exercise) throw new Error('fixture shape changed');
    week.plan_id = ids.other1;
    session.plan_week_id = ids.other2;
    exercise.planned_session_id = ids.other3;
    expect(rejects(PlanSchema, plan).sort()).toEqual([
      'weeks.0.plan_id',
      'weeks.0.sessions.0.exercises.1.planned_session_id',
      'weeks.0.sessions.0.plan_week_id',
    ]);
  });

  it('rejects a set whose workout_log_id differs from its log', () => {
    const log = samples.workoutLog();
    log.sets.push({
      ...samples.setLog(),
      id: ids.other1,
      set_index: 1,
      workout_log_id: ids.other2,
    });
    expect(rejects(WorkoutLogSchema, log)).toEqual(['sets.1.workout_log_id']);
  });

  it('rejects ids with surrounding whitespace (UUIDs are not trimmed)', () => {
    const plan = samples.plan();
    const session = plan.weeks[0]?.sessions[0];
    if (!session) throw new Error('fixture shape changed');
    session.plan_week_id = ` ${ids.week} `;
    expect(rejects(PlanSchema, plan)).toContain('weeks.0.sessions.0.plan_week_id');
  });
});

describe('catalog validators', () => {
  const validators = createCatalogValidators(EXERCISE_CATALOG);

  it('does not treat Object.prototype keys as known ids', () => {
    for (const id of ['constructor', 'to_string', 'has_own_property']) {
      expect(validators.isKnownExerciseId(id)).toBe(false);
      rejects(validators.SetLog, { ...samples.setLog(), exercise_id: id });
    }
  });

  it('accepts every catalog id', () => {
    for (const exercise of EXERCISE_CATALOG) {
      const { target_load_kg: load, ...base } = samples.plannedExercise();
      accepts(validators.PlannedExercise, {
        ...base,
        ...(exercise.loadable ? { target_load_kg: load } : {}),
        exercise_id: exercise.id,
        measure: exercise.measure,
      });
    }
  });
});

/**
 * Formerly KNOWN GAPS (QA batch 1, written as `it.fails`). Fixed in the batch 1 rework,
 * so these are now regular tests.
 */
describe('fixed gaps: duplicate ids and week alignment', () => {
  function messages(schema: z.ZodType, value: unknown): string[] {
    const result = schema.safeParse(value);
    expect(result.success).toBe(false);
    return result.success
      ? []
      : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  }

  it('rejects duplicate session ids within a week', () => {
    const plan = samples.plan();
    const week = plan.weeks[0];
    const session = week?.sessions[0];
    if (!week || !session) throw new Error('fixture shape changed');
    week.sessions.push(structuredClone(session));
    expect(messages(PlanSchema, plan)).toContain(
      `weeks.0.sessions: Duplicate session ids: ${ids.session}`,
    );
  });

  it('rejects duplicate planned exercise ids within a session', () => {
    const plan = samples.plan();
    const session = plan.weeks[0]?.sessions[0];
    const second = session?.exercises[1];
    if (!second) throw new Error('fixture shape changed');
    second.id = ids.pe1;
    expect(messages(PlanSchema, plan)).toContain(
      `weeks.0.sessions.0.exercises: Duplicate planned exercise ids: ${ids.pe1}`,
    );
  });

  it('rejects duplicate week ids within a plan', () => {
    const plan = samples.plan();
    const week = plan.weeks[0];
    if (!week) throw new Error('fixture shape changed');
    // A structurally valid second week (dates shifted) that reuses the first week's id.
    const copy = structuredClone(week);
    copy.index = 1;
    copy.start_date = '2026-10-12';
    copy.sessions = [];
    plan.weeks.push(copy);
    expect(messages(PlanSchema, plan)).toEqual([`weeks: Duplicate week ids: ${ids.week}`]);
  });

  it('rejects duplicate set ids within a workout log', () => {
    const log = samples.workoutLog();
    log.sets.push({ ...samples.setLog(), set_index: 1 });
    expect(messages(WorkoutLogSchema, log)).toEqual([`sets: Duplicate set ids: ${ids.set1}`]);
  });

  it('rejects a week start_date that is not a Monday', () => {
    const plan = samples.plan();
    const week = plan.weeks[0];
    if (!week) throw new Error('fixture shape changed');
    week.start_date = '2026-10-06'; // Tuesday
    plan.start_date = '2026-10-06';
    week.sessions.forEach((session) => (session.scheduled_date = '2026-10-06'));
    expect(messages(PlanSchema, plan)).toEqual([
      'weeks.0.start_date: Week start_date must be a Monday',
    ]);
  });
});
