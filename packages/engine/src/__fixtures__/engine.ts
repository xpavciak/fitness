import { EXERCISE_CATALOG } from '../catalog/index.js';
import { createCatalogLookup } from '../catalog/lookup.js';
import { createSeededIdGenerator } from '../ids.js';
import { generatePlan } from '../plan/generate.js';
import type { Goal, GoalType, Plan, Profile } from '../schemas/index.js';
import { samples } from './samples.js';

export const lookup = createCatalogLookup(EXERCISE_CATALOG);

export const TODAY = '2026-10-08'; // a Thursday
export const NOW = '2026-10-08T10:00:00Z';

/** A profile with every weekday available and no limitations, plus overrides. */
export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    ...samples.profile(),
    limitations: [],
    available_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    ...overrides,
  };
}

export function makeGoal(type: GoalType = 'general'): Goal {
  return { ...samples.goal(), type };
}

/** Generates a plan and fails loudly when screening blocks it. */
export function planFor(profile: Profile, goal: Goal = makeGoal(), seed = 1): Plan {
  const result = generatePlan(profile, goal, {
    today: TODAY,
    now: NOW,
    newId: createSeededIdGenerator(seed),
  });
  if (!result.ok) {
    throw new Error(`Plan was blocked: ${result.reason}`);
  }
  return result.plan;
}

/** Deterministic PRNG (mulberry32) for property-style tests. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) {
    throw new Error('Cannot pick from an empty list');
  }
  return item;
}

/** A random subset (each item kept with probability 1/2). */
export function subset<T>(random: () => number, items: readonly T[]): T[] {
  return items.filter(() => random() < 0.5);
}

/** Narrows away undefined/null in tests (instead of non-null assertions). */
export function must<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) {
    throw new Error(`Expected ${what} to be defined`);
  }
  return value;
}
