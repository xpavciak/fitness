/**
 * The only module that calls the planning engine's computational API. Screens and view-models
 * go through these app-facing signatures, so engine API changes (e.g. option objects, newly
 * required parameters) are absorbed here. Schemas, types, the catalog and date helpers are
 * still imported from `@fitness/engine` directly.
 */
import {
  adherenceStats,
  applyScheduleChanges,
  estimate1RM,
  generatePlan,
  nextTargets,
  personalRecords,
  proposeReschedules,
  replacePlannedSession,
  screenProfile,
  weeklyStreak,
  type AdherenceStats,
  type GeneratePlanResult,
  type Goal,
  type IdGenerator,
  type NextTargets,
  type Plan,
  type PlannedExercise,
  type PlannedSession,
  type PlanWeek,
  type PersonalRecord,
  type Profile,
  type RescheduleEvent,
  type ScheduleChange,
  type ScheduleProposal,
  type ScreeningResult,
  type SetLog,
  type WeeklyStreak,
  type WorkoutLog,
} from '@fitness/engine';

/** `generatePlan` result with the plan warnings the app shows (empty until the engine adds them). */
export type PlanResult =
  | (Extract<GeneratePlanResult, { ok: true }> & { warnings: string[] })
  | Extract<GeneratePlanResult, { ok: false }>;

export function createPlan(
  profile: Profile,
  goal: Goal,
  opts: { today: string; now: string; newId: IdGenerator },
): PlanResult {
  const result = generatePlan(profile, goal, opts);
  if (!result.ok) {
    return result;
  }
  const warnings = (result as { warnings?: unknown }).warnings;
  return {
    ...result,
    warnings: Array.isArray(warnings)
      ? warnings.filter((w): w is string => typeof w === 'string')
      : [],
  };
}

export function targetsFor(
  planned: PlannedExercise,
  sets: readonly SetLog[],
  opts: { today: string; timezone: string },
): NextTargets {
  return nextTargets(planned, sets, { today: opts.today, timezone: opts.timezone });
}

export function proposalsFor(
  week: PlanWeek,
  event: RescheduleEvent,
  opts: {
    planId: string;
    today: string;
    now: string;
    newId: IdGenerator;
    profile: Profile;
    /** Sessions of the adjacent weeks; [] when there are none. */
    neighborSessions: readonly PlannedSession[];
  },
): ScheduleProposal[] {
  return proposeReschedules(week, event, {
    plan_id: opts.planId,
    today: opts.today,
    now: opts.now,
    newId: opts.newId,
    profile: opts.profile,
    neighborSessions: opts.neighborSessions,
    created_by: 'user',
  });
}

export function applyChanges(
  plan: Plan,
  changes: readonly ScheduleChange[],
  opts: { newId: IdGenerator; profile: Profile },
): Plan {
  return applyScheduleChanges(plan, changes, opts);
}

export function replaceSession(plan: Plan, session: PlannedSession): Plan {
  return replacePlannedSession(plan, session);
}

export function adherence(input: {
  plan: Plan;
  logs: readonly WorkoutLog[];
  today: string;
  timezone: string;
  changes: readonly ScheduleChange[];
}): { stats: AdherenceStats; streak: WeeklyStreak } {
  const stats = adherenceStats(input.plan, input.logs, input.today, input.timezone, input.changes);
  return { stats, streak: weeklyStreak(stats) };
}

export function records(sets: readonly SetLog[]): Record<string, PersonalRecord> {
  return personalRecords(sets);
}

/** Estimated one-rep max in kg (Epley); undefined without load or above 10 reps. */
export function e1rm(loadKg: number, reps: number): number | undefined {
  return estimate1RM(loadKg, reps);
}

/** PAR-Q+ and age gate for a saved profile (the same check `generatePlan` runs first). */
export function screen(profile: Profile, today: string): ScreeningResult {
  return screenProfile(profile, today);
}
