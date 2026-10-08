import { createSeededIdGenerator, WorkoutLogSchema, type WorkoutLog } from '@fitness/engine';
import { describe, expect, it } from 'vitest';
import { at, onboardedPlan, TIMEZONE, must } from '../test/fixtures';
import { markSessionDone } from './actions';
import { findSession, sessionsByDate } from './plan-view';
import {
  buildWorkoutDraft,
  completedSetCount,
  formatSeconds,
  parseLoad,
  parseWholeNumber,
  restRemaining,
  stepRir,
  summarizeLog,
  toggleSetCompleted,
  updateSet,
  workoutLogFromDraft,
  type WorkoutDraft,
} from './workout';

const { plan, outcome } = onboardedPlan();
const [first, second] = sessionsByDate(must(plan.weeks[0]));
const userId = outcome.profile.user_id;

function draftFor(
  session = must(first),
  history: WorkoutLog[] = [],
  date = session.scheduled_date,
): WorkoutDraft {
  return buildWorkoutDraft(session, history, {
    today: date,
    timezone: TIMEZONE,
    now: at(date),
    newId: createSeededIdGenerator(7),
  });
}

/** Completes every set with the prefilled values, filling missing loads with `load`. */
function completeAll(draft: WorkoutDraft, now: string, load = '10'): WorkoutDraft {
  let result = draft;
  draft.exercises.forEach((exercise, e) => {
    exercise.sets.forEach((set, s) => {
      if (set.loadKg === '') {
        result = updateSet(result, e, s, (current) => ({ ...current, loadKg: load }));
      }
      const toggled = toggleSetCompleted(result, e, s, now);
      if (!toggled.ok) {
        throw new Error(toggled.error);
      }
      result = toggled.draft;
    });
  });
  return result;
}

describe('buildWorkoutDraft', () => {
  it('prefills every set from nextTargets', () => {
    const draft = draftFor();
    expect(draft.exercises).toHaveLength(must(first).exercises.length);
    for (const exercise of draft.exercises) {
      expect(exercise.sets).toHaveLength(exercise.targets.sets);
      expect(exercise.targets.decision).toBe('start');
      for (const set of exercise.sets) {
        expect(set.reps).toBe(String(exercise.targets.target_reps));
        expect(set.rir).toBe(exercise.targets.target_rir);
        expect(set.loadKg).toBe(exercise.loadable ? '' : '0');
      }
    }
  });

  it('progresses from the previous workout', () => {
    const done = completeAll(draftFor(), at(must(first).scheduled_date, '10:30:00'));
    const log = workoutLogFromDraft(done, {
      userId,
      endedAt: at(must(first).scheduled_date, '11:00:00'),
    });
    const next = draftFor(must(first), [log], '2026-10-19');
    const loadable = next.exercises.find((exercise) => exercise.loadable);
    expect(loadable?.targets.decision).not.toBe('start');
    expect(loadable?.sets[0]?.loadKg).not.toBe('');
  });
});

describe('toggleSetCompleted', () => {
  it('validates inputs before completing', () => {
    const draft = draftFor();
    const e = draft.exercises.findIndex((exercise) => exercise.loadable);
    expect(e).toBeGreaterThanOrEqual(0);
    const noLoad = toggleSetCompleted(draft, e, 0, at('2026-10-12'));
    expect(noLoad).toEqual({ ok: false, error: 'Enter the load in kg (0 for bodyweight).' });
    const zeroReps = updateSet(draft, e, 0, (set) => ({ ...set, reps: '0', loadKg: '12' }));
    expect(toggleSetCompleted(zeroReps, e, 0, at('2026-10-12'))).toMatchObject({ ok: false });
    expect(toggleSetCompleted(draft, 99, 0, at('2026-10-12'))).toEqual({
      ok: false,
      error: 'Unknown set.',
    });
  });

  it('completes in one tap, starts the rest timer and can be undone', () => {
    const draft = updateSet(draftFor(), 0, 0, (set) => ({ ...set, loadKg: '12.5' }));
    const done = toggleSetCompleted(draft, 0, 0, at('2026-10-12', '10:05:00'));
    if (!done.ok) {
      throw new Error(done.error);
    }
    expect(done.restSec).toBe(must(draft.exercises[0]).planned.rest_sec);
    expect(done.draft.exercises[0]?.sets[0]).toMatchObject({
      completed: true,
      performedAt: at('2026-10-12', '10:05:00'),
    });
    expect(completedSetCount(done.draft)).toBe(1);
    if (must(draft.exercises[0]).loadable) {
      // The load carries forward to the next empty sets.
      expect(done.draft.exercises[0]?.sets[1]?.loadKg).toBe('12.5');
    }
    const undone = toggleSetCompleted(done.draft, 0, 0, at('2026-10-12', '10:06:00'));
    expect(undone.ok && completedSetCount(undone.draft)).toBe(0);
  });
});

