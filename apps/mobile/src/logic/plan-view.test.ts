import { addDays, createSeededIdGenerator, type WorkoutLog } from '@fitness/engine';
import { describe, expect, it } from 'vitest';
import { at, onboardedPlan, must } from '../test/fixtures';
import {
  currentWeek,
  findSession,
  isOpen,
  loggedSessionIds,
  neighborSessions,
  sessionDisplayStatus,
  sessionLog,
  sessionsByDate,
  todaysSession,
} from './plan-view';

const { plan, outcome } = onboardedPlan();
const firstWeek = must(plan.weeks[0]);
const [s1, s2, s3] = sessionsByDate(firstWeek);

function logFor(sessionId: string, date: string): WorkoutLog {
  const newId = createSeededIdGenerator(99);
  return {
    id: newId(),
    user_id: outcome.profile.user_id,
    planned_session_id: sessionId,
    started_at: at(date),
    sets: [],
  };
}

describe('currentWeek', () => {
  it('shows the first week before the plan starts', () => {
    expect(currentWeek(plan, '2026-10-08')).toEqual({ week: firstWeek, relation: 'before_start' });
  });

  it('finds the week containing today', () => {
    expect(currentWeek(plan, '2026-10-21')).toMatchObject({ relation: 'current' });
    expect(currentWeek(plan, '2026-10-21').week.index).toBe(1);
  });

  it('shows the last week once the plan is over', () => {
    const result = currentWeek(plan, '2027-01-01');
    expect(result.relation).toBe('after_end');
    expect(result.week.index).toBe(plan.weeks.length - 1);
  });
});

describe('sessionDisplayStatus', () => {
  it('derives missed, today and upcoming from the date', () => {
    expect(s1 && s2 && s3).toBeTruthy();
    const today = must(s2).scheduled_date;
    const none = new Set<string>();
    expect(sessionDisplayStatus(must(s1), today, none)).toBe('missed');
    expect(sessionDisplayStatus(must(s2), today, none)).toBe('today');
    expect(sessionDisplayStatus(must(s3), today, none)).toBe('upcoming');
  });

  it('treats a linked log as done and keeps skipped/merged', () => {
    const today = must(s3).scheduled_date;
    const logged = loggedSessionIds([logFor(must(s1).id, must(s1).scheduled_date)]);
    expect(sessionDisplayStatus(must(s1), today, logged)).toBe('done');
    expect(sessionDisplayStatus({ ...must(s2), status: 'skipped' }, today, logged)).toBe('skipped');
    expect(sessionDisplayStatus({ ...must(s2), status: 'merged' }, today, logged)).toBe('merged');
    expect(isOpen(must(s1), logged)).toBe(false);
    expect(isOpen({ ...must(s2), status: 'moved' }, logged)).toBe(true);
  });
});

describe('todaysSession', () => {
  it('returns the session scheduled today', () => {
    expect(todaysSession(plan, must(s1).scheduled_date, [])).toEqual({
      session: s1,
      isToday: true,
    });
  });

  it('returns the next open session when nothing is scheduled today', () => {
    expect(todaysSession(plan, '2026-10-08', [])).toEqual({ session: s1, isToday: false });
    const dayAfterFirst = addDays(must(s1).scheduled_date, 1);
    expect(todaysSession(plan, dayAfterFirst, [])?.session.id).toBe(must(s2).id);
  });

  it('skips sessions that were already logged', () => {
    const logs = [logFor(must(s1).id, must(s1).scheduled_date)];
    expect(todaysSession(plan, must(s1).scheduled_date, logs)?.session.id).toBe(must(s2).id);
  });

  it('returns null after the plan', () => {
    expect(todaysSession(plan, '2027-06-01', [])).toBeNull();
  });
});

describe('plan lookups', () => {
  it('finds sessions and neighbour weeks', () => {
    expect(findSession(plan, must(s2).id)?.week.id).toBe(firstWeek.id);
    expect(findSession(plan, '00000000-0000-4000-8000-000000000000')).toBeNull();
    const second = must(plan.weeks[1]);
    const neighbours = neighborSessions(plan, second).map((s) => s.plan_week_id);
    expect(new Set(neighbours)).toEqual(new Set([firstWeek.id, must(plan.weeks[2]).id]));
  });
});

describe('sessionLog', () => {
  it('finds the latest log linked to a session', () => {
    const older = logFor(must(s1).id, '2026-10-12');
    const newer = {
      ...logFor(must(s1).id, '2026-10-13'),
      id: '00000099-0000-4000-8000-0000000000ff',
    };
    expect(sessionLog([older, newer], must(s1).id)).toBe(newer);
    expect(sessionLog([older], must(s2).id)).toBeNull();
  });
});
