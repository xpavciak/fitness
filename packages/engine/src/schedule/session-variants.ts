import { EXERCISE_CATALOG } from '../catalog/index.js';
import { createCatalogLookup } from '../catalog/lookup.js';
import type { IdGenerator } from '../ids.js';
import { countsTowardVolume } from '../plan/rules.js';
import { isEligible, rankCandidates } from '../plan/select.js';
import {
  estimateSessionMinutes,
  estimateSessionSeconds,
  TIME_MODEL,
} from '../plan/session-time.js';
import { CONDITIONING_EXERCISES, TIMED_SCHEME } from '../plan/templates.js';
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
  /** Longest allowed duration, 10-15 minutes (default 15). */
  maxMinutes?: number;
}

/** Hard sets per primary muscle (conditioning and low-stimulus excluded). */
function muscleSets(exercises: readonly PlannedExercise[], lookup: Lookup): Map<string, number> {
  const totals = new Map<string, number>();
  for (const pe of exercises) {
    const exercise = lookup(pe.exercise_id);
    if (!countsTowardVolume(exercise)) {
      continue;
    }
    for (const muscle of exercise.primary_muscles) {
      totals.set(muscle, (totals.get(muscle) ?? 0) + pe.sets);
    }
  }
  return totals;
}

/**
 * The "minimum dose" (research 3.2): a 10-15 minute circuit that keeps the streak alive.
 *
 * - Content: the planned session's key exercises the user can still do (equipment and current
 *   limitations); when they are missing or too few for 10 minutes, the session's other
 *   exercises, then catalog bodyweight exercises that respect the limitations (those training the
 *   session's own muscles first), and as a last resort one easy conditioning block.
 * - Volume (QA bug 6): an exercise from the session never gets more sets than planned, and hard
 *   sets per muscle never exceed the full session's, so the weekly caps still hold.
 * - Circuit: one superset group, 30 s rest, sets added round-robin until the dose reaches 10
 *   minutes, never above `maxMinutes` (10-15).
 * Exercises from the session keep their ids; catalog exercises get new ids. The session keeps its
 * id, date and status.
 */
export function minimumDoseSession(
  session: PlannedSession,
  opts: MinimumDoseOptions,
): PlannedSession {
  const maxMinutes = opts.maxMinutes ?? MINIMUM_DOSE_MINUTES.max;
  if (
    !Number.isInteger(maxMinutes) ||
    maxMinutes < MINIMUM_DOSE_MINUTES.min ||
    maxMinutes > MINIMUM_DOSE_MINUTES.max
  ) {
    throw new RangeError(
      `maxMinutes must be an integer from ${MINIMUM_DOSE_MINUTES.min} to ${MINIMUM_DOSE_MINUTES.max}, got ${maxMinutes}`,
    );
  }
  const catalog = opts.catalog ?? EXERCISE_CATALOG;
  const lookup = createCatalogLookup(catalog);
  const dose: PlannedSession = { ...session, variant: 'minimum_dose', exercises: [] };
  // Largest seconds that still round to maxMinutes; 10 minutes is reached at 570 s.
  const maxSec = maxMinutes * 60 + 29;
  const minSec = MINIMUM_DOSE_MINUTES.min * 60 - 30;
  const budget = muscleSets(session.exercises, lookup);
  const plannedSets = new Map(session.exercises.map((pe) => [pe.id, pe.sets]));
  const maxSetsOf = (pe: PlannedExercise) =>
    Math.min(MINIMUM_DOSE_MAX_SETS, plannedSets.get(pe.id) ?? MINIMUM_DOSE_MAX_SETS);
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
  const queue = [
    ...keys,
    ...usable.filter((pe) => !pe.is_key),
    ...bodyweightOptions(session, opts, catalog, usable, sessionMuscleSet),
  ].map(asCircuit);

  const chosen: PlannedExercise[] = [];
  const seconds = () => estimateSessionSeconds(chosen, 'minimum_dose', lookup);
  const withinBudget = (candidate: readonly PlannedExercise[]) => {
    const totals = muscleSets(candidate, lookup);
    return [...totals].every(([muscle, sets]) => sets <= (budget.get(muscle) ?? 0));
  };
  const tryAdd = (pe: PlannedExercise): boolean => {
    const next = [...chosen, pe];
    if (withinBudget(next) && estimateSessionSeconds(next, 'minimum_dose', lookup) <= maxSec) {
      chosen.push(pe);
      return true;
    }
    return false;
  };
  const tryAddSet = (): boolean => {
    const ordered = [...chosen].sort((a, b) => a.sets - b.sets);
    for (const pe of ordered) {
      if (pe.sets >= maxSetsOf(pe)) {
        continue;
      }
      const index = chosen.indexOf(pe);
      const next = chosen.map((item, i) => (i === index ? { ...item, sets: item.sets + 1 } : item));
      if (withinBudget(next) && estimateSessionSeconds(next, 'minimum_dose', lookup) <= maxSec) {
        chosen[index] = { ...pe, sets: pe.sets + 1 };
        return true;
      }
    }
    return false;
  };

  // Start with up to three exercises (keys first), then fill to 10 minutes.
  while (chosen.length < MINIMUM_DOSE_START_EXERCISES && queue.length > 0) {
    const next = queue.shift();
    if (next) {
      tryAdd(next);
    }
  }
  while (seconds() < minSec) {
    if (tryAddSet()) {
      continue;
    }
    const next = queue.shift();
    if (next) {
      tryAdd(next);
      continue;
    }
    addConditioning(chosen, session, opts, catalog, minSec + 30 - seconds());
    break;
  }
  if (chosen.length === 0 || seconds() > maxSec) {
    throw new Error(`Cannot build a ${MINIMUM_DOSE_MINUTES.min}-${maxMinutes} minute minimum dose`);
  }
  return finalize(dose, chosen, lookup);
}

