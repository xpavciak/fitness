import {
  daysBetween,
  isWithinWeek,
  type Plan,
  type PlannedSession,
  type PlanWeek,
  type WorkoutLog,
} from '@fitness/engine';

export type WeekRelation = 'before_start' | 'current' | 'after_end';

export interface CurrentWeek {
  week: PlanWeek;
  relation: WeekRelation;
}

/**
 * The week to show on the Plan screen: the plan week containing `today`, the first week when
 * the plan has not started yet, or the last week when it is over.
 */
export function currentWeek(plan: Plan, today: string): CurrentWeek {
  const first = plan.weeks[0];
  const last = plan.weeks[plan.weeks.length - 1];
  if (!first || !last) {
    throw new Error('A plan has at least one week');
  }
  const containing = plan.weeks.find((week) => isWithinWeek(today, week.start_date));
  if (containing) {
    return { week: containing, relation: 'current' };
  }
  return daysBetween(today, first.start_date) > 0
    ? { week: first, relation: 'before_start' }
    : { week: last, relation: 'after_end' };
}

/** The plan weeks before and after `week` (the engine's `neighborSessions`). */
export function neighborSessions(plan: Plan, week: PlanWeek): PlannedSession[] {
  return plan.weeks
    .filter((other) => Math.abs(other.index - week.index) === 1)
    .flatMap((other) => other.sessions);
}

export type SessionDisplayStatus = 'done' | 'skipped' | 'merged' | 'missed' | 'today' | 'upcoming';

export const SESSION_STATUS_LABELS: Record<SessionDisplayStatus, string> = {
  done: 'Done',
  skipped: 'Skipped',
  merged: 'Merged',
  missed: 'Missed',
  today: 'Today',
  upcoming: 'Upcoming',
};

/** Ids of sessions with a linked workout log. */
export function loggedSessionIds(logs: readonly WorkoutLog[]): Set<string> {
  return new Set(logs.flatMap((log) => (log.planned_session_id ? [log.planned_session_id] : [])));
}

/** What the user sees for a session. "Missed" is derived from the date, as in the engine. */
export function sessionDisplayStatus(
  session: PlannedSession,
  today: string,
  logged: ReadonlySet<string>,
): SessionDisplayStatus {
  if (session.status === 'done' || logged.has(session.id)) {
    return 'done';
  }
  if (session.status === 'skipped' || session.status === 'merged') {
    return session.status;
  }
  const offset = daysBetween(today, session.scheduled_date);
  if (offset < 0) {
    return 'missed';
  }
  return offset === 0 ? 'today' : 'upcoming';
}

/** Sessions that can still be trained or rescheduled (planned or moved, not logged). */
export function isOpen(session: PlannedSession, logged: ReadonlySet<string>): boolean {
  return (session.status === 'planned' || session.status === 'moved') && !logged.has(session.id);
}

/**
 * Today's session: an open session scheduled today, else the next open one this week or later,
 * else null (the plan is finished).
 */
export function todaysSession(
  plan: Plan,
  today: string,
  logs: readonly WorkoutLog[],
): { session: PlannedSession; isToday: boolean } | null {
  const logged = loggedSessionIds(logs);
  const upcoming = plan.weeks
    .flatMap((week) => week.sessions)
    .filter((session) => isOpen(session, logged) && daysBetween(today, session.scheduled_date) >= 0)
    .sort((a, b) => daysBetween(b.scheduled_date, a.scheduled_date));
  const next = upcoming[0];
  if (!next) {
    return null;
  }
  return { session: next, isToday: next.scheduled_date === today };
}

export function findSession(
  plan: Plan,
  sessionId: string,
): { week: PlanWeek; session: PlannedSession } | null {
  for (const week of plan.weeks) {
    const session = week.sessions.find((candidate) => candidate.id === sessionId);
    if (session) {
      return { week, session };
    }
  }
  return null;
}

/** Sessions of a week in date order. */
export function sessionsByDate(week: PlanWeek): PlannedSession[] {
  return [...week.sessions].sort(
    (a, b) => daysBetween(b.scheduled_date, a.scheduled_date) || a.day_index - b.day_index,
  );
}

/** The workout log linked to a session (the latest one, if several were synced), or null. */
export function sessionLog(logs: readonly WorkoutLog[], sessionId: string): WorkoutLog | null {
  const linked = logs.filter((log) => log.planned_session_id === sessionId);
  linked.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  return linked[0] ?? null;
}
