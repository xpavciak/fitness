/**
 * Id generation. Engine functions never call `crypto.randomUUID()` themselves: callers inject
 * an `IdGenerator` so outputs are deterministic and testable. The app passes
 * `() => crypto.randomUUID()`; tests pass `createSeededIdGenerator(seed)`.
 */
export type IdGenerator = () => string;

const MAX_SEED = 0xffffffff;

/**
 * Deterministic UUID (v4 format) generator for tests and reproducible runs. The seed fills the
 * first group and a counter the last one, so ids stay readable in snapshots:
 * `createSeededIdGenerator(7)()` -> `00000007-0000-4000-8000-000000000001`.
 */
export function createSeededIdGenerator(seed = 1): IdGenerator {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError(`Seed must be an integer in [0, ${MAX_SEED}], got ${seed}`);
  }
  const prefix = seed.toString(16).padStart(8, '0');
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
  };
}
