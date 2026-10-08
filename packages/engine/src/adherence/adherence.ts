import { addDays, daysBetween, isValidTimeZone, localDateOf, startOfWeek } from '../dates.js';
import {
  IsoDateSchema,
  PlanSchema,
  ScheduleChangeSchema,
  WorkoutLogSchema,
  type IsoDate,
  type Plan,
  type PlannedSession,
  type ScheduleChange,
  type WorkoutLog,
} from '../schemas/index.js';

export const WEEK_STATUSES = ['past', 'current', 'future'] as const;
export type WeekStatus = (typeof WEEK_STATUSES)[number];

/** How a planned session counts for adherence (see `SESSION_STATUSES`). */
export const SESSION_OUTCOMES = ['completed', 'missed', 'skipped', 'upcoming'] as const;
export type SessionOutcome = (typeof SESSION_OUTCOMES)[number];

export interface WeekAdherence {
  week_index: number;
  start_date: IsoDate;
  status: WeekStatus;
  /** Every session counts as planned, whatever its status. */
  planned: number;
  completed: number;
  missed: number;
  skipped: number;
  /** Not done yet and dated today or later. */
  upcoming: number;
  /** completed / planned x 100, rounded; null when nothing is planned. */
  percentage: number | null;
  /** Logged workouts not linked to a session of this plan, bucketed by local date. */
  unplanned_workouts: number;
}

export interface AdherenceStats {
  today: IsoDate;
  timezone: string;
  weeks: WeekAdherence[];
  /**
   * Adherence so far: completed / (completed + missed + skipped) over all weeks, i.e. upcoming
   * sessions are not counted yet. `percentage` is null when nothing is due yet.
   */
  overall: { due: number; completed: number; percentage: number | null };
}

/**
 * Weekly adherence for a plan (feature D). Session semantics follow `SESSION_STATUSES`:
 * - completed: status `done`, or any workout log linked to the session (`planned_session_id`),
 *   which also covers logs that synced before the status was updated;
 * - `moved` counts as planned until it is done; `skipped` counts as planned, not completed;
 * - `merged` counts as completed when the absorbing session (from the merge ScheduleChange in
 *   `changes`) is completed, otherwise it shares the absorbing session's outcome; without a
 *   known absorbing session it is missed once its own date has passed;
 * - missed is derived: not completed, not skipped, and `scheduled_date` before `today`.
 * Workout logs are bucketed into weeks by the local date of `started_at` in `timezone` (the
 * profile's IANA zone); `today` is the user's local date.
 */
export function adherenceStats(
  planInput: Plan,
  logsInput: readonly WorkoutLog[],
  todayInput: IsoDate,
  timezone: string,
  changesInput: readonly ScheduleChange[] = [],
): AdherenceStats {
  const plan = PlanSchema.parse(planInput);
  const logs = logsInput.map((log) => WorkoutLogSchema.parse(log));
  const today = IsoDateSchema.parse(todayInput);
  if (!isValidTimeZone(timezone)) {
    throw new RangeError(`Unknown IANA time zone "${timezone}"`);
  }
  const changes = changesInput.map((change) => ScheduleChangeSchema.parse(change));

  const sessions = new Map(plan.weeks.flatMap((week) => week.sessions).map((s) => [s.id, s]));
  const logged = new Set(
    logs.flatMap((log) =>
      log.planned_session_id !== undefined && sessions.has(log.planned_session_id)
        ? [log.planned_session_id]
        : [],
    ),
  );
  const absorbedBy = new Map<string, string>();
  for (const change of changes) {
    if (change.plan_id === plan.id && change.kind === 'merge' && change.merged_into_session_id) {
      absorbedBy.set(change.planned_session_id, change.merged_into_session_id);
    }
  }
  const outcome = (session: PlannedSession, depth = 0): SessionOutcome => {
    if (session.status === 'done' || logged.has(session.id)) {
      return 'completed';
    }
    if (session.status === 'skipped') {
      return 'skipped';
    }
    const absorber = sessions.get(absorbedBy.get(session.id) ?? '');
    if (session.status === 'merged' && absorber && depth < sessions.size) {
      return outcome(absorber, depth + 1);
    }
    return daysBetween(session.scheduled_date, today) > 0 ? 'missed' : 'upcoming';
  };

  const unplannedByWeek = new Map<IsoDate, number>();
  for (const log of logs) {
    if (log.planned_session_id !== undefined && sessions.has(log.planned_session_id)) {
      continue;
    }
    const weekStart = startOfWeek(localDateOf(log.started_at, timezone));
    unplannedByWeek.set(weekStart, (unplannedByWeek.get(weekStart) ?? 0) + 1);
  }

  const weeks = plan.weeks.map((week): WeekAdherence => {
    const counts = { completed: 0, missed: 0, skipped: 0, upcoming: 0 };
    for (const session of week.sessions) {
      counts[outcome(session)] += 1;
    }
    const planned = week.sessions.length;
    return {
      week_index: week.index,
      start_date: week.start_date,
      status: weekStatus(week.start_date, today),
      planned,
      ...counts,
      percentage: percentage(counts.completed, planned),
      unplanned_workouts: unplannedByWeek.get(week.start_date) ?? 0,
    };
  });

  const completed = weeks.reduce((sum, week) => sum + week.completed, 0);
  const due = weeks.reduce((sum, week) => sum + week.completed + week.missed + week.skipped, 0);
  return {
    today,
    timezone,
    weeks,
    overall: { due, completed, percentage: percentage(completed, due) },
  };
}

