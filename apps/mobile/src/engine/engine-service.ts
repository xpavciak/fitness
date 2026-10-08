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
  TemplateCoachProvider,
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

/** `generatePlan` result; a successful one carries `warnings` (shown on the Plan screen). */
export type PlanResult = GeneratePlanResult;

export function createPlan(
  profile: Profile,
  goal: Goal,
  opts: { today: string; now: string; newId: IdGenerator },
): PlanResult {
  return generatePlan(profile, goal, opts);
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
    today: string;
    now: string;
    newId: IdGenerator;
    profile: Profile;
    /** Sessions of the adjacent weeks; [] when there are none. */
    neighborSessions: readonly PlannedSession[];
  },
): ScheduleProposal[] {
  return proposeReschedules(week, event, {
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
  const stats = adherenceStats(input.plan, input.logs, {
    today: input.today,
    timezone: input.timezone,
    changes: input.changes,
  });
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

export type CoachSource = 'ai' | 'template';

/** A coach text and where it came from; the UI labels `ai` texts as AI-generated. */
export interface CoachText {
  text: string;
  source: CoachSource;
}

/**
 * Accepts both coach result shapes: a plain string (template provider today) or
 * `{ text, source }` (the upcoming engine API). Anything else is a bug and throws.
 */
export function toCoachText(value: unknown): CoachText {
  if (typeof value === 'string') {
    return { text: value, source: 'template' };
  }
  if (typeof value === 'object' && value !== null && 'text' in value && 'source' in value) {
    const { text, source } = value;
    if (typeof text === 'string' && (source === 'ai' || source === 'template')) {
      return { text, source };
    }
  }
  throw new TypeError('Unexpected coach text shape');
}

/**
 * Coach texts (D5): the deterministic template provider only, no network. The Claude proxy
 * provider stays unwired until a server-side proxy exists. The template provider's synchronous
 * methods are used so screens can render the text directly.
 */
const coach = new TemplateCoachProvider();

export function explainPlan(plan: Plan, profile: Profile): CoachText {
  return toCoachText(coach.planText(plan, profile));
}

export function weeklyReflection(
  stats: AdherenceStats,
  weekIndex: number,
  profile: Profile,
): CoachText {
  return toCoachText(coach.reflectionText(stats, weekIndex, profile));
}