/** One easy conditioning block (rest 0) lasting about `missingSec` including its transition. */
function addConditioning(
  chosen: PlannedExercise[],
  session: PlannedSession,
  opts: MinimumDoseOptions,
  catalog: readonly Exercise[],
  missingSec: number,
): void {
  const ctx = {
    catalog,
    equipment: opts.profile.equipment,
    limitations: opts.profile.limitations,
    level: 'beginner',
  } as const;
  const exercise = rankCandidates({ pattern: 'cardio' }, ctx).find((candidate) =>
    CONDITIONING_EXERCISES.includes(candidate.id),
  );
  if (!exercise) {
    throw new Error('No conditioning exercise is available to complete the minimum dose');
  }
  const duration = Math.max(30, Math.ceil((missingSec - TIME_MODEL.transitionSec) / 5) * 5);
  chosen.push({
    id: opts.newId(),
    planned_session_id: session.id,
    exercise_id: exercise.id,
    order: 0,
    sets: 1,
    measure: exercise.measure,
    rep_min: duration,
    rep_max: duration,
    target_rir: 4,
    rest_sec: 0,
    superset_group: MINIMUM_DOSE_SUPERSET,
    is_key: false,
  });
}

/**
 * Catalog bodyweight exercises (new ids), at most one per pattern not already in the session:
 * first those whose primary muscles the session already trains, then the rest.
 */
function bodyweightOptions(
  session: PlannedSession,
  opts: MinimumDoseOptions,
  catalog: readonly Exercise[],
  sessionExercises: readonly PlannedExercise[],
  sessionMuscles: ReadonlySet<string>,
): PlannedExercise[] {
  const lookup = createCatalogLookup(catalog);
  const covered = new Set(sessionExercises.map((pe) => lookup(pe.exercise_id).pattern));
  const usedIds = new Set(session.exercises.map((pe) => pe.exercise_id));
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
        (candidate) =>
          !candidate.low_stimulus &&
          !usedIds.has(candidate.id) &&
          sameMuscles(candidate) === preferSameMuscles,
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

export interface MergeOptions {
  newId: IdGenerator;
  /** The absorbing session may not get longer than this (session_minutes + 10%). */
  maxMinutes: number;
  catalog?: readonly Exercise[];
}

/**
 * Content of a session that absorbs another (merge, QA bug 3):
 * 1. the absorbing session's key exercises and the merged session's key exercises (copied with
 *    new ids; exercise ids already present are not duplicated);
 * 2. while that is longer than `maxMinutes`: sets of borrowed exercises are trimmed first, then
 *    the absorbing session's own key sets (never below 1), then borrowed exercises are dropped;
 * 3. the absorbing session's other exercises are added in plan order while they fit.
 * Returns the session and how many key exercises were borrowed (0 means the merge adds nothing).
 */
export function mergeSessionExercises(
  absorbing: PlannedSession,
  merged: PlannedSession,
  opts: MergeOptions,
): { session: PlannedSession; borrowed: number } {
  const lookup = createCatalogLookup(opts.catalog ?? EXERCISE_CATALOG);
  const present = new Set(absorbing.exercises.map((pe) => pe.exercise_id));
  const ownKeys = absorbing.exercises.filter((pe) => pe.is_key).map((pe) => ({ ...pe }));
  const borrowed = merged.exercises
    .filter((pe) => pe.is_key && !present.has(pe.exercise_id) && !isConditioning(pe, lookup))
    .map((pe) => ({ ...pe, id: opts.newId(), planned_session_id: absorbing.id }));
  const fits = (exercises: readonly PlannedExercise[]) =>
    minutesOf(exercises, absorbing, lookup) <= opts.maxMinutes;

  for (;;) {
    if (fits([...ownKeys, ...borrowed])) {
      break;
    }
    const trimmable =
      [...borrowed].reverse().find((pe) => pe.sets > 1) ??
      [...ownKeys].reverse().find((pe) => pe.sets > 1);
    if (trimmable) {
      trimmable.sets -= 1;
      continue;
    }
    if (borrowed.length === 0) {
      break;
    }
    borrowed.pop();
  }
  const chosen = [...ownKeys, ...borrowed];
  for (const pe of absorbing.exercises.filter((item) => !item.is_key)) {
    if (fits([...chosen, pe])) {
      chosen.push(pe);
    }
  }
  return { session: finalize(absorbing, chosen, lookup), borrowed: borrowed.length };
}
