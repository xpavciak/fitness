import { z } from 'zod';
import {
  BodyRegionSchema,
  EquipmentSchema,
  ExerciseIdSchema,
  ExperienceLevelSchema,
  MovementPatternSchema,
  MuscleGroupSchema,
  hasNoDuplicates,
  uniqueArray,
} from './common.js';

/** How a set is measured: repetitions, or seconds held/performed. */
export const EXERCISE_MEASURES = ['reps', 'seconds'] as const;
export const ExerciseMeasureSchema = z.enum(EXERCISE_MEASURES);
export type ExerciseMeasure = z.infer<typeof ExerciseMeasureSchema>;

export const ExerciseSchema = z
  .object({
    id: ExerciseIdSchema,
    name: z.string().trim().min(1).max(80),
    pattern: MovementPatternSchema,
    primary_muscles: uniqueArray(MuscleGroupSchema).min(1),
    secondary_muscles: uniqueArray(MuscleGroupSchema),
    /**
     * All equipment required. `['bodyweight']` means nothing is required; it must
     * then be the only entry.
     */
    equipment: uniqueArray(EquipmentSchema).min(1),
    level: ExperienceLevelSchema,
    contraindication_tags: uniqueArray(BodyRegionSchema),
    /** Ids of catalog exercises that can replace this one (same pattern). */
    substitutes: uniqueArray(ExerciseIdSchema),
    /** Short technique cues shown during the workout. */
    cues: z.array(z.string().trim().min(1).max(120)).min(1).max(5),
    /** Whether targets are reps or seconds. */
    measure: ExerciseMeasureSchema,
    /** Whether an external load (kg) is tracked and progressed. */
    loadable: z.boolean(),
    /** Performed one side at a time (sets are per side). */
    unilateral: z.boolean(),
  })
  .superRefine((exercise, ctx) => {
    if (exercise.equipment.includes('bodyweight') && exercise.equipment.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['equipment'],
        message: '"bodyweight" means no equipment and must be the only entry',
      });
    }
    if (exercise.substitutes.includes(exercise.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['substitutes'],
        message: 'An exercise cannot be its own substitute',
      });
    }
    const overlap = exercise.secondary_muscles.filter((m) => exercise.primary_muscles.includes(m));
    if (overlap.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['secondary_muscles'],
        message: `Muscles listed as both primary and secondary: ${overlap.join(', ')}`,
      });
    }
  });
export type Exercise = z.infer<typeof ExerciseSchema>;

/**
 * A full catalog: every entry valid, ids unique, every substitute resolvable.
 */
export const ExerciseCatalogSchema = z
  .array(ExerciseSchema)
  .min(1)
  .superRefine((catalog, ctx) => {
    const ids = catalog.map((exercise) => exercise.id);
    if (!hasNoDuplicates(ids)) {
      const seen = new Set<string>();
      const duplicates = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate exercise ids: ${[...new Set(duplicates)].join(', ')}`,
      });
    }
    const known = new Set(ids);
    catalog.forEach((exercise, index) => {
      exercise.substitutes.forEach((substituteId, subIndex) => {
        if (!known.has(substituteId)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'substitutes', subIndex],
            message: `Unknown substitute "${substituteId}" for "${exercise.id}"`,
          });
        }
      });
    });
  });
export type ExerciseCatalog = z.infer<typeof ExerciseCatalogSchema>;
