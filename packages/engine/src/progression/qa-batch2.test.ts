/**
 * QA batch 2 (T5): hand-computed nextTargets cases across equipment grids, plus e1RM/PR checks.
 * `it.fails` marks a confirmed BUG; flip it to `it` once fixed.
 */
import { describe, expect, it } from 'vitest';
import { uuid } from '../__fixtures__/samples.js';
import { getExerciseById } from '../catalog/index.js';
import type { PlannedExercise, SetLog } from '../schemas/index.js';
import { nextTargets } from './next-targets.js';
import { estimate1RM, personalRecords } from './one-rep-max.js';

const TODAY = '2026-10-08';
let counter = 0;

function planned(exerciseId: string, overrides: Partial<PlannedExercise> = {}): PlannedExercise {
  return {
    id: uuid(900),
    planned_session_id: uuid(901),
    exercise_id: exerciseId,
    order: 0,
    sets: 3,
    measure: getExerciseById(exerciseId)?.measure ?? 'reps',
    rep_min: 8,
    rep_max: 12,
    target_rir: 2,
    rest_sec: 90,
    is_key: true,
    ...overrides,
  };
}

/** [reps, load, rir?, completed?] per set, one workout on `date`. */
function workout(
  exerciseId: string,
  date: string,
  specs: readonly [number, number, number?, boolean?][],
): SetLog[] {
  counter += 1;
  const log = uuid(5000 + counter);
  return specs.map(([reps, load, rir, completed = true], index) => {
    counter += 1;
    const set: SetLog = {
      id: uuid(6000 + counter),
      workout_log_id: log,
      exercise_id: exerciseId,
      set_index: index,
      measure: getExerciseById(exerciseId)?.measure ?? 'reps',
      reps,
      load_kg: load,
      is_warmup: false,
      completed,
      performed_at: `${date}T17:00:00Z`,
    };
    return rir === undefined ? set : { ...set, rir };
  });
}

const run = (pe: PlannedExercise, sets: SetLog[]) =>
  nextTargets(pe, sets, {
    today: TODAY,
    timezone: 'Europe/Bratislava',
    experienceLevel: 'intermediate',
  });

