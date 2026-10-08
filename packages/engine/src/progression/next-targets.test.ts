import { describe, expect, it } from 'vitest';
import { ids, samples, uuid } from '../__fixtures__/samples.js';
import type { PlannedExercise, SetLog } from '../schemas/index.js';
import { nextTargets, type NextTargets } from './next-targets.js';

const TODAY = '2026-10-08';

/** A planned exercise: goblet squat (dumbbells), 3 x 8-12 at RIR 2 by default. */
function planned(overrides: Partial<PlannedExercise> = {}): PlannedExercise {
  return { ...samples.plannedExercise(), target_rir: 2, ...overrides };
}

/** A planned exercise without a target load (bodyweight or timed holds). */
function unloaded(overrides: Partial<PlannedExercise>): PlannedExercise {
  const { target_load_kg: _drop, ...rest } = planned(overrides);
  return rest;
}

interface SetSpec {
  reps: number;
  load?: number;
  rir?: number;
  completed?: boolean;
  warmup?: boolean;
}

/** Working sets of one workout performed on `date` (12:00 UTC). */
function session(
  specs: readonly SetSpec[],
  { date = '2026-10-05', exercise = 'goblet_squat', measure = 'reps', log = ids.log } = {},
): SetLog[] {
  return specs.map((spec, index) => {
    const set: SetLog = {
      id: uuid(1000 + index + (log === ids.log ? 0 : 500)),
      workout_log_id: log,
      exercise_id: exercise,
      set_index: index,
      measure: measure as SetLog['measure'],
      reps: spec.reps,
      load_kg: spec.load ?? 12,
      is_warmup: spec.warmup ?? false,
      completed: spec.completed ?? true,
      performed_at: `${date}T12:${String(index).padStart(2, '0')}:00Z`,
    };
    return spec.rir === undefined ? set : { ...set, rir: spec.rir };
  });
}

const sets3 = (reps: number, rir: number | undefined, load = 12): SetSpec[] =>
  [0, 1, 2].map(() => (rir === undefined ? { reps, load } : { reps, load, rir }));

type Expectation = {
  [K in 'decision' | 'target_load_kg' | 'target_reps' | 'rep_min' | 'rep_max' | 'sets']?:
    NextTargets[K] | undefined;
};

