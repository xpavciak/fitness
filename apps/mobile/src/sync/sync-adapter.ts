/**
 * Sync boundary (decision D4). The app is local-first: the `Repository` on the device is the
 * source of truth and Supabase is an optional replica. Nothing calls a server until a
 * `SupabaseSyncAdapter` is implemented and wired; until then `NoopSyncAdapter` is used.
 *
 * How the Supabase adapter plugs in (see `supabase/README.md`, "How sync plugs in later"):
 * - push: rows are already in Row-schema shape with client UUIDs, so each table is
 *   `upsert(rows, { onConflict: 'id' })` (`user_id` for profiles), parent to child:
 *   profiles, goals, plans, plan_weeks, planned_sessions, planned_exercises, workout_logs,
 *   set_logs, schedule_changes. Nested app objects are flattened into rows first.
 * - pull: `select * where updated_at > cursor` per table with
 *   `cursor = lastPulledAt - PULL_OVERLAP_MS`, where `lastPulledAt` is the largest server
 *   `updated_at` seen (never the device clock). Rows seen twice are de-duplicated by `id`.
 * - PostgREST returns absent optional columns as `null`; run `nullsToUndefined` before parsing
 *   with the engine Row schemas (which use `.optional()` and reject `null`).
 * - Conflicts: last server arrival wins; schedule changes are append-only.
 */

export const SYNC_TABLES = [
  'profiles',
  'goals',
  'plans',
  'plan_weeks',
  'planned_sessions',
  'planned_exercises',
  'workout_logs',
  'set_logs',
  'schedule_changes',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/** Overlap subtracted from the pull cursor (transactions commit after their `updated_at`). */
export const PULL_OVERLAP_MS = 5 * 60 * 1000;

/** Rows to upsert, per table, in `SYNC_TABLES` order. */
export type SyncPush = Partial<Record<SyncTable, readonly Record<string, unknown>[]>>;

export interface SyncPullResult {
  rows: Partial<Record<SyncTable, Record<string, unknown>[]>>;
  /** Largest server `updated_at` in this pull; becomes the next `lastPulledAt`. */
  lastPulledAt: string | null;
}

export interface SyncAdapter {
  /** True when the adapter actually talks to a server. */
  readonly enabled: boolean;
  push(changes: SyncPush): Promise<void>;
  /** Rows changed since `lastPulledAt` (null = everything). */
  pull(lastPulledAt: string | null): Promise<SyncPullResult>;
}

/** The default adapter: the app works fully offline and nothing leaves the device. */
export class NoopSyncAdapter implements SyncAdapter {
  readonly enabled = false;

  push(_changes: SyncPush): Promise<void> {
    return Promise.resolve();
  }

  pull(lastPulledAt: string | null): Promise<SyncPullResult> {
    return Promise.resolve({ rows: {}, lastPulledAt });
  }
}

/** The pull cursor for a high-water mark (see `PULL_OVERLAP_MS`). */
export function pullCursor(lastPulledAt: string | null): string | null {
  if (lastPulledAt === null) {
    return null;
  }
  const ms = Date.parse(lastPulledAt);
  if (Number.isNaN(ms)) {
    throw new RangeError(`Invalid lastPulledAt "${lastPulledAt}"`);
  }
  return new Date(ms - PULL_OVERLAP_MS).toISOString();
}

/**
 * Drops `null` values (recursively in plain objects and arrays) so PostgREST rows can be
 * parsed with the engine Row schemas, whose optional fields accept `undefined` but not `null`.
 */
export function nullsToUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => nullsToUndefined(item));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== null) {
        result[key] = nullsToUndefined(item);
      }
    }
    return result;
  }
  return value;
}