describe('QA batch 2: nextTargets hand-computed cases', () => {
  it.each([
    // [label, exercise, sets, expected decision, expected load, expected target reps]
    [
      'barbell squat 3x12 @RIR2 -> +5 kg',
      'barbell_back_squat',
      [
        [12, 100, 2],
        [12, 100, 2],
        [12, 100, 2],
      ],
      'increase_load',
      105,
      8,
    ],
    [
      'bench 3x12 @RIR4 (too easy) -> max(+2.5, +5% up) = 65',
      'barbell_bench_press',
      [
        [12, 60, 4],
        [12, 60, 4],
        [12, 60, 4],
      ],
      'increase_load',
      65,
      8,
    ],
    [
      'bench failed at 62.5 -> 59.375 rounded down to 57.5',
      'barbell_bench_press',
      [
        [8, 62.5, 1],
        [5, 62.5, 0, false],
      ],
      'decrease_load',
      57.5,
      8,
    ],
    [
      'squat RIR 0 (target 2) -> 95',
      'barbell_back_squat',
      [
        [10, 100, 1],
        [10, 100, 1],
        [9, 100, 0],
      ],
      'decrease_load',
      95,
      8,
    ],
    [
      'squat RIR missing -> same load, +1 rep',
      'barbell_back_squat',
      [
        [10, 100],
        [10, 100],
        [9, 100],
      ],
      'add_reps',
      100,
      10,
    ],
    [
      'squat RIR 4 mid-range -> +5% = 105, same reps',
      'barbell_back_squat',
      [
        [10, 100, 4],
        [10, 100, 4],
        [10, 100, 4],
      ],
      'increase_load',
      105,
      10,
    ],
    [
      '11 kg dumbbells at top -> 13 rounds to 14 on the 2 kg grid',
      'dumbbell_bench_press',
      [
        [12, 11, 2],
        [12, 11, 2],
        [12, 11, 2],
      ],
      'increase_load',
      14,
      8,
    ],
    [
      '16 kg kettlebell failed -> 15.2 rounded down to 12',
      'kettlebell_swing',
      [[8, 16, 0, false]],
      'decrease_load',
      12,
      8,
    ],
    [
      '16 kg kettlebell at top -> 20',
      'kettlebell_swing',
      [
        [12, 16, 2],
        [12, 16, 2],
        [12, 16, 2],
      ],
      'increase_load',
      20,
      8,
    ],
    [
      'empty bar failed -> stays at the 20 kg minimum',
      'barbell_bench_press',
      [[5, 20, 0, false]],
      'decrease_load',
      20,
      8,
    ],
  ] as const)('%s', (_label, exerciseId, specs, decision, load, reps) => {
    const result = run(planned(exerciseId), workout(exerciseId, '2026-10-05', specs as never));
    expect(result.decision).toBe(decision);
    expect(result.target_load_kg).toBe(load);
    expect(result.target_reps).toBe(reps);
  });

  it.each([
    ['2026-09-10', 28, 90],
    ['2026-09-09', 29, 80],
  ])('break from %s (%i days) -> %i kg', (date, days, load) => {
    const result = run(
      planned('barbell_back_squat'),
      workout('barbell_back_squat', date, [[10, 100, 2]]),
    );
    expect(result.decision).toBe('break_reset');
    expect(result.target_load_kg).toBe(load);
    expect(result.reason).toContain(`${days} days`);
  });

  it('timed and loaded: farmers carry at the top of 30-45 s adds 2 kg and restarts at 30 s', () => {
    const pe = planned('farmers_carry', { rep_min: 30, rep_max: 45 });
    const result = run(
      pe,
      workout('farmers_carry', '2026-10-05', [
        [45, 20, 2],
        [45, 20, 2],
        [45, 20, 2],
      ]),
    );
    expect(result).toMatchObject({
      decision: 'increase_load',
      target_load_kg: 22,
      target_reps: 30,
    });
  });

  it('timed bodyweight: plank too easy mid-range adds two 5 s steps', () => {
    const pe = planned('plank', { rep_min: 30, rep_max: 60 });
    const result = run(
      pe,
      workout('plank', '2026-10-05', [
        [40, 0, 5],
        [40, 0, 5],
        [40, 0, 5],
      ]),
    );
    expect(result).toMatchObject({ decision: 'add_reps', target_reps: 50 });
    expect(result.target_load_kg).toBeUndefined();
  });

  // Fixed (QA bug 7, S5): at the minimum load the reason says the weight stays.
  it('the reason does not claim a drop when the load cannot go lower', () => {
    const result = run(
      planned('barbell_bench_press'),
      workout('barbell_bench_press', '2026-10-05', [[5, 20, 0, false]]),
    );
    expect(result.target_load_kg).toBe(20);
    expect(result.reason).not.toMatch(/drops/);
  });

  // Fixed (QA bug 8): unloaded exercises never mention weight.
  it('bodyweight plank reason does not talk about weight', () => {
    const pe = planned('plank', { rep_min: 30, rep_max: 60 });
    const result = run(
      pe,
      workout('plank', '2026-10-05', [
        [45, 0, 2],
        [45, 0, 2],
        [50, 0, 2],
      ]),
    );
    expect(result.reason).not.toMatch(/weight/i);
  });
});

describe('QA batch 2: e1RM and personal records', () => {
  it('matches hand-computed Epley and Brzycki values', () => {
    expect(estimate1RM(100, 5)).toBe(116.7);
    expect(estimate1RM(100, 5, 'brzycki')).toBe(112.5);
    expect(estimate1RM(110, 3)).toBe(121);
    expect(estimate1RM(100, 10, 'brzycki')).toBe(133.3);
  });

  it('ignores warm-ups and failed sets and keeps the earliest tie', () => {
    const sets = [
      ...workout('barbell_back_squat', '2026-09-01', [[5, 100, 2]]),
      ...workout('barbell_back_squat', '2026-09-08', [[3, 110, 1]]),
      ...workout('barbell_back_squat', '2026-09-15', [[12, 90, 2]]),
      ...workout('barbell_back_squat', '2026-09-22', [[3, 110, 1]]),
      ...workout('barbell_back_squat', '2026-09-24', [[2, 115, 0, false]]),
      ...workout('barbell_back_squat', '2026-09-23', [[1, 140]]).map((s) => ({
        ...s,
        is_warmup: true,
      })),
    ];
    const record = personalRecords(sets).barbell_back_squat;
    expect(record?.best_e1rm?.e1rm_kg).toBe(121);
    expect(record?.best_e1rm?.performed_at).toBe('2026-09-08T17:00:00Z');
    expect(record?.best_load?.load_kg).toBe(110);
    expect(record?.best_load?.performed_at).toBe('2026-09-08T17:00:00Z');
    expect(record?.best_reps?.reps).toBe(12);
  });
});