describe('nextTargets (table-driven)', () => {
  const cases: [string, PlannedExercise, SetLog[], Expectation][] = [
    [
      'no history: the plan prescription',
      planned({ target_load_kg: 10 }),
      [],
      { decision: 'start', target_reps: 8, target_load_kg: 10, sets: 3 },
    ],
    [
      'all sets at the top of the range: +2 kg per dumbbell, back to rep_min',
      planned(),
      session(sets3(12, 2)),
      { decision: 'increase_load', target_load_kg: 14, target_reps: 8 },
    ],
    [
      'within the range: same load, one more rep than the weakest set',
      planned(),
      session([
        { reps: 10, rir: 2 },
        { reps: 9, rir: 2 },
        { reps: 9, rir: 1 },
      ]),
      { decision: 'add_reps', target_load_kg: 12, target_reps: 10 },
    ],
    [
      'a failed set: -5% rounded down to the dumbbell step',
      planned(),
      session([
        { reps: 10, rir: 2 },
        { reps: 8, rir: 1 },
        { reps: 5, completed: false },
      ]),
      { decision: 'decrease_load', target_load_kg: 10, target_reps: 8 },
    ],
    [
      'RIR 0 with target RIR 2: -5%',
      planned(),
      session([
        { reps: 10, rir: 2 },
        { reps: 10, rir: 1 },
        { reps: 9, rir: 0 },
      ]),
      { decision: 'decrease_load', target_load_kg: 10, target_reps: 8 },
    ],
    [
      'RIR 0 is fine when the target RIR is 0',
      planned({ target_rir: 0 }),
      session(sets3(10, 0)),
      { decision: 'add_reps', target_load_kg: 12, target_reps: 11 },
    ],
    [
      'RIR >= 4 with target RIR 2 (too easy) below the top: +5%, at least one step',
      planned(),
      session(sets3(9, 4)),
      { decision: 'increase_load', target_load_kg: 14, target_reps: 9 },
    ],
    [
      'RIR 3 is not "too easy" for target 2',
      planned(),
      session(sets3(9, 3)),
      { decision: 'add_reps', target_load_kg: 12, target_reps: 10 },
    ],
    [
      'missing RIR on every set: reps and completion decide',
      planned(),
      session(sets3(12, undefined)),
      { decision: 'increase_load', target_load_kg: 14, target_reps: 8 },
    ],
    [
      'missing RIR on some sets: only reported RIR counts',
      planned(),
      session([{ reps: 9, rir: 5 }, { reps: 9 }, { reps: 9, rir: 4 }]),
      { decision: 'increase_load', target_load_kg: 14 },
    ],
    [
      'reps below rep_min but completed: hold the load, aim for rep_min',
      planned(),
      session(sets3(6, 2)),
      { decision: 'hold', target_load_kg: 12, target_reps: 8 },
    ],
    [
      'top of the range on fewer sets than planned is not a load increase',
      planned(),
      session([
        { reps: 12, rir: 2 },
        { reps: 12, rir: 2 },
      ]),
      { decision: 'add_reps', target_load_kg: 12, target_reps: 12 },
    ],
    [
      'break of 15 days: -10%',
      planned(),
      session(sets3(12, 2, 20), { date: '2026-09-23' }),
      { decision: 'break_reset', target_load_kg: 18, target_reps: 8 },
    ],
    [
      'break of exactly 14 days is not a break',
      planned(),
      session(sets3(12, 2, 20), { date: '2026-09-24' }),
      { decision: 'increase_load', target_load_kg: 22 },
    ],
    [
      'break of more than 28 days: -20%',
      planned(),
      session(sets3(10, 2, 20), { date: '2026-09-01' }),
      { decision: 'break_reset', target_load_kg: 16, target_reps: 8 },
    ],
    [
      'barbell lower body: +5 kg after hitting the top',
      planned({ exercise_id: 'barbell_back_squat', rep_min: 5, rep_max: 8 }),
      session(sets3(8, 2, 100), { exercise: 'barbell_back_squat' }),
      { decision: 'increase_load', target_load_kg: 105, target_reps: 5 },
    ],
    [
      'barbell upper body: +2.5 kg',
      planned({ exercise_id: 'barbell_bench_press', rep_min: 5, rep_max: 8 }),
      session(sets3(8, 2, 60), { exercise: 'barbell_bench_press' }),
      { decision: 'increase_load', target_load_kg: 62.5 },
    ],
    [
      'barbell -5% rounds down to a 2.5 kg plate pair (61 -> 57.5)',
      planned({ exercise_id: 'barbell_bench_press', rep_min: 5, rep_max: 8 }),
      session([{ reps: 4, load: 61, completed: false }], { exercise: 'barbell_bench_press' }),
      { decision: 'decrease_load', target_load_kg: 57.5 },
    ],
    [
      'barbell never drops below the empty bar',
      planned({ exercise_id: 'barbell_bench_press', rep_min: 5, rep_max: 8 }),
      session([{ reps: 3, load: 20, completed: false }], { exercise: 'barbell_bench_press' }),
      { decision: 'decrease_load', target_load_kg: 20 },
    ],
    [
      'kettlebell steps by 4 kg',
      planned({ exercise_id: 'kettlebell_goblet_squat' }),
      session(sets3(12, 2, 16), { exercise: 'kettlebell_goblet_squat' }),
      { decision: 'increase_load', target_load_kg: 20 },
    ],
    [
      'an off-grid load rounds onto the dumbbell grid',
      planned(),
      session(sets3(12, 2, 11)),
      { decision: 'increase_load', target_load_kg: 14 },
    ],
    [
      'too easy at the top of the range: the larger of +increment and +5%',
      planned({ exercise_id: 'barbell_back_squat', rep_min: 5, rep_max: 8 }),
      session(sets3(8, 5, 200), { exercise: 'barbell_back_squat' }),
      { decision: 'increase_load', target_load_kg: 210 },
    ],
    [
      'bodyweight at the top of the range: the rep range moves up',
      unloaded({ exercise_id: 'push_up', rep_min: 8, rep_max: 12 }),
      session(sets3(12, 2, 0), { exercise: 'push_up' }),
      { decision: 'raise_rep_range', rep_min: 10, rep_max: 14, target_reps: 10 },
    ],
    [
      'bodyweight failed set: hold, no load',
      unloaded({ exercise_id: 'push_up', rep_min: 8, rep_max: 12 }),
      session([{ reps: 5, load: 0, completed: false }], { exercise: 'push_up' }),
      { decision: 'hold', target_reps: 8, target_load_kg: undefined },
    ],
    [
      'timed hold within the range: +5 s',
      unloaded({ exercise_id: 'plank', measure: 'seconds', rep_min: 20, rep_max: 40 }),
      session(sets3(30, 2, 0), { exercise: 'plank', measure: 'seconds' }),
      { decision: 'add_reps', target_reps: 35 },
    ],
    [
      'timed hold at the top: the duration range moves up by 10 s',
      unloaded({ exercise_id: 'plank', measure: 'seconds', rep_min: 20, rep_max: 40 }),
      session(sets3(40, 2, 0), { exercise: 'plank', measure: 'seconds' }),
      { decision: 'raise_rep_range', rep_min: 30, rep_max: 50, target_reps: 30 },
    ],
    [
      'loaded carry: duration first, then load at the top',
      planned({
        exercise_id: 'farmers_carry',
        measure: 'seconds',
        rep_min: 30,
        rep_max: 45,
        target_load_kg: 20,
      }),
      session(sets3(45, 2, 20), { exercise: 'farmers_carry', measure: 'seconds' }),
      { decision: 'increase_load', target_load_kg: 22, target_reps: 30 },
    ],
    [
      'warm-up sets are ignored',
      planned(),
      session([
        { reps: 12, load: 6, warmup: true },
        { reps: 12, rir: 2 },
        { reps: 12, rir: 2 },
        { reps: 12, rir: 2 },
      ]),
      { decision: 'increase_load', target_load_kg: 14 },
    ],
  ];

  it.each(cases)('%s', (_name, plannedExercise, logs, expected) => {
    const result = nextTargets(plannedExercise, logs, { today: TODAY });
    for (const [key, value] of Object.entries(expected)) {
      expect(result[key as keyof NextTargets], key).toEqual(value);
    }
    expect(result.reason.length).toBeGreaterThan(10);
  });
});

