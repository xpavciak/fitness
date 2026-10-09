import { describe, expect, it } from 'vitest';
import { samples, uuid } from '../__fixtures__/samples.js';
import type { SetLog } from '../schemas/index.js';
import { estimate1RM, personalRecords } from './one-rep-max.js';

describe('estimate1RM', () => {
  it.each([
    // [load, reps, formula, expected]
    [100, 5, 'epley', 116.7],
    [100, 5, 'brzycki', 112.5],
    [100, 10, 'epley', 133.3],
    [100, 10, 'brzycki', 133.3],
    [60, 1, 'epley', 60],
    [60, 1, 'brzycki', 60],
    [12, 8, 'epley', 15.2],
  ] as const)('%d kg x %d (%s) = %d', (load, reps, formula, expected) => {
    expect(estimate1RM(load, reps, formula)).toBe(expected);
  });

  it('defaults to Epley', () => {
    expect(estimate1RM(100, 5)).toBe(116.7);
  });

  it('is undefined above 10 reps or without load', () => {
    expect(estimate1RM(100, 11)).toBeUndefined();
    expect(estimate1RM(0, 5)).toBeUndefined();
  });

  it.each([
    [-1, 5],
    [Number.NaN, 5],
    [50, 0],
    [50, 2.5],
  ])('rejects load %s x reps %s', (load, reps) => {
    expect(() => estimate1RM(load, reps)).toThrow(RangeError);
  });
});

describe('personalRecords', () => {
  let n = 0;
  const set = (overrides: Partial<SetLog>): SetLog => {
    n += 1;
    return { ...samples.setLog(), id: uuid(5000 + n), set_index: n, ...overrides };
  };

  it('returns the best e1RM, load and reps per exercise', () => {
    const records = personalRecords([
      set({ load_kg: 12, reps: 10, performed_at: '2026-10-01T10:00:00Z' }), // e1RM 16
      set({ load_kg: 14, reps: 6, performed_at: '2026-10-03T10:00:00Z' }), // e1RM 16.8, best load
      set({ load_kg: 8, reps: 15, performed_at: '2026-10-04T10:00:00Z' }), // best reps, no e1RM
      set({ load_kg: 20, reps: 12, is_warmup: true }), // warm-up ignored
      set({ load_kg: 18, reps: 3, completed: false }), // failed set ignored
      set({ exercise_id: 'push_up', load_kg: 0, reps: 20 }),
      set({ exercise_id: 'plank', measure: 'seconds', load_kg: 0, reps: 60 }),
    ]);
    const goblet = records.goblet_squat;
    expect(goblet?.best_e1rm).toMatchObject({ e1rm_kg: 16.8, load_kg: 14, reps: 6 });
    expect(goblet?.best_load).toMatchObject({ load_kg: 14, reps: 6 });
    expect(goblet?.best_reps).toMatchObject({ load_kg: 8, reps: 15 });
    expect(records.push_up).toMatchObject({ best_reps: { reps: 20 } });
    expect(records.push_up?.best_e1rm).toBeUndefined();
    expect(records.push_up?.best_load).toBeUndefined();
    expect(records.plank).toMatchObject({ measure: 'seconds', best_reps: { reps: 60 } });
    expect(records.plank?.best_e1rm).toBeUndefined();
  });

  it('keeps the earliest set on ties, regardless of input order', () => {
    const later = set({ load_kg: 14, reps: 8, performed_at: '2026-10-05T10:00:00Z' });
    const earlier = set({ load_kg: 14, reps: 8, performed_at: '2026-10-01T10:00:00Z' });
    const records = personalRecords([later, earlier]);
    expect(records.goblet_squat?.best_load?.set_id).toBe(earlier.id);
    expect(records.goblet_squat?.best_e1rm?.set_id).toBe(earlier.id);
  });

  it('supports Brzycki and returns an empty object without sets', () => {
    expect(
      personalRecords([set({ load_kg: 100, reps: 5 })], 'brzycki').goblet_squat?.best_e1rm?.e1rm_kg,
    ).toBe(112.5);
    expect(personalRecords([])).toEqual({});
  });

  it('rejects invalid set logs', () => {
    expect(() => personalRecords([set({ reps: -1 })])).toThrow();
  });
});
