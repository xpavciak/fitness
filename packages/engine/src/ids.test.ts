import { describe, expect, it } from 'vitest';
import { IdSchema } from './schemas/index.js';
import { createSeededIdGenerator } from './ids.js';

describe('createSeededIdGenerator', () => {
  it('produces valid, unique, readable UUIDs', () => {
    const next = createSeededIdGenerator(7);
    const ids = Array.from({ length: 1000 }, () => next());
    expect(ids[0]).toBe('00000007-0000-4000-8000-000000000001');
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(IdSchema.safeParse(id).success).toBe(true);
    }
  });

  it('is deterministic per seed and distinct across seeds', () => {
    const a = createSeededIdGenerator(1);
    const b = createSeededIdGenerator(1);
    const c = createSeededIdGenerator(2);
    expect([a(), a()]).toEqual([b(), b()]);
    expect(c()).not.toBe(createSeededIdGenerator(1)());
  });

  it.each([-1, 1.5, 2 ** 32])('rejects seed %s', (seed) => {
    expect(() => createSeededIdGenerator(seed)).toThrow(RangeError);
  });
});
