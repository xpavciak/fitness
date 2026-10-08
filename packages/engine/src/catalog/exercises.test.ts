import { describe, expect, it } from 'vitest';
import { EQUIPMENT_TIERS, exerciseTier, isExerciseAvailable } from '../equipment.js';
import { ExerciseCatalogSchema, ExerciseSchema, MOVEMENT_PATTERNS } from '../schemas/index.js';
import { EXERCISE_CATALOG, getExerciseById } from './index.js';

describe('exercise catalog', () => {
  it('has roughly 80-120 exercises', () => {
    expect(EXERCISE_CATALOG.length).toBeGreaterThanOrEqual(80);
    expect(EXERCISE_CATALOG.length).toBeLessThanOrEqual(120);
  });

  it.each(EXERCISE_CATALOG.map((exercise) => [exercise.id, exercise] as const))(
    '%s validates against ExerciseSchema',
    (_id, exercise) => {
      const result = ExerciseSchema.safeParse(exercise);
      expect(result.error?.issues).toBeUndefined();
    },
  );

  it('validates as a whole catalog', () => {
    const result = ExerciseCatalogSchema.safeParse(EXERCISE_CATALOG);
    expect(result.error?.issues).toBeUndefined();
  });

  it('has unique ids', () => {
    const ids = EXERCISE_CATALOG.map((exercise) => exercise.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique names', () => {
    const names = EXERCISE_CATALOG.map((exercise) => exercise.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('every substitute references an existing exercise with the same movement pattern', () => {
    const problems: string[] = [];
    for (const exercise of EXERCISE_CATALOG) {
      for (const substituteId of exercise.substitutes) {
        const substitute = getExerciseById(substituteId);
        if (!substitute) {
          problems.push(`${exercise.id} -> ${substituteId}: missing`);
        } else if (substitute.pattern !== exercise.pattern) {
          problems.push(`${exercise.id} -> ${substituteId}: pattern ${substitute.pattern}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('every exercise has at least one substitute', () => {
    const without = EXERCISE_CATALOG.filter((exercise) => exercise.substitutes.length === 0);
    expect(without.map((exercise) => exercise.id)).toEqual([]);
  });

  it.each(MOVEMENT_PATTERNS)(
    'pattern "%s" has at least one variant in every equipment tier',
    (pattern) => {
      const tiers = new Set(
        EXERCISE_CATALOG.filter((exercise) => exercise.pattern === pattern).map(exerciseTier),
      );
      expect([...tiers].sort()).toEqual([...EQUIPMENT_TIERS].sort());
    },
  );

  it('every pattern has a beginner option doable with bodyweight only', () => {
    for (const pattern of MOVEMENT_PATTERNS) {
      const options = EXERCISE_CATALOG.filter(
        (exercise) =>
          exercise.pattern === pattern &&
          exercise.level === 'beginner' &&
          isExerciseAvailable(exercise, []),
      );
      expect(options.length, pattern).toBeGreaterThan(0);
    }
  });

  it('getExerciseById returns undefined for unknown ids', () => {
    expect(getExerciseById('goblet_squat')?.name).toBe('Dumbbell Goblet Squat');
    expect(getExerciseById('does_not_exist')).toBeUndefined();
  });
});
