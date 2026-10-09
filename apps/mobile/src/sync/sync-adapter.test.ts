import { WorkoutLogRowSchema } from '@fitness/engine';
import { describe, expect, it } from 'vitest';
import { NoopSyncAdapter, nullsToUndefined, pullCursor, PULL_OVERLAP_MS } from './sync-adapter';

describe('NoopSyncAdapter', () => {
  it('is disabled and returns nothing', async () => {
    const adapter = new NoopSyncAdapter();
    expect(adapter.enabled).toBe(false);
    await expect(adapter.push({ profiles: [{ user_id: 'x' }] })).resolves.toBeUndefined();
    await expect(adapter.pull('2026-10-08T10:00:00.000Z')).resolves.toEqual({
      rows: {},
      lastPulledAt: '2026-10-08T10:00:00.000Z',
    });
  });
});

describe('pullCursor', () => {
  it('subtracts the overlap window', () => {
    expect(PULL_OVERLAP_MS).toBe(300_000);
    expect(pullCursor('2026-10-08T10:00:00.000Z')).toBe('2026-10-08T09:55:00.000Z');
    expect(pullCursor(null)).toBeNull();
    expect(() => pullCursor('yesterday')).toThrow(RangeError);
  });
});

describe('nullsToUndefined', () => {
  it('lets PostgREST rows parse with the engine Row schemas', () => {
    const row = {
      id: '00000001-0000-4000-8000-000000000001',
      user_id: '00000001-0000-4000-8000-000000000002',
      planned_session_id: null,
      started_at: '2026-10-08T10:00:00+00:00',
      ended_at: null,
      pre_checkin: { sleep: 3, energy: 4, soreness: 2, stress: 1 },
      session_rpe: null,
      notes: null,
      updated_at: '2026-10-08T10:01:00+00:00',
    };
    expect(WorkoutLogRowSchema.safeParse(row).success).toBe(false);
    const parsed = WorkoutLogRowSchema.parse(nullsToUndefined(row));
    expect(parsed).not.toHaveProperty('planned_session_id');
    expect(parsed).not.toHaveProperty('updated_at');
    expect(parsed.pre_checkin?.sleep).toBe(3);
  });

  it('recurses into arrays and keeps primitives', () => {
    expect(nullsToUndefined([{ a: null, b: 1 }])).toEqual([{ b: 1 }]);
    expect(nullsToUndefined(0)).toBe(0);
    expect(nullsToUndefined(null)).toBeNull();
  });
});
