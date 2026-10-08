import { EXERCISE_CATALOG } from '../catalog/index.js';
import { createCatalogLookup } from '../catalog/lookup.js';
import type { IdGenerator } from '../ids.js';
import { isEligible, rankCandidates } from '../plan/select.js';
import {
  estimateSessionMinutes,
  estimateSessionSeconds,
  secondsPerSet,
} from '../plan/session-time.js';
import { TIMED_SCHEME } from '../plan/templates.js';
import type {
  Exercise,
  MovementPattern,
  PlannedExercise,
  PlannedSession,
  Profile,
} from '../schemas/index.js';

/** A shortened session takes at most this long (research 3.2: 20-30 minutes). */
export const SHORT_SESSION_MAX_MINUTES = 30;
/** Shortened sessions below this length are built as a minimum dose instead. */
export const SHORT_SESSION_MIN_MINUTES = 16;
/** The minimum dose takes 10-15 minutes. */
export const MINIMUM_DOSE_MINUTES = { min: 10, max: 15 } as const;
/** Rest is capped in shortened sessions. */
export const SHORT_SESSION_REST_CAP_SEC = 90;
/** The minimum dose runs as a circuit with short rests. */
export const MINIMUM_DOSE_REST_SEC = 30;
export const MINIMUM_DOSE_SUPERSET = 'MD';
const MINIMUM_DOSE_MAX_SETS = 4;
const MINIMUM_DOSE_START_EXERCISES = 3;

/** Bodyweight patterns used when the planned session has no usable key exercises. */
const MINIMUM_DOSE_PATTERNS: readonly MovementPattern[] = [
  'squat',
  'push_h',
  'pull_h',
  'hinge',
  'core',
  'lunge',
  'push_v',
];

type Lookup = (id: string) => Exercise;

const isConditioning = (pe: PlannedExercise, lookup: Lookup) =>
  lookup(pe.exercise_id).pattern === 'cardio';

const minutesOf = (
  exercises: readonly PlannedExercise[],
  session: PlannedSession,
  lookup: Lookup,
) => estimateSessionMinutes(exercises, session.variant, lookup);

/**
 * The short variant (feature C): at most `maxMinutes` (16-30), always containing every `is_key`
 * exercise. Key exercises come first with their sets reduced as needed (at least one), rests
 * are capped at 90 s, then other exercises are added in plan order while they fit, then sets are
 * restored round-robin. Exercise ids are kept. Returns undefined when the key exercises alone
 * do not fit `maxMinutes`.
 */
export function shortenSession(
  session: PlannedSession,
  maxMinutes: number,
  catalog: readonly Exercise[] = EXERCISE_CATALOG,
): PlannedSession | undefined {
  if (
    !Number.isInteger(maxMinutes) ||
    maxMinutes < SHORT_SESSION_MIN_MINUTES ||
    maxMinutes > SHORT_SESSION_MAX_MINUTES
  ) {
    throw new RangeError(
      `maxMinutes must be an integer from ${SHORT_SESSION_MIN_MINUTES} to ${SHORT_SESSION_MAX_MINUTES}, got ${maxMinutes}`,
    );
  }
  const lookup = createCatalogLookup(catalog);
  const short: PlannedSession = { ...session, variant: 'short', exercises: [] };
  const capRest = (pe: PlannedExercise): PlannedExercise => ({
    ...pe,
    rest_sec: Math.min(pe.rest_sec, SHORT_SESSION_REST_CAP_SEC),
  });
  const working = session.exercises.filter((pe) => !isConditioning(pe, lookup)).map(capRest);
  const keys = working.filter((pe) => pe.is_key).map((pe) => ({ ...pe, sets: 1 }));
  const others = working.filter((pe) => !pe.is_key);
  const fits = (exercises: readonly PlannedExercise[]) =>
    minutesOf(exercises, short, lookup) <= maxMinutes;

  const chosen: PlannedExercise[] = [...keys];
  if (!fits(chosen)) {
    return undefined;
  }
  for (const pe of others) {
    const candidate = { ...pe, sets: 1 };
    if (fits([...chosen, candidate])) {
      chosen.push(candidate);
    }
  }
  restoreSets(chosen, session.exercises, fits);
  return finalize(short, sortByPlanOrder(chosen, session.exercises), lookup);
}

