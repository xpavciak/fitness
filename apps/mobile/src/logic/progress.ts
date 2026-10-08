import {
  estimate1RM,
  localDateOf,
  type AdherenceStats,
  type ExerciseMeasure,
  type Plan,
  type ScheduleChange,
  type WeeklyStreak,
  type WorkoutLog,
} from '@fitness/engine';
import { adherence, records as personalRecords } from '../engine/engine-service';
import { exerciseName } from './labels';

export interface AdherenceSummary {
  stats: AdherenceStats;
  streak: WeeklyStreak;
  /** Adherence of the week containing today (null when nothing is planned or the plan is not running). */
  thisWeek: { percentage: number | null; completed: number; planned: number } | null;
}

export function adherenceSummary(
  plan: Plan,
  logs: readonly WorkoutLog[],
  today: string,
  timezone: string,
  changes: readonly ScheduleChange[],
): AdherenceSummary {
  const { stats, streak } = adherence({
    plan,
    logs,
    today,
    timezone,
    changes: changes.filter((change) => change.plan_id === plan.id),
  });
  const current = stats.weeks.find((week) => week.status === 'current');
  return {
    stats,
    streak,
    thisWeek: current
      ? { percentage: current.percentage, completed: current.completed, planned: current.planned }
      : null,
  };
}

export interface E1rmPoint {
  date: string;
  e1rmKg: number;
}

export interface ExerciseProgress {
  exerciseId: string;
  name: string;
  measure: ExerciseMeasure;
  bestE1rmKg: number | undefined;
  bestLoadKg: number | undefined;
  bestReps: number | undefined;
  /** Best e1RM per workout, oldest first (for the trend chart). */
  e1rmHistory: E1rmPoint[];
  /** Change from the first to the latest point, in percent (rounded), when there are two or more. */
  e1rmChangePct: number | undefined;
}

/** Personal records and the e1RM trend per exercise, sorted by exercise name. */
export function exerciseProgress(
  logs: readonly WorkoutLog[],
  timezone: string,
): ExerciseProgress[] {
  const records = personalRecords(logs.flatMap((log) => log.sets));
  /** exercise id -> workout log id -> best e1RM in that workout. */
  const history = new Map<string, Map<string, number>>();
  const logDates = new Map<string, string>();
  const ordered = [...logs].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
  for (const log of ordered) {
    const date = localDateOf(log.started_at, timezone);
    for (const set of log.sets) {
      if (!set.completed || set.is_warmup || set.measure !== 'reps' || set.reps < 1) {
        continue;
      }
      const e1rm = estimate1RM(set.load_kg, set.reps);
      if (e1rm === undefined) {
        continue;
      }
      const perLog = history.get(set.exercise_id) ?? new Map<string, number>();
      perLog.set(log.id, Math.max(perLog.get(log.id) ?? 0, e1rm));
      history.set(set.exercise_id, perLog);
      logDates.set(log.id, date);
    }
  }
  return Object.values(records)
    .map((record): ExerciseProgress => {
      const points = [...(history.get(record.exercise_id)?.entries() ?? [])].map(
        ([logId, e1rmKg]) => ({ date: logDates.get(logId) ?? '', e1rmKg }),
      );
      const first = points[0];
      const last = points[points.length - 1];
      return {
        exerciseId: record.exercise_id,
        name: exerciseName(record.exercise_id),
        measure: record.measure,
        bestE1rmKg: record.best_e1rm?.e1rm_kg,
        bestLoadKg: record.best_load?.load_kg,
        bestReps: record.best_reps?.reps,
        e1rmHistory: points,
        e1rmChangePct:
          first && last && points.length > 1
            ? Math.round((100 * (last.e1rmKg - first.e1rmKg)) / first.e1rmKg)
            : undefined,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
