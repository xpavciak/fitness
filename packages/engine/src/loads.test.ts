import { describe, expect, it } from 'vitest';
import { BARBELL_PLATES_KG, LOAD_INCREMENTS_KG } from './loads.js';

describe('load constants', () => {
  it('barbell increments are reachable with one pair of the smallest plates', () => {
    const smallestPair = 2 * Math.min(...BARBELL_PLATES_KG);
    expect(LOAD_INCREMENTS_KG.barbell_upper % smallestPair).toBe(0);
    expect(LOAD_INCREMENTS_KG.barbell_lower % smallestPair).toBe(0);
  });
});
