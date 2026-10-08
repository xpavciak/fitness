import { SetLogSchema, type ExerciseMeasure, type SetLog } from '../schemas/index.js';

/** e1RM formulas are only reliable up to this many reps (research 2.2). */
export const MAX_REPS_FOR_E1RM = 10;

export const E1RM_FORMULAS = ['epley', 'brzycki'] as const;
export type E1rmFormula = (typeof E1RM_FORMULAS)[number];

/**
 * Estimated one-rep max in kg, rounded to 0.1 kg.
 * - Epley:   w x (1 + r / 30)
 * - Brzycki: w x 36 / (37 - r)
 * A single rep returns the load itself for both formulas. Returns undefined when the estimate is
 * not meaningful: no external load (0 kg), or more than 10 reps. Loads are per implement
 * (see `loads.ts`), so a dumbbell e1RM is per dumbbell.
 */
export function estimate1RM(
  loadKg: number,
  reps: number,
  formula: E1rmFormula = 'epley',
): number | undefined {
  if (!Number.isFinite(loadKg) || loadKg < 0) {
    throw new RangeError(`loadKg must be a non-negative finite number, got ${loadKg}`);
  }
  if (!Number.isInteger(reps) || reps < 1) {
    throw new RangeError(`reps must be a positive integer, got ${reps}`);
  }
  if (loadKg === 0 || reps > MAX_REPS_FOR_E1RM) {
    return undefined;
  }
  if (reps === 1) {
    return loadKg;
  }
  const estimate = formula === 'epley' ? loadKg * (1 + reps / 30) : (loadKg * 36) / (37 - reps);
  return Math.round(estimate * 10) / 10;
}

/** The set a record came from. */
export interface RecordSet {
  set_id: string;
  workout_log_id: string;
  performed_at: string;
  load_kg: number;
  reps: number;
}

export interface PersonalRecord {
  exercise_id: string;
  measure: ExerciseMeasure;
  /** Best estimated 1RM (rep-based sets with load and at most 10 reps). */
  best_e1rm?: RecordSet & { e1rm_kg: number };
  /** Heaviest completed working set (load > 0). */
  best_load?: RecordSet;
  /** Most reps (or longest duration for timed exercises) in one completed working set. */
  best_reps?: RecordSet;
}

/**
 * Personal records per exercise from completed, non-warm-up sets. Ties keep the earliest set
 * (the first time the record was reached). Returns a record keyed by exercise id.
 */
export function personalRecords(
  sets: readonly SetLog[],
  formula: E1rmFormula = 'epley',
): Record<string, PersonalRecord> {
  const ordered = sets
    .map((set) => SetLogSchema.parse(set))
    .filter((set) => set.completed && !set.is_warmup)
    .sort(
      (a, b) => Date.parse(a.performed_at) - Date.parse(b.performed_at) || (a.id < b.id ? -1 : 1),
    );
  const records: Record<string, PersonalRecord> = {};
  for (const set of ordered) {
    const record = (records[set.exercise_id] ??= {
      exercise_id: set.exercise_id,
      measure: set.measure,
    });
    const source: RecordSet = {
      set_id: set.id,
      workout_log_id: set.workout_log_id,
      performed_at: set.performed_at,
      load_kg: set.load_kg,
      reps: set.reps,
    };
    if (set.measure === 'reps') {
      const e1rm = estimate1RM(set.load_kg, set.reps, formula);
      if (e1rm !== undefined && e1rm > (record.best_e1rm?.e1rm_kg ?? 0)) {
        record.best_e1rm = { ...source, e1rm_kg: e1rm };
      }
    }
    if (set.load_kg > 0 && set.load_kg > (record.best_load?.load_kg ?? 0)) {
      record.best_load = source;
    }
    if (set.reps > (record.best_reps?.reps ?? 0)) {
      record.best_reps = source;
    }
  }
  return records;
}
