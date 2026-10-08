import type { Equipment, Exercise } from './schemas/index.js';
import { EQUIPMENT } from './schemas/index.js';

/**
 * Equipment tiers used for catalog coverage and home vs gym templates.
 * Tiers are nested: each one includes everything in the tiers before it.
 */
export const EQUIPMENT_TIERS = ['bodyweight', 'dumbbells', 'full_gym'] as const;
export type EquipmentTier = (typeof EQUIPMENT_TIERS)[number];

export const TIER_EQUIPMENT: Readonly<Record<EquipmentTier, readonly Equipment[]>> = {
  bodyweight: ['bodyweight'],
  dumbbells: ['bodyweight', 'dumbbells', 'bench'],
  full_gym: EQUIPMENT,
};

/** True when every piece of equipment the exercise needs is available. Bodyweight is always available. */
export function isExerciseAvailable(
  exercise: Pick<Exercise, 'equipment'>,
  available: readonly Equipment[],
): boolean {
  return exercise.equipment.every((item) => item === 'bodyweight' || available.includes(item));
}

/** The smallest tier in which the exercise can be performed. */
export function exerciseTier(exercise: Pick<Exercise, 'equipment'>): EquipmentTier {
  for (const tier of EQUIPMENT_TIERS) {
    if (isExerciseAvailable(exercise, TIER_EQUIPMENT[tier])) {
      return tier;
    }
  }
  // Unreachable: full_gym contains all equipment.
  return 'full_gym';
}
