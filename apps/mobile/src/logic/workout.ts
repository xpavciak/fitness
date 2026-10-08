import {
  EXERCISE_CATALOG,
  createCatalogValidators,
  getExerciseById,
  maxPerSet,
  type ExerciseMeasure,
  type ExperienceLevel,
  type IdGenerator,
  type NextTargets,
  type PlannedExercise,
  type PlannedSession,
  type SetLog,
  type WorkoutLog,
} from '@fitness/engine';
import { targetsFor } from '../engine/engine-service';
import type { SavedWorkoutDraft } from '../storage/repository';
import { exerciseName } from './labels';

/** One set row in the logging UI. Inputs are strings so the user can type freely. */
export interface SetDraft {
  id: string;
  setIndex: number;
  reps: string;
  loadKg: string;
  /** Reps in reserve; undefined when not entered. */
  rir: number | undefined;
  completed: boolean;
  performedAt: string | undefined;
}

export interface ExerciseDraft {
  planned: PlannedExercise;
  name: string;
  measure: ExerciseMeasure;
  loadable: boolean;
  cues: string[];
  targets: NextTargets;
  sets: SetDraft[];
}

export interface WorkoutDraft {
  id: string;
  sessionId: string;
  title: string;
  startedAt: string;
  exercises: ExerciseDraft[];
}

export interface WorkoutContext {
  /** User's local date. */
  today: string;
  timezone: string;
  /** The profile's level (beginners progress more conservatively). */
  experienceLevel: ExperienceLevel;
  now: string;
  newId: IdGenerator;
}

export const MAX_RIR_INPUT = 5;

/** Builds the logging form for a session, prefilled from `nextTargets`. */
export function buildWorkoutDraft(
  session: PlannedSession,
  history: readonly WorkoutLog[],
  ctx: WorkoutContext,
): WorkoutDraft {
  const allSets: SetLog[] = history.flatMap((log) => log.sets);
  const exercises = [...session.exercises]
    .sort((a, b) => a.order - b.order)
    .map((planned): ExerciseDraft => {
      const exercise = getExerciseById(planned.exercise_id);
      const targets = targetsFor(planned, allSets, {
        today: ctx.today,
        timezone: ctx.timezone,
        experienceLevel: ctx.experienceLevel,
      });
      const loadable = exercise?.loadable ?? false;
      const load = loadable ? (targets.target_load_kg ?? planned.target_load_kg) : 0;
      return {
        planned,
        name: exercise?.name ?? planned.exercise_id,
        measure: planned.measure,
        loadable,
        cues: exercise?.cues ?? [],
        targets,
        sets: Array.from({ length: targets.sets }, (_, setIndex) => ({
          id: ctx.newId(),
          setIndex,
          reps: String(targets.target_reps),
          loadKg: load === undefined ? '' : String(load),
          // RIR is not asked for timed sets (holds, carries, cardio).
          rir: planned.measure === 'seconds' ? undefined : targets.target_rir,
          completed: false,
          performedAt: undefined,
        })),
      };
    });
  return {
    id: ctx.newId(),
    sessionId: session.id,
    title: session.title,
    startedAt: ctx.now,
    exercises,
  };
}

/** Parses a whole number input; undefined when empty or invalid. */
export function parseWholeNumber(input: string): number | undefined {
  const trimmed = input.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

/** Parses a load in kg (decimal point or comma); undefined when empty or invalid. */
export function parseLoad(input: string): number | undefined {
  const trimmed = input.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return undefined;
  }
  const value = Number(trimmed);
  return value <= 1000 ? value : undefined;
}

/** Validation message for a set row, or null when it can be completed. */
export function setInputError(exercise: ExerciseDraft, set: SetDraft): string | null {
  const reps = parseWholeNumber(set.reps);
  const unit = exercise.measure === 'seconds' ? 'seconds' : 'reps';
  if (reps === undefined || reps < 1) {
    return `Enter the ${unit} (a whole number, at least 1).`;
  }
  if (reps > maxPerSet(exercise.measure)) {
    return `At most ${maxPerSet(exercise.measure)} ${unit}.`;
  }
  if (exercise.loadable && parseLoad(set.loadKg) === undefined) {
    return 'Enter the load in kg (0 for bodyweight).';
  }
  return null;
}

