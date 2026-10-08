import { describe, expect, it } from 'vitest';
import { makeProfile, must, planFor } from '../__fixtures__/engine.js';
import { samples, uuid } from '../__fixtures__/samples.js';
import type { Plan, ScheduleChange, WorkoutLog } from '../schemas/index.js';
import {
  adherenceStats,
  weeklyStreak,
  type AdherenceStats,
  type WeekAdherence,
} from './adherence.js';

/** Full Body 3x on Mon/Wed/Fri; week 0 = 2026-10-12, week 1 = 2026-10-19. */
const basePlan = planFor(makeProfile());
const TZ = 'Europe/Bratislava';

function session(plan: Plan, week: number, index: number) {
  return must(must(plan.weeks[week]).sessions[index]);
}

let logCounter = 0;
/** A workout log without sets or end time, unlinked unless `planned_session_id` is given. */
function log(overrides: Partial<WorkoutLog> & { started_at: string }): WorkoutLog {
  logCounter += 1;
  const { planned_session_id: _session, ended_at: _end, ...base } = samples.workoutLog();
  return { ...base, id: uuid(7000 + logCounter), sets: [], ...overrides };
}

describe('adherenceStats', () => {
  it('counts done, logged, skipped, missed, moved and upcoming sessions per week', () => {
    const plan = structuredClone(basePlan);
    session(plan, 0, 0).status = 'done';
    // Week 0 B: still "planned" but a workout log is linked (synced before the status).
    session(plan, 0, 2).status = 'skipped';
    // Week 1 C moved from Friday to Saturday: planned until done.
    session(plan, 1, 2).status = 'moved';
    session(plan, 1, 2).scheduled_date = '2026-10-24';
    const logs = [
      log({ planned_session_id: session(plan, 0, 1).id, started_at: '2026-10-14T16:30:00Z' }),
    ];
    const stats = adherenceStats(plan, logs, { today: '2026-10-21', timezone: TZ, changes: [] });
    const [week0, week1, week2] = stats.weeks;
    // D11: the skipped session is neutral, so week 0 is 2 of 2 planned.
    expect(week0).toMatchObject({
      status: 'past',
      planned: 2,
      completed: 2,
      skipped: 1,
      missed: 0,
      upcoming: 0,
      percentage: 100,
    });
    // Today is Wednesday: Monday is missed, Wednesday (today) and the moved Saturday are upcoming.
    expect(week1).toMatchObject({
      status: 'current',
      planned: 3,
      completed: 0,
      missed: 1,
      upcoming: 2,
      percentage: 0,
    });
    expect(week2).toMatchObject({ status: 'future', planned: 3, upcoming: 3, missed: 0 });
    expect(stats.overall).toEqual({ due: 3, completed: 2, percentage: 67 });
  });

  it('D11: skipped sessions never count against adherence or break a streak', () => {
    const plan = structuredClone(basePlan);
    for (const session of must(plan.weeks[0]).sessions) {
      session.status = 'done';
    }
    for (const session of must(plan.weeks[1]).sessions) {
      session.status = 'skipped';
    }
    for (const session of must(plan.weeks[2]).sessions.slice(0, 2)) {
      session.status = 'done';
    }
    must(must(plan.weeks[2]).sessions[2]).status = 'skipped';
    const stats = adherenceStats(plan, [], { today: '2026-11-02', timezone: TZ, changes: [] });
    expect(
      stats.weeks.slice(0, 3).map((w) => [w.planned, w.completed, w.skipped, w.percentage]),
    ).toEqual([
      [3, 3, 0, 100],
      [0, 0, 3, null],
      [2, 2, 1, 100],
    ]);
    expect(stats.overall).toEqual({ due: 5, completed: 5, percentage: 100 });
    expect(weeklyStreak(stats)).toEqual({ current: 2, best: 2, current_week_met: false });
  });

  it('requires changes (pass [] explicitly)', () => {
    expect(() =>
      adherenceStats(basePlan, [], { today: '2026-10-21', timezone: TZ } as never),
    ).toThrow(/changes is required/);
  });

  it('counts a merged session as completed through the absorbing session', () => {
    const plan = structuredClone(basePlan);
    const merged = session(plan, 0, 0);
    const absorbing = session(plan, 0, 1);
    merged.status = 'merged';
    const change: ScheduleChange = {
      ...samples.scheduleChange(),
      plan_id: plan.id,
      planned_session_id: merged.id,
      kind: 'merge',
      from_date: merged.scheduled_date,
      merged_into_session_id: absorbing.id,
    };
    const { to_date: _drop, ...mergeChange } = change;

    absorbing.status = 'done';
    expect(
      adherenceStats(plan, [], { today: '2026-10-19', timezone: TZ, changes: [mergeChange] })
        .weeks[0],
    ).toMatchObject({
      planned: 3,
      completed: 2,
      missed: 1,
    });
    absorbing.status = 'planned'; // absorbing session on Wednesday, today Tuesday: both upcoming
    expect(
      adherenceStats(plan, [], { today: '2026-10-13', timezone: TZ, changes: [mergeChange] })
        .weeks[0],
    ).toMatchObject({
      upcoming: 3,
      missed: 0,
    });
    // Without the change record the merged Monday session is missed once Monday has passed.
    expect(
      adherenceStats(plan, [], { today: '2026-10-13', timezone: TZ, changes: [] }).weeks[0],
    ).toMatchObject({
      missed: 1,
      upcoming: 2,
    });
  });

  it('buckets unplanned workouts into weeks by the profile time zone', () => {
    // Sunday 23:30 UTC is already Monday 01:30 in Bratislava (next week).
    const logs = [log({ started_at: '2026-10-18T23:30:00Z' })];
    const local = adherenceStats(basePlan, logs, {
      today: '2026-10-21',
      timezone: TZ,
      changes: [],
    });
    expect(local.weeks.map((w) => w.unplanned_workouts)).toEqual([0, 1, 0, 0, 0, 0]);
    const utc = adherenceStats(basePlan, logs, {
      today: '2026-10-21',
      timezone: 'UTC',
      changes: [],
    });
    expect(utc.weeks.map((w) => w.unplanned_workouts)).toEqual([1, 0, 0, 0, 0, 0]);
  });

  it('treats logs for sessions of another plan as unplanned', () => {
    const logs = [log({ planned_session_id: uuid(999_999), started_at: '2026-10-13T08:00:00Z' })];
    const stats = adherenceStats(basePlan, logs, {
      today: '2026-10-21',
      timezone: TZ,
      changes: [],
    });
    expect(must(stats.weeks[0])).toMatchObject({ completed: 0, unplanned_workouts: 1 });
  });

  it('reports null percentages when nothing is due', () => {
    const stats = adherenceStats(basePlan, [], { today: '2026-10-01', timezone: TZ, changes: [] });
    expect(stats.overall).toEqual({ due: 0, completed: 0, percentage: null });
    expect(stats.weeks.every((w) => w.status === 'future')).toBe(true);
  });

  it('rejects an unknown time zone or invalid input', () => {
    expect(() =>
      adherenceStats(basePlan, [], { today: '2026-10-21', timezone: 'Mars/Base', changes: [] }),
    ).toThrow(RangeError);
    expect(() =>
      adherenceStats(basePlan, [], { today: '21.10.2026', timezone: TZ, changes: [] }),
    ).toThrow();
    expect(() =>
      adherenceStats({ ...basePlan, weeks: [] }, [], {
        today: '2026-10-21',
        timezone: TZ,
        changes: [],
      }),
    ).toThrow();
  });

  it('is deterministic', () => {
    expect(
      adherenceStats(basePlan, [], { today: '2026-11-30', timezone: TZ, changes: [] }),
    ).toEqual(adherenceStats(basePlan, [], { today: '2026-11-30', timezone: TZ, changes: [] }));
  });
});

