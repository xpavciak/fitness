import { describe, expect, it } from 'vitest';
import { getExerciseById } from './catalog/index.js';
import { BARBELL_PLATES_KG, LOAD_INCREMENTS_KG, loadStepsFor, roundLoad } from './loads.js';

describe('load constants', () => {
  it('barbell increments are reachable with one pair of the smallest plates', () => {
    const smallestPair = 2 * Math.min(...BARBELL_PLATES_KG);
    expect(LOAD_INCREMENTS_KG.barbell_upper % smallestPair).toBe(0);
    expect(LOAD_INCREMENTS_KG.barbell_lower % smallestPair).toBe(0);
  });
});

describe('loadStepsFor and roundLoad', () => {
  const steps = (id: string) => {
    const exercise = getExerciseById(id);
    if (!exercise) {
      throw new Error(id);
    }
    return loadStepsFor(exercise);
  };

  it.each([
    ['barbell_back_squat', 5, 2.5, 20],
    ['barbell_bench_press', 2.5, 2.5, 20],
    ['goblet_squat', 2, 2, 2],
    ['kettlebell_swing', 4, 4, 4],
    ['leg_press', 5, 5, 5],
    ['lat_pulldown', 2.5, 2.5, 2.5],
  ] as const)('%s: increment %d, grid %d, minimum %d', (id, increment, grid, minimum) => {
    expect(steps(id)).toEqual({ incrementKg: increment, roundingStepKg: grid, minimumKg: minimum });
  });

  it('rounds to the grid in each direction and respects the minimum', () => {
    const barbell = steps('barbell_bench_press');
    expect(roundLoad(61, barbell, 'down')).toBe(60);
    expect(roundLoad(61, barbell, 'up')).toBe(62.5);
    expect(roundLoad(61.2, barbell, 'nearest')).toBe(60);
    expect(roundLoad(12, barbell, 'nearest')).toBe(20);
    const dumbbell = steps('goblet_squat');
    expect(roundLoad(12.000000001, dumbbell, 'up')).toBe(12);
    expect(roundLoad(0.5, dumbbell, 'down')).toBe(2);
  });

  it('accepts a step override and rejects invalid input', () => {
    const exercise = getExerciseById('goblet_squat');
    if (!exercise) {
      throw new Error('goblet_squat');
    }
    expect(loadStepsFor(exercise, 2.5)).toEqual({
      incrementKg: 2.5,
      roundingStepKg: 2.5,
      minimumKg: 2,
    });
    expect(() => loadStepsFor(exercise, 0)).toThrow(RangeError);
    expect(() => roundLoad(-1, loadStepsFor(exercise), 'down')).toThrow(RangeError);
  });
});