type SetUpdater = (set: SetDraft) => SetDraft;

export function updateSet(
  draft: WorkoutDraft,
  exerciseIndex: number,
  setIndex: number,
  update: SetUpdater,
): WorkoutDraft {
  return {
    ...draft,
    exercises: draft.exercises.map((exercise, e) =>
      e !== exerciseIndex
        ? exercise
        : {
            ...exercise,
            sets: exercise.sets.map((set, s) => (s === setIndex ? update(set) : set)),
          },
    ),
  };
}

export type ToggleSetResult =
  | {
      ok: true;
      draft: WorkoutDraft;
      /** Rest to start after completing; 0 when undone. */ restSec: number;
    }
  | { ok: false; error: string };

/** One-tap completion: validates the inputs and marks the set done (or undoes it). */
export function toggleSetCompleted(
  draft: WorkoutDraft,
  exerciseIndex: number,
  setIndex: number,
  now: string,
): ToggleSetResult {
  const exercise = draft.exercises[exerciseIndex];
  const set = exercise?.sets[setIndex];
  if (!exercise || !set) {
    return { ok: false, error: 'Unknown set.' };
  }
  if (set.completed) {
    return {
      ok: true,
      draft: updateSet(draft, exerciseIndex, setIndex, (s) => ({
        ...s,
        completed: false,
        performedAt: undefined,
      })),
      restSec: 0,
    };
  }
  const error = setInputError(exercise, set);
  if (error) {
    return { ok: false, error };
  }
  const completed = updateSet(draft, exerciseIndex, setIndex, (s) => ({
    ...s,
    completed: true,
    performedAt: now,
  }));
  // Carry the load forward to later sets of this exercise that have none yet.
  const withLoads = {
    ...completed,
    exercises: completed.exercises.map((ex, e) =>
      e !== exerciseIndex
        ? ex
        : {
            ...ex,
            sets: ex.sets.map((s, i) =>
              i > setIndex && !s.completed && s.loadKg.trim() === ''
                ? { ...s, loadKg: set.loadKg }
                : s,
            ),
          },
    ),
  };
  return { ok: true, draft: withLoads, restSec: exercise.planned.rest_sec };
}

export function completedSetCount(draft: WorkoutDraft): number {
  return draft.exercises.reduce(
    (sum, exercise) => sum + exercise.sets.filter((set) => set.completed).length,
    0,
  );
}

const validators = createCatalogValidators(EXERCISE_CATALOG);

/**
 * The schema-valid WorkoutLog for the completed sets. Throws when no set is completed or the
 * result fails validation (which would indicate a bug, since inputs are validated per set).
 */
export function workoutLogFromDraft(
  draft: WorkoutDraft,
  ctx: { userId: string; endedAt: string },
): WorkoutLog {
  // One set_index sequence per exercise_id across the workout (an exercise can appear twice,
  // e.g. after a merge), so (exercise_id, set_index) stays unique.
  const nextIndex = new Map<string, number>();
  const sets: SetLog[] = draft.exercises.flatMap((exercise) =>
    exercise.sets
      .filter((set) => set.completed)
      .map((set): SetLog => {
        const setIndex = nextIndex.get(exercise.planned.exercise_id) ?? 0;
        nextIndex.set(exercise.planned.exercise_id, setIndex + 1);
        const reps = parseWholeNumber(set.reps);
        const load = exercise.loadable ? parseLoad(set.loadKg) : 0;
        if (reps === undefined || load === undefined || set.performedAt === undefined) {
          throw new Error(`Set ${set.setIndex + 1} of ${exercise.name} has invalid input`);
        }
        return {
          id: set.id,
          workout_log_id: draft.id,
          exercise_id: exercise.planned.exercise_id,
          planned_exercise_id: exercise.planned.id,
          set_index: setIndex,
          measure: exercise.measure,
          reps,
          load_kg: load,
          ...(set.rir === undefined ? {} : { rir: set.rir }),
          is_warmup: false,
          completed: true,
          performed_at: set.performedAt,
        };
      }),
  );
  if (sets.length === 0) {
    throw new Error('Complete at least one set before finishing.');
  }
  const endedAt =
    Date.parse(ctx.endedAt) < Date.parse(draft.startedAt) ? draft.startedAt : ctx.endedAt;
  return validators.WorkoutLog.parse({
    id: draft.id,
    user_id: ctx.userId,
    planned_session_id: draft.sessionId,
    started_at: draft.startedAt,
    ended_at: endedAt,
    sets,
  });
}