describe('weeklyStreak', () => {
  const week = (
    status: WeekAdherence['status'],
    planned: number,
    completed: number,
    unplanned = 0,
  ): WeekAdherence => ({
    week_index: 0,
    start_date: '2026-10-12',
    status,
    planned,
    completed,
    missed: 0,
    skipped: 0,
    upcoming: 0,
    percentage: planned === 0 ? null : Math.round((100 * completed) / planned),
    unplanned_workouts: unplanned,
  });
  const stats = (weeks: WeekAdherence[]): AdherenceStats => ({
    today: '2026-11-01',
    timezone: TZ,
    weeks,
    overall: { due: 0, completed: 0, percentage: null },
  });

  it.each([
    [
      'all past weeks met',
      [week('past', 3, 3), week('past', 3, 3), week('past', 5, 4)],
      3,
      3,
      false,
    ],
    [
      'a missed week resets the streak',
      [week('past', 3, 3), week('past', 3, 1), week('past', 3, 3)],
      1,
      1,
      false,
    ],
    ['the current week counts once met', [week('past', 3, 3), week('current', 3, 3)], 2, 2, true],
    [
      'an unfinished current week does not break it',
      [week('past', 3, 3), week('past', 3, 3), week('current', 3, 0)],
      2,
      2,
      false,
    ],
    ['future weeks are ignored', [week('past', 3, 3), week('future', 3, 0)], 1, 1, false],
    [
      'weeks with nothing planned are neutral',
      [week('past', 3, 3), week('past', 0, 0), week('past', 3, 3)],
      2,
      2,
      false,
    ],
    [
      '80% is the default threshold (4 of 5 meets, 2 of 3 does not)',
      [week('past', 5, 4), week('past', 3, 2)],
      0,
      1,
      false,
    ],
    [
      'best keeps the longest run',
      [
        week('past', 2, 2),
        week('past', 2, 2),
        week('past', 2, 2),
        week('past', 2, 0),
        week('past', 2, 2),
      ],
      1,
      3,
      false,
    ],
  ] as const)('%s', (_name, weeks, current, best, currentWeekMet) => {
    expect(weeklyStreak(stats([...weeks]))).toEqual({
      current,
      best,
      current_week_met: currentWeekMet,
    });
  });

  it('accepts a minimum-sessions alternative that also counts unplanned workouts', () => {
    const weeks = [week('past', 3, 2), week('past', 3, 1, 1)];
    expect(weeklyStreak(stats(weeks)).current).toBe(0);
    expect(weeklyStreak(stats(weeks), { minSessions: 2 }).current).toBe(2);
    expect(weeklyStreak(stats(weeks), { threshold: 0.6 })).toMatchObject({ current: 0, best: 1 });
  });

  it('works end to end from adherenceStats', () => {
    const plan = structuredClone(basePlan);
    for (const s of [...must(plan.weeks[0]).sessions, ...must(plan.weeks[1]).sessions]) {
      s.status = 'done';
    }
    const result = weeklyStreak(
      adherenceStats(plan, [], { today: '2026-10-27', timezone: TZ, changes: [] }),
    );
    expect(result).toEqual({ current: 2, best: 2, current_week_met: false });
  });

  it.each([0, 1.5, Number.NaN])('rejects threshold %s', (threshold) => {
    expect(() => weeklyStreak(stats([]), { threshold })).toThrow(RangeError);
  });

  it('rejects an invalid minSessions', () => {
    expect(() => weeklyStreak(stats([]), { minSessions: 0 })).toThrow(RangeError);
  });
});
