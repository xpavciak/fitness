import { describe, expect, it } from 'vitest';
import { exerciseTier, isExerciseAvailable } from './equipment.js';

describe('equipment helpers', () => {
  it('treats bodyweight as always available', () => {
    expect(isExerciseAvailable({ equipment: ['bodyweight'] }, [])).toBe(true);
  });

  it('requires every listed piece of equipment', () => {
    const benchPress = { equipment: ['dumbbells', 'bench'] } as const;
    expect(isExerciseAvailable({ equipment: [...benchPress.equipment] }, ['dumbbells'])).toBe(
      false,
    );
    expect(
      isExerciseAvailable({ equipment: [...benchPress.equipment] }, ['dumbbells', 'bench']),
    ).toBe(true);
  });

  it('assigns the smallest tier', () => {
    expect(exerciseTier({ equipment: ['bodyweight'] })).toBe('bodyweight');
    expect(exerciseTier({ equipment: ['dumbbells', 'bench'] })).toBe('dumbbells');
    expect(exerciseTier({ equipment: ['kettlebell'] })).toBe('full_gym');
    expect(exerciseTier({ equipment: ['pullup_bar'] })).toBe('full_gym');
  });
});
