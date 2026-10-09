import { describe, expect, it } from 'vitest';
import { EQUIPMENT_TIERS, exerciseTier, isExerciseAvailable } from '../equipment.js';
import {
  BODY_REGIONS,
  ExerciseCatalogSchema,
  ExerciseSchema,
  MOVEMENT_PATTERNS,
  type BodyRegion,
  type ExerciseId,
} from '../schemas/index.js';
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

  it('isolation substitutes share at least one primary muscle', () => {
    const problems: string[] = [];
    for (const exercise of EXERCISE_CATALOG.filter((e) => e.pattern === 'isolation')) {
      for (const substituteId of exercise.substitutes) {
        const substitute = getExerciseById(substituteId);
        const shared = substitute?.primary_muscles.some((m) =>
          exercise.primary_muscles.includes(m),
        );
        if (!shared) {
          problems.push(`${exercise.id} -> ${substituteId}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('every low-stimulus exercise has a substitute that is not low-stimulus', () => {
    const lowStimulus = EXERCISE_CATALOG.filter((exercise) => exercise.low_stimulus);
    expect(lowStimulus.map((exercise) => exercise.id)).toContain('prone_lat_pulldown');
    for (const exercise of lowStimulus) {
      const real = exercise.substitutes.filter((id) => getExerciseById(id)?.low_stimulus === false);
      expect(real.length, exercise.id).toBeGreaterThan(0);
    }
  });
});

describe('contraindication tags', () => {
  const MIN_EXERCISES_PER_REGION = 3;

  it.each(BODY_REGIONS)(
    `region "%s" tags at least ${MIN_EXERCISES_PER_REGION} exercises`,
    (region) => {
      const tagged = EXERCISE_CATALOG.filter((e) => e.contraindication_tags.includes(region));
      expect(tagged.length).toBeGreaterThanOrEqual(MIN_EXERCISES_PER_REGION);
    },
  );

  /** Well-known risky exercises per region; every region must be listed. */
  const KNOWN_RISKS: Record<BodyRegion, ExerciseId[]> = {
    knee: ['barbell_back_squat', 'jump_squat', 'leg_extension', 'dumbbell_walking_lunge'],
    lower_back: ['barbell_deadlift', 'barbell_bent_over_row', 'kettlebell_swing'],
    shoulder: [
      'barbell_overhead_press',
      'barbell_bench_press',
      'machine_chest_press',
      'pull_up',
      'assisted_pull_up',
      'dumbbell_lateral_raise',
    ],
    wrist: ['push_up', 'barbell_front_squat', 'burpee'],
    elbow: ['chin_up', 'cable_triceps_pushdown', 'bench_dip'],
    hip: [
      'barbell_back_squat',
      'barbell_deadlift',
      'barbell_romanian_deadlift',
      'dumbbell_bulgarian_split_squat',
      'barbell_hip_thrust',
      'kettlebell_swing',
      'goblet_squat',
      'leg_press',
      'burpee',
      'jump_squat',
    ],
    ankle: ['jump_squat', 'jumping_jacks', 'burpee'],
    neck: ['barbell_back_squat', 'cable_crunch'],
  };

  it.each(Object.entries(KNOWN_RISKS))(
    'region "%s" tags its known-risk exercises',
    (region, riskIds) => {
      const missing = riskIds.filter(
        (id) => !getExerciseById(id)?.contraindication_tags.includes(region as BodyRegion),
      );
      expect(missing).toEqual([]);
    },
  );

  it('every lunge is tagged for knee and hip', () => {
    const untagged = EXERCISE_CATALOG.filter(
      (e) =>
        e.pattern === 'lunge' &&
        !(e.contraindication_tags.includes('knee') && e.contraindication_tags.includes('hip')),
    );
    expect(untagged.map((e) => e.id)).toEqual([]);
  });
});