/** Adds sets back round-robin (keys first) up to the planned sets while `fits` holds. */
function restoreSets(
  chosen: PlannedExercise[],
  original: readonly PlannedExercise[],
  fits: (exercises: readonly PlannedExercise[]) => boolean,
): void {
  const plannedSets = new Map(original.map((pe) => [pe.id, pe.sets]));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < chosen.length; i += 1) {
      const pe = chosen[i];
      if (!pe || pe.sets >= (plannedSets.get(pe.id) ?? pe.sets)) {
        continue;
      }
      const next = chosen.map((item, j) => (j === i ? { ...item, sets: item.sets + 1 } : item));
      if (fits(next)) {
        chosen[i] = { ...pe, sets: pe.sets + 1 };
        changed = true;
      }
    }
  }
}

function sortByPlanOrder(
  chosen: readonly PlannedExercise[],
  original: readonly PlannedExercise[],
): PlannedExercise[] {
  const position = new Map(original.map((pe, index) => [pe.id, index]));
  return [...chosen].sort(
    (a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity),
  );
}

function finalize(
  session: PlannedSession,
  exercises: readonly PlannedExercise[],
  lookup: Lookup,
): PlannedSession {
  const ordered = exercises.map((pe, order) => ({
    ...pe,
    planned_session_id: session.id,
    order,
  }));
  return { ...session, exercises: ordered, est_minutes: minutesOf(ordered, session, lookup) };
}

export interface MinimumDoseOptions {
  profile: Pick<Profile, 'equipment' | 'limitations'>;
  newId: IdGenerator;
  catalog?: readonly Exercise[];
}

/**
 * The "minimum dose" (research 3.2): a 10-15 minute circuit that keeps the streak alive.
 * Built from the planned session's key exercises when the user can still do them (equipment
 * and current limitations). When they are missing or too few for 10 minutes, it tops up with the
 * session's other exercises, then catalog bodyweight exercises that respect the limitations
 * (those training the session's own muscles first). Circuit rules: one superset group, 30 s rest, sets added round-robin (up to 4)
 * until the session reaches 10 minutes, never above 15. Exercises from the session keep their ids;
 * catalog exercises get new ids. The session keeps its id, date and status.
 */
export function minimumDoseSession(
  session: PlannedSession,
  opts: MinimumDoseOptions,
): PlannedSession {
  const catalog = opts.catalog ?? EXERCISE_CATALOG;
  const lookup = createCatalogLookup(catalog);
  const dose: PlannedSession = { ...session, variant: 'minimum_dose', exercises: [] };
  const asCircuit = (pe: PlannedExercise): PlannedExercise => ({
    ...pe,
    sets: 1,
    rest_sec: MINIMUM_DOSE_REST_SEC,
    superset_group: MINIMUM_DOSE_SUPERSET,
  });
  const usable = session.exercises.filter(
    (pe) => !isConditioning(pe, lookup) && isEligible(lookup(pe.exercise_id), opts.profile),
  );
  const keys = usable.filter((pe) => pe.is_key).slice(0, MINIMUM_DOSE_START_EXERCISES);
  const sessionMuscleSet = new Set(usable.flatMap((pe) => lookup(pe.exercise_id).primary_muscles));
  // Top-ups in order: the session's other exercises, bodyweight options for the same muscles,
  // then any other bodyweight option (so the dose rarely adds muscles the session did not train).
  const fallback = [
    ...usable.filter((pe) => !pe.is_key),
    ...bodyweightOptions(session, opts, catalog, keys, sessionMuscleSet),
  ].map(asCircuit);
  const chosen = (keys.length > 0 ? keys : fallback.splice(0, MINIMUM_DOSE_START_EXERCISES)).map(
    asCircuit,
  );
  if (chosen.length === 0) {
    throw new Error('No exercise is available for a minimum-dose session');
  }

  const maxSec = MINIMUM_DOSE_MINUTES.max * 60;
  const minSec = MINIMUM_DOSE_MINUTES.min * 60;
  const seconds = () => estimateSessionSeconds(chosen, 'minimum_dose', lookup);
  while (seconds() < minSec) {
    const next = chosen
      .filter((pe) => pe.sets < MINIMUM_DOSE_MAX_SETS)
      .sort((a, b) => a.sets - b.sets)[0];
    const extra = next ? secondsPerSet(next, lookup(next.exercise_id)) : Infinity;
    if (next && seconds() + extra <= maxSec) {
      next.sets += 1;
      continue;
    }
    const added = fallback.shift();
    if (!added) {
      throw new Error('Cannot build a 10-15 minute minimum-dose session');
    }
    chosen.push(added);
  }
  while (seconds() > maxSec && chosen.length > 1) {
    chosen.pop();
  }
  return finalize(dose, chosen, lookup);
}

