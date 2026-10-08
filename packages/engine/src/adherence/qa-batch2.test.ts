/**
 * QA batch 2 (T7): a multi-week history in Europe/Bratislava across the end of DST
 * (Sunday 2026-10-25, 03:00 CEST -> 02:00 CET) with moved, merged, skipped and missed sessions.
 */
import { describe, expect, it } from 'vitest';
import { makeProfile, must, NOW, planFor } from '../__fixtures__/engine.js';
import { uuid } from '../__fixtures__/samples.js';
import { createSeededIdGenerator } from '../ids.js';
import type { Plan, ScheduleChange, WorkoutLog } from '../schemas/index.js';
import { applyScheduleChanges } from '../schedule/apply.js';
import { adherenceStats, weeklyStreak } from './adherence.js';

const TZ = 'Europe/Bratislava';
// Full Body 3x on Mon/Wed/Fri; weeks start 10-12, 10-19, 10-26 (after DST), 11-02, 11-09, 11-16.
const profile = makeProfile({
  equipment: [],
  available_days: ['mon', 'wed', 'fri', 'sat', 'sun'],
  training_slots: [],
});
const newId = createSeededIdGenerator(321);

let n = 0;
function log(started_at: string, planned_session_id?: string): WorkoutLog {
  n += 1;
  return {
    id: uuid(8800 + n),
    user_id: profile.user_id,
    started_at,
    sets: [],
    ...(planned_session_id ? { planned_session_id } : {}),
  };
}

function change(
  plan: Plan,
  sessionId: string,
  fields: Partial<ScheduleChange> & Pick<ScheduleChange, 'kind'>,
): ScheduleChange {
  const session = must(plan.weeks.flatMap((w) => w.sessions).find((s) => s.id === sessionId));
  return {
    id: newId(),
    plan_id: plan.id,
    planned_session_id: sessionId,
    reason: 'QA scenario change.',
    from_date: session.scheduled_date,
    created_by: 'user',
    created_at: NOW,
    ...fields,
  };
}

describe('QA batch 2: adherence across the October DST change', () => {
  const base = planFor(profile);
  const s = (w: number, i: number) => must(must(base.weeks[w]).sessions[i]);
  const changes = [
    change(base, s(1, 1).id, { kind: 'move', to_date: '2026-10-24' }), // Wed -> Sat
    change(base, s(2, 0).id, { kind: 'merge', merged_into_session_id: s(2, 1).id }), // Mon into Wed
    change(base, s(2, 2).id, { kind: 'skip' }), // Fri skipped
  ];
  const plan = applyScheduleChanges(base, changes, { newId, profile });
  const logs = [
    log('2026-10-12T16:00:00Z', s(0, 0).id),
    log('2026-10-14T16:00:00Z', s(0, 1).id),
    log('2026-10-16T22:30:00Z', s(0, 2).id), // Sat 00:30 local, linked: still counts
    log('2026-10-19T16:00:00Z', s(1, 0).id),
    log('2026-10-24T09:00:00Z', s(1, 1).id), // the moved session, done on Saturday
    log('2026-10-23T16:00:00Z', s(1, 2).id),
    // Unplanned workouts around the DST change:
    log('2026-10-24T22:30:00Z'), // Sun 10-25 00:30 CEST -> week 1
    log('2026-10-25T00:30:00Z'), // Sun 10-25 02:30 CEST (first pass) -> week 1
    log('2026-10-25T01:30:00Z'), // Sun 10-25 02:30 CET (second pass) -> week 1
    log('2026-10-25T23:30:00Z'), // Mon 10-26 00:30 CET -> week 2 (its UTC date is in week 1)
    log('2026-10-28T17:00:00Z', s(2, 1).id), // the absorbing session (merge) is done
    log('2026-11-02T22:30:00Z', s(3, 0).id), // Mon 23:30 CET
    log('2026-11-06T17:00:00Z', s(3, 2).id), // Wed of week 3 is missed
    log('2026-11-09T17:00:00Z', s(4, 0).id),
  ];
  const stats = adherenceStats(plan, logs, { today: '2026-11-11', timezone: TZ, changes });
  const summary = stats.weeks.map((w) => [
    w.status,
    w.completed,
    w.missed,
    w.skipped,
    w.upcoming,
    w.percentage,
    w.unplanned_workouts,
  ]);

  it('counts each week by local date, including the repeated 02:30 hour', () => {
    expect(summary).toEqual([
      ['past', 3, 0, 0, 0, 100, 0],
      ['past', 3, 0, 0, 0, 100, 3],
      ['past', 2, 0, 1, 0, 100, 1], // merged Monday completes with Wednesday; skip is neutral (D11)
      ['past', 2, 1, 0, 0, 67, 0],
      ['current', 1, 0, 0, 2, 33, 0], // today (Wednesday) is still upcoming
      ['future', 0, 0, 0, 3, 0, 0],
    ]);
    expect(stats.overall).toEqual({ due: 12, completed: 11, percentage: 92 });
  });

  it('buckets differently in UTC, proving the zone is applied', () => {
    const utc = adherenceStats(plan, logs, { today: '2026-11-11', timezone: 'UTC', changes });
    expect(utc.weeks.map((w) => w.unplanned_workouts).slice(1, 3)).toEqual([4, 0]);
  });

  it('streaks: 3 weeks (the skip is neutral, D11) then broken at 80%; minSessions 2 keeps it going', () => {
    expect(weeklyStreak(stats)).toEqual({ current: 0, best: 3, current_week_met: false });
    expect(weeklyStreak(stats, { minSessions: 2 })).toEqual({
      current: 4,
      best: 4,
      current_week_met: false,
    });
  });

  it('without the merge change the merged Monday counts as missed', () => {
    const withoutChanges = adherenceStats(plan, logs, {
      today: '2026-11-11',
      timezone: TZ,
      changes: [],
    });
    expect(withoutChanges.weeks[2]).toMatchObject({ completed: 1, missed: 1, skipped: 1 });
  });

  it('on the DST Sunday itself, week 1 is current and week 2 is future', () => {
    const onDst = adherenceStats(plan, logs, { today: '2026-10-25', timezone: TZ, changes });
    expect(onDst.weeks.map((w) => w.status).slice(0, 3)).toEqual(['past', 'current', 'future']);
    expect(weeklyStreak(onDst)).toEqual({ current: 2, best: 2, current_week_met: true });
  });
});