describe('workoutLogFromDraft', () => {
  it('saves only completed sets as a schema-valid WorkoutLog', () => {
    const draft = updateSet(draftFor(), 0, 0, (set) => ({
      ...set,
      loadKg: '12,5',
      rir: undefined,
    }));
    const toggled = toggleSetCompleted(draft, 0, 0, at('2026-10-12', '10:05:00'));
    if (!toggled.ok) {
      throw new Error(toggled.error);
    }
    const log = workoutLogFromDraft(toggled.draft, {
      userId,
      endedAt: at('2026-10-12', '10:40:00'),
    });
    expect(WorkoutLogSchema.parse(log)).toEqual(log);
    expect(log.planned_session_id).toBe(must(first).id);
    expect(log.sets).toHaveLength(1);
    const loadable = must(draft.exercises[0]).loadable;
    expect(log.sets[0]).toMatchObject({
      set_index: 0,
      load_kg: loadable ? 12.5 : 0,
      completed: true,
      is_warmup: false,
    });
    expect(log.sets[0]).not.toHaveProperty('rir');
  });

  it('refuses to save an empty workout', () => {
    expect(() =>
      workoutLogFromDraft(draftFor(), { userId, endedAt: at('2026-10-12', '11:00:00') }),
    ).toThrow(/at least one set/);
  });

  it('never ends before it started (clock changes)', () => {
    const done = completeAll(draftFor(), at(must(first).scheduled_date, '10:30:00'));
    const log = workoutLogFromDraft(done, { userId, endedAt: '2026-10-01T00:00:00.000Z' });
    expect(log.ended_at).toBe(log.started_at);
  });
});

describe('markSessionDone', () => {
  it('marks the logged session done and leaves others alone', () => {
    const done = completeAll(draftFor(must(second)), at(must(second).scheduled_date, '10:30:00'));
    const log = workoutLogFromDraft(done, {
      userId,
      endedAt: at(must(second).scheduled_date, '11:00:00'),
    });
    const updated = markSessionDone(plan, log);
    expect(findSession(updated, must(second).id)?.session.status).toBe('done');
    expect(findSession(updated, must(first).id)?.session.status).toBe('planned');
    // Idempotent: logging the same session again keeps it done.
    expect(markSessionDone(updated, log)).toEqual(updated);
  });
});

describe('number inputs and the rest timer', () => {
  it('parses whole numbers and loads', () => {
    expect(parseWholeNumber(' 8 ')).toBe(8);
    expect(parseWholeNumber('8.5')).toBeUndefined();
    expect(parseWholeNumber('')).toBeUndefined();
    expect(parseLoad('22,5')).toBe(22.5);
    expect(parseLoad('-5')).toBeUndefined();
    expect(parseLoad('1001')).toBeUndefined();
  });

  it('counts the rest down and formats it', () => {
    expect(restRemaining(90, 0, 0)).toBe(90);
    expect(restRemaining(90, 0, 30_500)).toBe(60);
    expect(restRemaining(90, 0, 120_000)).toBe(0);
    expect(formatSeconds(75)).toBe('1:15');
    expect(formatSeconds(5)).toBe('0:05');
  });
});

describe('stepRir', () => {
  it('stays at 0 on minus and caps at the maximum', () => {
    expect(stepRir(0, -1)).toBe(0);
    expect(stepRir(2, -1)).toBe(1);
    expect(stepRir(5, 1)).toBe(5);
    expect(stepRir(undefined, 1)).toBe(0);
    expect(stepRir(undefined, -1)).toBeUndefined();
  });
});

describe('summarizeLog (read-only view of a done session)', () => {
  it('groups sets by exercise with reps, load and RIR', () => {
    const done = completeAll(draftFor(), at(must(first).scheduled_date, '10:30:00'), '12');
    const log = workoutLogFromDraft(done, {
      userId,
      endedAt: at(must(first).scheduled_date, '11:00:00'),
    });
    const summary = summarizeLog(log);
    expect(summary.map((entry) => entry.exerciseId)).toEqual(
      done.exercises.map((exercise) => exercise.planned.exercise_id),
    );
    const firstExercise = must(done.exercises[0]);
    expect(summary[0]?.sets).toHaveLength(firstExercise.sets.length);
    expect(summary[0]?.sets[0]).toBe(
      `${firstExercise.sets[0]?.reps} reps${firstExercise.loadable ? ' × 12 kg' : ''} · RIR ${firstExercise.targets.target_rir}`,
    );
  });
});
