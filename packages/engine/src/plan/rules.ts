import { isExerciseAvailable } from '../equipment.js';
import { daysBetween } from '../dates.js';
import type {
  Exercise,
  MuscleGroup,
  Plan,
  PlannedExerciseRow,
  PlannedSession,
  PlannedSessionRow,
  Profile,
  SessionStatus,
} from '../schemas/index.js';
import { isContraindicated } from './select.js';
import { estimateSessionMinutes } from './session-time.js';
import { DURATION_TOLERANCE, MAX_SETS_PER_EXERCISE, WEEKLY_SET_CAPS } from './templates.js';

type Lookup = (id: string) => Exercise;
type SessionWithExercises = Pick<PlannedSessionRow, 'id' | 'scheduled_date' | 'status'> & {
  exercises: readonly Pick<PlannedExerciseRow, 'exercise_id' | 'sets'>[];
};

/** Conditioning and low-stimulus exercises do not count as hard sets for weekly volume. */
export function countsTowardVolume(exercise: Pick<Exercise, 'pattern' | 'low_stimulus'>): boolean {
  return exercise.pattern !== 'cardio' && !exercise.low_stimulus;
}

/**
 * Hard sets per muscle group across the given sessions: each working set counts once for every
 * primary muscle of the exercise (see `WEEKLY_SET_CAPS`).
 */
export function weeklySetsByMuscle(
  sessions: readonly SessionWithExercises[],
  lookup: Lookup,
): Map<MuscleGroup, number> {
  const totals = new Map<MuscleGroup, number>();
  for (const session of sessions) {
    for (const pe of session.exercises) {
      const exercise = lookup(pe.exercise_id);
      if (!countsTowardVolume(exercise)) {
        continue;
      }
      for (const muscle of exercise.primary_muscles) {
        totals.set(muscle, (totals.get(muscle) ?? 0) + pe.sets);
      }
    }
  }
  return totals;
}

/** Primary muscles trained by a session (conditioning excluded). */
export function sessionMuscles(
  session: { exercises: readonly Pick<PlannedExerciseRow, 'exercise_id'>[] },
  lookup: Lookup,
): Set<MuscleGroup> {
  const muscles = new Set<MuscleGroup>();
  for (const pe of session.exercises) {
    const exercise = lookup(pe.exercise_id);
    if (exercise.pattern !== 'cardio') {
      exercise.primary_muscles.forEach((muscle) => muscles.add(muscle));
    }
  }
  return muscles;
}

/** Sessions that occupy their date: everything except skipped and merged ones. */
export const OCCUPYING_STATUSES: readonly SessionStatus[] = ['planned', 'moved', 'done'];

export function occupiesDate(session: Pick<PlannedSessionRow, 'status'>): boolean {
  return OCCUPYING_STATUSES.includes(session.status);
}

export function sharesMuscles(a: ReadonlySet<MuscleGroup>, b: ReadonlySet<MuscleGroup>): boolean {
  for (const muscle of a) {
    if (b.has(muscle)) {
      return true;
    }
  }
  return false;
}

export interface ConsecutiveConflict {
  firstSessionId: string;
  secondSessionId: string;
  muscles: MuscleGroup[];
}

/** Pairs of occupying sessions on consecutive days that share a primary muscle group. */
export function consecutiveMuscleConflicts(
  sessions: readonly SessionWithExercises[],
  lookup: Lookup,
): ConsecutiveConflict[] {
  const active = sessions
    .filter(occupiesDate)
    .map((session) => ({ session, muscles: sessionMuscles(session, lookup) }));
  const conflicts: ConsecutiveConflict[] = [];
  for (const first of active) {
    for (const second of active) {
      if (daysBetween(first.session.scheduled_date, second.session.scheduled_date) !== 1) {
        continue;
      }
      const shared = [...first.muscles].filter((muscle) => second.muscles.has(muscle));
      if (shared.length > 0) {
        conflicts.push({
          firstSessionId: first.session.id,
          secondSessionId: second.session.id,
          muscles: shared.sort(),
        });
      }
    }
  }
  return conflicts;
}

export interface PlanRuleIssue {
  path: string;
  message: string;
}

/**
 * Rules validator (research 2.3, guardrail 2), run after generation and usable on any plan
 * (e.g. LLM output). Checks, for the profile:
 * - every exercise is available with the profile's equipment and not contraindicated;
 * - weekly hard sets per muscle group stay within `WEEKLY_SET_CAPS`;
 * - sets per exercise stay within `MAX_SETS_PER_EXERCISE`;
 * - no prescription to failure (target_rir >= 1) and beginners keep RIR >= 3;
 * - full sessions: `est_minutes` matches the time model and is within session_minutes +/- 10%;
 * - the deload week is lighter than the training weeks (see `checkDeload`).
 * Structural validity is the schema's job (`createCatalogValidators(...).Plan`).
 */