/** Seconds left on a rest timer started at `startedAtMs` (never negative). */
export function restRemaining(durationSec: number, startedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil(durationSec - (nowMs - startedAtMs) / 1000));
}

export function formatSeconds(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** RIR stepper: "-" stops at 0 and "+" at `MAX_RIR_INPUT`; an empty RIR starts at 0. */
export function stepRir(rir: number | undefined, delta: 1 | -1): number | undefined {
  if (rir === undefined) {
    return delta === 1 ? 0 : undefined;
  }
  return Math.min(MAX_RIR_INPUT, Math.max(0, rir + delta));
}

export interface LoggedExercise {
  exerciseId: string;
  name: string;
  /** One line per set, e.g. "8 reps × 16 kg · RIR 2". */
  sets: string[];
}

/** Read-only summary of a saved workout, grouped by exercise in the logged order. */
export function summarizeLog(log: WorkoutLog): LoggedExercise[] {
  const groups = new Map<string, LoggedExercise>();
  for (const set of log.sets) {
    const group = groups.get(set.exercise_id) ?? {
      exerciseId: set.exercise_id,
      name: exerciseName(set.exercise_id),
      sets: [],
    };
    const amount = set.measure === 'seconds' ? `${set.reps} s` : `${set.reps} reps`;
    const load = set.load_kg > 0 ? ` × ${set.load_kg} kg` : '';
    const rir = set.rir === undefined ? '' : ` · RIR ${set.rir}`;
    group.sets.push(`${amount}${load}${rir}${set.completed ? '' : ' (not completed)'}`);
    groups.set(set.exercise_id, group);
  }
  return [...groups.values()];
}

/** The user's inputs of a draft, for `Repository.saveWorkoutDraft`. */
export function draftToSaved(draft: WorkoutDraft, savedAt: string): SavedWorkoutDraft {
  return {
    id: draft.id,
    session_id: draft.sessionId,
    started_at: draft.startedAt,
    saved_at: savedAt,
    sets: draft.exercises.flatMap((exercise) =>
      exercise.sets.map((set) => ({
        id: set.id,
        planned_exercise_id: exercise.planned.id,
        set_index: set.setIndex,
        reps: set.reps,
        load_kg: set.loadKg,
        ...(set.rir === undefined ? {} : { rir: set.rir }),
        completed: set.completed,
        ...(set.performedAt === undefined ? {} : { performed_at: set.performedAt }),
      })),
    ),
  };
}

/**
 * Overlays saved inputs on a freshly built draft of the same session. Sets are matched by planned
 * exercise and position; saved sets whose exercise is no longer in the session are dropped, and
 * new sets keep their prefilled values.
 */
export function restoreDraft(fresh: WorkoutDraft, saved: SavedWorkoutDraft): WorkoutDraft {
  if (saved.session_id !== fresh.sessionId) {
    return fresh;
  }
  const byKey = new Map(
    saved.sets.map((set) => [`${set.planned_exercise_id}#${set.set_index}`, set]),
  );
  return {
    ...fresh,
    id: saved.id,
    startedAt: saved.started_at,
    exercises: fresh.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => {
        const stored = byKey.get(`${exercise.planned.id}#${set.setIndex}`);
        if (!stored) {
          return set;
        }
        return {
          ...set,
          id: stored.id,
          reps: stored.reps,
          loadKg: stored.load_kg,
          rir: exercise.measure === 'seconds' ? undefined : stored.rir,
          completed: stored.completed && stored.performed_at !== undefined,
          performedAt: stored.completed ? stored.performed_at : undefined,
        };
      }),
    })),
  };
}
