/**
 * Load conventions (all loads are stored in kg; unit conversion happens in the UI).
 *
 * - `SetLog.load_kg` and `PlannedExercise.target_load_kg` are **per implement**:
 *   per dumbbell or per kettlebell (i.e. per hand). Two 12 kg dumbbells => 12.
 * - Barbell loads are the **total** including the bar. 20 kg bar + 2 x 10 kg => 40.
 * - Machine and cable loads are the stack / pin value shown on the machine.
 * - Bodyweight exercises log `load_kg: 0` (added load such as a vest is logged as the added kg).
 */

export const BARBELL_WEIGHT_KG = 20;

/** Standard plate sizes (per plate). Barbell jumps are made with pairs, one per side. */
export const BARBELL_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

/** Default load increments used by progression (T5) when a target goes up. */
export const LOAD_INCREMENTS_KG = {
  /** Upper-body barbell lifts: one 1.25 kg plate per side. */
  barbell_upper: 2.5,
  /** Lower-body barbell lifts: one 2.5 kg plate per side. */
  barbell_lower: 5,
  /** Per dumbbell; typical fixed-dumbbell racks step by 2 kg (2.5 kg in some gyms). */
  dumbbells: 2,
  /** Per kettlebell; standard kettlebell sizes step by 4 kg. */
  kettlebell: 4,
  machine: 5,
  cable: 2.5,
} as const;

export type LoadIncrementKey = keyof typeof LOAD_INCREMENTS_KG;

/** Barbell loads move in pairs of the smallest plate (one per side). */
export const BARBELL_ROUNDING_STEP_KG = 2 * Math.min(...BARBELL_PLATES_KG);

const LOWER_BODY_PATTERNS: readonly string[] = ['squat', 'lunge', 'hinge'];

/** How loads for an exercise can change: the progression increment and the rounding grid. */
export interface LoadSteps {
  /** Default jump when progressing (double progression). */
  incrementKg: number;
  /** Loads are rounded to multiples of this value. */
  roundingStepKg: number;
  /** Smallest usable load (the empty bar for barbell lifts). */
  minimumKg: number;
}

/**
 * Load steps for a catalog exercise, derived from its equipment and pattern.
 * `stepOverrideKg` replaces both the increment and the rounding grid (e.g. a gym whose
 * dumbbells step by 2.5 kg).
 */
export function loadStepsFor(
  exercise: { equipment: readonly string[]; pattern: string },
  stepOverrideKg?: number,
): LoadSteps {
  if (stepOverrideKg !== undefined) {
    if (!(stepOverrideKg > 0) || !Number.isFinite(stepOverrideKg)) {
      throw new RangeError(`Load step must be a positive number, got ${stepOverrideKg}`);
    }
  }
  const steps = baseLoadSteps(exercise);
  return stepOverrideKg === undefined
    ? steps
    : { ...steps, incrementKg: stepOverrideKg, roundingStepKg: stepOverrideKg };
}

function baseLoadSteps(exercise: { equipment: readonly string[]; pattern: string }): LoadSteps {
  const has = (item: string) => exercise.equipment.includes(item);
  if (has('barbell')) {
    const incrementKg = LOWER_BODY_PATTERNS.includes(exercise.pattern)
      ? LOAD_INCREMENTS_KG.barbell_lower
      : LOAD_INCREMENTS_KG.barbell_upper;
    return { incrementKg, roundingStepKg: BARBELL_ROUNDING_STEP_KG, minimumKg: BARBELL_WEIGHT_KG };
  }
  const key: LoadIncrementKey = has('dumbbells')
    ? 'dumbbells'
    : has('kettlebell')
      ? 'kettlebell'
      : has('cable')
        ? 'cable'
        : 'machine';
  const step = LOAD_INCREMENTS_KG[key];
  return { incrementKg: step, roundingStepKg: step, minimumKg: step };
}

/**
 * Rounds a load to the equipment grid (multiples of `roundingStepKg`, never below `minimumKg`).
 * Results are rounded to 2 decimals to avoid floating-point noise such as 22.500000000000004.
 */
export function roundLoad(kg: number, steps: LoadSteps, mode: 'nearest' | 'up' | 'down'): number {
  if (!Number.isFinite(kg) || kg < 0) {
    throw new RangeError(`Load must be a non-negative finite number, got ${kg}`);
  }
  const ratio = kg / steps.roundingStepKg;
  // Tolerate float noise before ceil/floor (e.g. 12.000000001 / 2).
  const snapped = Math.abs(ratio - Math.round(ratio)) < 1e-9 ? Math.round(ratio) : ratio;
  const units =
    mode === 'up'
      ? Math.ceil(snapped)
      : mode === 'down'
        ? Math.floor(snapped)
        : Math.round(snapped);
  const rounded = Math.round(units * steps.roundingStepKg * 100) / 100;
  return Math.max(rounded, steps.minimumKg);
}