describe('nextTargets details', () => {
  it('uses only the latest session for the exercise and reports its date', () => {
    const older = session(sets3(6, 2), { date: '2026-10-01', log: uuid(900) });
    const newer = session(sets3(12, 2), { date: '2026-10-05' });
    const other = session(sets3(3, 0), { date: '2026-10-07', exercise: 'push_up', log: uuid(901) });
    const result = nextTargets(planned(), [...older, ...newer, ...other], { today: TODAY });
    expect(result.decision).toBe('increase_load');
    expect(result.last_session_date).toBe('2026-10-05');
  });

  it('computes the break in the user time zone', () => {
    // 2026-09-23T23:30Z is already 2026-09-24 in Bratislava: exactly 14 days, so no break.
    const logs = session(sets3(10, 2)).map((set) => ({
      ...set,
      performed_at: '2026-09-23T23:30:00Z',
    }));
    expect(nextTargets(planned(), logs, { today: TODAY }).decision).toBe('break_reset');
    expect(
      nextTargets(planned(), logs, { today: TODAY, timezone: 'Europe/Bratislava' }).decision,
    ).toBe('add_reps');
  });

  it('honours a custom load step (2.5 kg dumbbells)', () => {
    const result = nextTargets(planned(), session(sets3(12, 2, 12.5)), {
      today: TODAY,
      loadStepKg: 2.5,
    });
    expect(result.target_load_kg).toBe(15);
  });

  it('keeps sets and target RIR from the plan', () => {
    const result = nextTargets(planned({ sets: 4, target_rir: 3 }), session(sets3(10, 3)), {
      today: TODAY,
    });
    expect([result.sets, result.target_rir]).toEqual([4, 3]);
  });

  it('rejects invalid input', () => {
    expect(() => nextTargets({ ...planned(), rep_min: 0 }, [], { today: TODAY })).toThrow();
    expect(() => nextTargets(planned(), [], { today: '08.10.2026' })).toThrow();
    expect(() =>
      nextTargets(planned({ exercise_id: 'quantum_squat' }), [], { today: TODAY }),
    ).toThrow(/Unknown exercise_id/);
  });
});