function percentage(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((100 * part) / whole);
}

function weekStatus(weekStart: IsoDate, today: IsoDate): WeekStatus {
  if (daysBetween(today, weekStart) > 0) {
    return 'future';
  }
  return daysBetween(addDays(weekStart, 6), today) > 0 ? 'past' : 'current';
}

export const DEFAULT_STREAK_THRESHOLD = 0.8;

export interface WeeklyStreakOptions {
  /** Share of planned sessions to complete (default 0.8 = 80%). */
  threshold?: number;
  /**
   * Alternative minimum: a week also counts when completed sessions plus unplanned workouts reach
   * this number (e.g. the user's own "at least 2 sessions" minimum). Off by default.
   */
  minSessions?: number;
}

export interface WeeklyStreak {
  /** Consecutive qualifying weeks up to now. */
  current: number;
  /** Longest run of qualifying weeks in the plan so far. */
  best: number;
  /** The current week already qualifies (it then counts in `current`). */
  current_week_met: boolean;
}

/**
 * Weekly streak (feature D, research 3.2: weekly, not daily). A week qualifies when
 * completed / planned >= `threshold`, or completed + unplanned workouts >= `minSessions`.
 * The current week only counts once it qualifies and never breaks the streak before it is over.
 * Weeks with nothing planned are neutral: they neither extend nor break the streak.
 */
export function weeklyStreak(stats: AdherenceStats, opts: WeeklyStreakOptions = {}): WeeklyStreak {
  const threshold = opts.threshold ?? DEFAULT_STREAK_THRESHOLD;
  if (!(threshold > 0 && threshold <= 1)) {
    throw new RangeError(`threshold must be in (0, 1], got ${threshold}`);
  }
  if (
    opts.minSessions !== undefined &&
    !(Number.isInteger(opts.minSessions) && opts.minSessions >= 1)
  ) {
    throw new RangeError(`minSessions must be a positive integer, got ${opts.minSessions}`);
  }
  // The epsilon absorbs float noise such as 0.8 * 3 = 2.4000000000000004.
  const meets = (week: WeekAdherence) =>
    week.completed >= threshold * week.planned - 1e-9 ||
    (opts.minSessions !== undefined &&
      week.completed + week.unplanned_workouts >= opts.minSessions);

  let run = 0;
  let best = 0;
  let currentWeekMet = false;
  for (const week of stats.weeks) {
    if (week.status === 'future' || week.planned === 0) {
      continue;
    }
    if (meets(week)) {
      run += 1;
      best = Math.max(best, run);
      currentWeekMet ||= week.status === 'current';
    } else if (week.status === 'past') {
      run = 0;
    }
  }
  return { current: run, best, current_week_met: currentWeekMet };
}
