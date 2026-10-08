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