/**
 * Catalog bodyweight exercises (new ids), at most one per pattern not already covered:
 * first those whose primary muscles the session already trains, then the rest.
 */
function bodyweightOptions(
  session: PlannedSession,
  opts: MinimumDoseOptions,
  catalog: readonly Exercise[],
  kept: readonly PlannedExercise[],
  sessionMuscles: ReadonlySet<string>,
): PlannedExercise[] {
  const lookup = createCatalogLookup(catalog);
  const covered = new Set(kept.map((pe) => lookup(pe.exercise_id).pattern));
  const ctx = {
    catalog,
    equipment: [],
    limitations: opts.profile.limitations,
    level: 'beginner',
  } as const;
  const sameMuscles = (exercise: Exercise) =>
    exercise.primary_muscles.every((muscle) => sessionMuscles.has(muscle));
  const picks: Exercise[] = [];
  for (const preferSameMuscles of [true, false]) {
    for (const pattern of MINIMUM_DOSE_PATTERNS) {
      if (covered.has(pattern)) {
        continue;
      }
      const exercise = rankCandidates({ pattern }, ctx).find(
        (candidate) => !candidate.low_stimulus && sameMuscles(candidate) === preferSameMuscles,
      );
      if (exercise) {
        covered.add(pattern);
        picks.push(exercise);
      }
    }
  }
  return picks.map((exercise) => {
    const timed = exercise.measure === 'seconds';
    return {
      id: opts.newId(),
      planned_session_id: session.id,
      exercise_id: exercise.id,
      order: 0,
      sets: 1,
      measure: exercise.measure,
      rep_min: timed ? TIMED_SCHEME.rep_min : 8,
      rep_max: timed ? TIMED_SCHEME.rep_max : 12,
      target_rir: 3,
      rest_sec: MINIMUM_DOSE_REST_SEC,
      is_key: false,
    };
  });
}

/**
 * Content of a session that absorbs another (merge): the absorbing session's key exercises,
 * then the merged session's key exercises (copied with new ids; exercises already present are
 * not duplicated), then the absorbing session's other exercises while the total stays within
 * its planned duration.
 */
export function mergeSessionExercises(
  absorbing: PlannedSession,
  merged: PlannedSession,
  newId: IdGenerator,
  catalog: readonly Exercise[] = EXERCISE_CATALOG,
): PlannedSession {
  const lookup = createCatalogLookup(catalog);
  const present = new Set(absorbing.exercises.map((pe) => pe.exercise_id));
  const ownKeys = absorbing.exercises.filter((pe) => pe.is_key);
  const borrowed = merged.exercises
    .filter((pe) => pe.is_key && !present.has(pe.exercise_id))
    .map((pe) => ({ ...pe, id: newId() }));
  const chosen = [...ownKeys, ...borrowed];
  for (const pe of absorbing.exercises.filter((item) => !item.is_key)) {
    if (minutesOf([...chosen, pe], absorbing, lookup) <= absorbing.est_minutes) {
      chosen.push(pe);
    }
  }
  return finalize(absorbing, chosen, lookup);
}