export function validatePlanRules(
  plan: Plan,
  profile: Pick<Profile, 'equipment' | 'limitations' | 'experience_level' | 'session_minutes'>,
  lookup: Lookup,
): PlanRuleIssue[] {
  const issues: PlanRuleIssue[] = [];
  const cap = WEEKLY_SET_CAPS[profile.experience_level];
  const maxSets = MAX_SETS_PER_EXERCISE[profile.experience_level];
  const minRir = profile.experience_level === 'beginner' ? 3 : 1;
  const tolerance = profile.session_minutes * DURATION_TOLERANCE;

  plan.weeks.forEach((week, w) => {
    for (const [muscle, sets] of weeklySetsByMuscle(week.sessions, lookup)) {
      if (sets > cap) {
        issues.push({
          path: `weeks.${w}`,
          message: `${muscle} gets ${sets} hard sets, above the weekly cap of ${cap}`,
        });
      }
    }
    week.sessions.forEach((session, s) => {
      const path = `weeks.${w}.sessions.${s}`;
      checkSessionDuration(session, profile.session_minutes, tolerance, lookup, path, issues);
      session.exercises.forEach((pe, e) => {
        const exercise = lookup(pe.exercise_id);
        const exercisePath = `${path}.exercises.${e}`;
        if (!isExerciseAvailable(exercise, profile.equipment)) {
          issues.push({
            path: exercisePath,
            message: `${exercise.id} needs unavailable equipment`,
          });
        }
        if (isContraindicated(exercise, profile.limitations)) {
          issues.push({ path: exercisePath, message: `${exercise.id} is contraindicated` });
        }
        if (pe.sets > maxSets) {
          issues.push({ path: exercisePath, message: `${pe.sets} sets exceeds ${maxSets}` });
        }
        if (pe.target_rir < minRir) {
          issues.push({ path: exercisePath, message: `target_rir ${pe.target_rir} < ${minRir}` });
        }
      });
    });
  });

  checkDeload(plan, lookup, issues);
  return issues;
}

function hardSets(session: PlannedSession, lookup: Lookup): number {
  return session.exercises
    .filter((pe) => countsTowardVolume(lookup(pe.exercise_id)))
    .reduce((n, pe) => n + pe.sets, 0);
}

const maxRir = (session: PlannedSession) =>
  Math.max(...session.exercises.map((pe) => pe.target_rir));

/**
 * The plan needs a deload week. Each deload session must be easier than the same session (by
 * title) in the latest training week: fewer hard sets, or the same sets at a higher RIR.
 */
function checkDeload(plan: Plan, lookup: Lookup, issues: PlanRuleIssue[]): void {
  const deload = plan.weeks.find((week) => week.phase === 'deload');
  if (!deload) {
    issues.push({ path: 'weeks', message: 'The plan has no deload week' });
    return;
  }
  const trainingWeeks = plan.weeks.filter((week) => week.index < deload.index).reverse();
  deload.sessions.forEach((session, s) => {
    const reference = trainingWeeks
      .flatMap((week) => week.sessions)
      .find((candidate) => candidate.title === session.title);
    if (!reference) {
      return;
    }
    const fewer = hardSets(session, lookup) < hardSets(reference, lookup);
    const easier =
      hardSets(session, lookup) === hardSets(reference, lookup) &&
      maxRir(session) > maxRir(reference);
    if (!fewer && !easier) {
      issues.push({
        path: `weeks.${deload.index}.sessions.${s}`,
        message: `Deload "${session.title}" is not lighter than in week ${reference.scheduled_date}`,
      });
    }
  });
}

function checkSessionDuration(
  session: PlannedSession,
  sessionMinutes: number,
  tolerance: number,
  lookup: Lookup,
  path: string,
  issues: PlanRuleIssue[],
): void {
  const modelled = estimateSessionMinutes(session.exercises, session.variant, lookup);
  if (session.est_minutes !== modelled) {
    issues.push({
      path,
      message: `est_minutes ${session.est_minutes} does not match the time model (${modelled})`,
    });
  }
  if (session.variant === 'full' && Math.abs(session.est_minutes - sessionMinutes) > tolerance) {
    issues.push({
      path,
      message: `est_minutes ${session.est_minutes} is outside ${sessionMinutes} +/- 10%`,
    });
  }
}
