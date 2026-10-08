import { createSeededIdGenerator, type WorkoutLog } from '@fitness/engine';
import { describe, expect, it } from 'vitest';
import { at, onboardedPlan, TIMEZONE, must } from '../test/fixtures';
import { markSessionDone } from './actions';
import { sessionsByDate } from './plan-view';
import { adherenceSummary, exerciseProgress, reflectionWeekIndex } from './progress';

const { plan, outcome } = onboardedPlan({ equipment: ['dumbbells', 'bench'] });
const userId = outcome.profile.user_id;
const week0 = sessionsByDate(must(plan.weeks[0]));
const newId = createSeededIdGenerator(21);

function dumbbellLog(sessionId: string, date: string, load: number, reps: number): WorkoutLog {
  const id = newId();
  return {
    id,
    user_id: userId,
    planned_session_id: sessionId,
    started_at: at(date),
    ended_at: at(date, '11:00:00'),
    sets: [0, 1].map((set_index) => ({
      id: newId(),
      workout_log_id: id,
      exercise_id: 'goblet_squat',
      set_index,
      measure: 'reps' as const,
      reps,
      load_kg: load,
      is_warmup: false,
      completed: true,
      performed_at: at(date, '10:10:00'),
    })),
  };
}

describe('adherenceSummary', () => {
  it('reports the weekly percentage and the streak', () => {
    const logs = week0.map((session) => dumbbellLog(session.id, session.scheduled_date, 16, 8));
    const done = logs.reduce((current, log) => markSessionDone(current, log), plan);
    const summary = adherenceSummary(done, outcome.profile, logs, '2026-10-18', []);
    expect(summary.thisWeek).toEqual({ percentage: 100, completed: 3, planned: 3 });
    expect(summary.streak).toMatchObject({ current: 1, best: 1, current_week_met: true });
    expect(summary.stats.overall.percentage).toBe(100);
    expect(summary.reflection).toMatchObject({ weekIndex: 0, source: 'template' });
    expect(summary.reflection.text).toMatch(/all 3 planned sessions in week 1/);
  });

  it('counts missed sessions and has no current week before the plan starts', () => {
    const missed = adherenceSummary(plan, outcome.profile, [], '2026-10-18', []);
    expect(missed.thisWeek).toEqual({ percentage: 0, completed: 0, planned: 3 });
    expect(missed.streak.current).toBe(0);
    const before = adherenceSummary(plan, outcome.profile, [], '2026-10-08', []);
    expect(before.thisWeek).toBeNull();
    expect(before.stats.overall.percentage).toBeNull();
    // Before the plan starts, the reflection looks ahead at week 1.
    expect(before.reflection.weekIndex).toBe(0);
    expect(before.reflection.text).toMatch(/has not started yet/);
  });
});

describe('exerciseProgress', () => {
  it('lists e1RM, PRs and the trend per exercise', () => {
    const logs = [
      dumbbellLog(must(week0[0]).id, must(week0[0]).scheduled_date, 16, 8),
      dumbbellLog(must(week0[1]).id, must(week0[1]).scheduled_date, 20, 8),
    ];
    const [row] = exerciseProgress(logs, TIMEZONE);
    expect(row).toMatchObject({
      exerciseId: 'goblet_squat',
      name: 'Dumbbell Goblet Squat',
      bestLoadKg: 20,
      bestReps: 8,
      bestE1rmKg: 25.3,
      e1rmChangePct: 25,
    });
    expect(row?.e1rmHistory.map((point) => point.date)).toEqual([
      must(week0[0]).scheduled_date,
      must(week0[1]).scheduled_date,
    ]);
  });

  it('is empty without logs', () => {
    expect(exerciseProgress([], TIMEZONE)).toEqual([]);
  });
});

describe('reflectionWeekIndex', () => {
  it('prefers the current week, then the latest finished one', () => {
    const during = adherenceSummary(plan, outcome.profile, [], '2026-10-21', []);
    expect(reflectionWeekIndex(during.stats)).toBe(1);
    const after = adherenceSummary(plan, outcome.profile, [], '2027-03-01', []);
    expect(reflectionWeekIndex(after.stats)).toBe(plan.weeks.length - 1);
  });
});
