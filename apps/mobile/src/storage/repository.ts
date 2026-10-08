import {
  EXERCISE_CATALOG,
  GoalSchema,
  ProfileSchema,
  ScheduleChangeSchema,
  createCatalogValidators,
  type Goal,
  type Plan,
  type Profile,
  type ScheduleChange,
  type WorkoutLog,
} from '@fitness/engine';
import type { z } from 'zod';
import { SerialQueue } from '../lib/serial-queue';
import type { KeyValueStore } from './key-value-store';

/** Everything the app stores on the device. */
export interface AppData {
  profile: Profile | null;
  goal: Goal | null;
  /** The active plan. Regenerating replaces it; logs and schedule changes are kept. */
  plan: Plan | null;
  workoutLogs: WorkoutLog[];
  /** Append-only audit trail of accepted schedule changes (all plans). */
  scheduleChanges: ScheduleChange[];
}

export const EMPTY_APP_DATA: AppData = {
  profile: null,
  goal: null,
  plan: null,
  workoutLogs: [],
  scheduleChanges: [],
};

export const EXPORT_FORMAT = 'fitness-app-export';
export const EXPORT_VERSION = 1;

export interface DataExport extends AppData {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exported_at: string;
}

/**
 * Local-first persistence. Every write and read is validated with the engine's Zod schemas
 * (plans and logs with the catalog-aware validators), so invalid data never reaches the
 * engine or the sync layer.
 */
export interface Repository {
  load(): Promise<AppData>;
  saveProfile(profile: Profile): Promise<void>;
  saveGoal(goal: Goal): Promise<void>;
  savePlan(plan: Plan): Promise<void>;
  /** Removes the active plan (e.g. when screening blocks after the answers were edited). */
  removePlan(): Promise<void>;
  /**
   * Saves the result of onboarding. Everything is validated before anything is written, and the
   * plan is written (or removed) first, so a failure part-way never leaves a usable plan that
   * contradicts the saved profile.
   */
  saveSetup(setup: { profile: Profile; goal: Goal; plan: Plan | null }): Promise<void>;
  /** Inserts or replaces (by `id`) a workout log. */
  saveWorkoutLog(log: WorkoutLog): Promise<void>;
  /** Appends schedule changes (replacing any with the same `id`). */
  addScheduleChanges(changes: readonly ScheduleChange[]): Promise<void>;
  exportData(exportedAt: string): Promise<DataExport>;
  /** Deletes every key this app stores on the device; throws `ClearDataError` listing failures. */
  clearAll(): Promise<void>;
}

/** Thrown when stored data cannot be parsed or no longer matches the schemas. */
export class StoredDataError extends Error {
  constructor(
    readonly key: string,
    message: string,
  ) {
    super(`Stored data for "${key}" is invalid: ${message}`);
    this.name = 'StoredDataError';
  }
}

/** Thrown when some keys could not be deleted; the others were deleted. */
export class ClearDataError extends Error {
  constructor(readonly failedKeys: readonly string[]) {
    super(`Could not delete: ${failedKeys.join(', ')}. Please try again.`);
    this.name = 'ClearDataError';
  }
}

const PREFIX = 'fitness/v1/';
export const STORAGE_KEYS = {
  profile: `${PREFIX}profile`,
  goal: `${PREFIX}goal`,
  plan: `${PREFIX}plan`,
  workoutLogs: `${PREFIX}workout_logs`,
  scheduleChanges: `${PREFIX}schedule_changes`,
} as const;

const validators = createCatalogValidators(EXERCISE_CATALOG);
const schemas = {
  profile: ProfileSchema,
  goal: GoalSchema,
  plan: validators.Plan,
  workoutLogs: validators.WorkoutLog.array(),
  scheduleChanges: ScheduleChangeSchema.array(),
} satisfies Record<keyof typeof STORAGE_KEYS, z.ZodType>;

export function upsertById<T extends { id: string }>(
  items: readonly T[],
  added: readonly T[],
): T[] {
  const result = [...items];
  for (const item of added) {
    const index = result.findIndex((existing) => existing.id === item.id);
    if (index === -1) {
      result.push(item);
    } else {
      result[index] = item;
    }
  }
  return result;
}

export class LocalRepository implements Repository {
  /** Serializes all operations, so read-modify-write updates never interleave. */
  private readonly queue = new SerialQueue();

  constructor(private readonly store: KeyValueStore) {}

  load(): Promise<AppData> {
    return this.queue.run(() => this.loadUnlocked());
  }

  saveProfile(profile: Profile): Promise<void> {
    return this.queue.run(() => this.write('profile', profile));
  }

  saveGoal(goal: Goal): Promise<void> {
    return this.queue.run(() => this.write('goal', goal));
  }

  savePlan(plan: Plan): Promise<void> {
    return this.queue.run(() => this.write('plan', plan));
  }

  removePlan(): Promise<void> {
    return this.queue.run(() => this.store.removeItem(STORAGE_KEYS.plan));
  }

  saveSetup(setup: { profile: Profile; goal: Goal; plan: Plan | null }): Promise<void> {
    return this.queue.run(async () => {
      // Validate everything up front: nothing is written when any part is invalid.
      const profile = schemas.profile.parse(setup.profile);
      const goal = schemas.goal.parse(setup.goal);
      const plan = setup.plan === null ? null : schemas.plan.parse(setup.plan);
      if (goal.user_id !== profile.user_id || (plan !== null && plan.user_id !== profile.user_id)) {
        throw new Error('Profile, goal and plan must belong to the same user');
      }
      if (plan === null) {
        await this.store.removeItem(STORAGE_KEYS.plan);
      } else {
        await this.store.setItem(STORAGE_KEYS.plan, JSON.stringify(plan));
      }
      await this.store.setItem(STORAGE_KEYS.goal, JSON.stringify(goal));
      await this.store.setItem(STORAGE_KEYS.profile, JSON.stringify(profile));
    });
  }

  saveWorkoutLog(log: WorkoutLog): Promise<void> {
    return this.queue.run(async () => {
      const logs = (await this.read('workoutLogs')) ?? [];
      await this.write('workoutLogs', upsertById(logs, [log]));
    });
  }

  addScheduleChanges(changes: readonly ScheduleChange[]): Promise<void> {
    return this.queue.run(async () => {
      const existing = (await this.read('scheduleChanges')) ?? [];
      await this.write('scheduleChanges', upsertById(existing, changes));
    });
  }

  exportData(exportedAt: string): Promise<DataExport> {
    return this.queue.run(async () => {
      const data = await this.loadUnlocked();
      return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exported_at: exportedAt, ...data };
    });
  }

  clearAll(): Promise<void> {
    return this.queue.run(async () => {
      const keys = Object.values(STORAGE_KEYS);
      const results = await Promise.allSettled(keys.map((key) => this.store.removeItem(key)));
      const failed = keys.filter((_, index) => results[index]?.status === 'rejected');
      if (failed.length > 0) {
        throw new ClearDataError(failed);
      }
    });
  }

  private async loadUnlocked(): Promise<AppData> {
    const [profile, goal, plan, workoutLogs, scheduleChanges] = await Promise.all([
      this.read('profile'),
      this.read('goal'),
      this.read('plan'),
      this.read('workoutLogs'),
      this.read('scheduleChanges'),
    ]);
    return {
      profile: profile ?? null,
      goal: goal ?? null,
      plan: plan ?? null,
      workoutLogs: workoutLogs ?? [],
      scheduleChanges: scheduleChanges ?? [],
    };
  }

  private async read<K extends keyof typeof schemas>(
    name: K,
  ): Promise<z.infer<(typeof schemas)[K]> | undefined> {
    const key = STORAGE_KEYS[name];
    const raw = await this.store.getItem(key);
    if (raw === null) {
      return undefined;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw new StoredDataError(key, error instanceof Error ? error.message : 'not JSON');
    }
    const result = schemas[name].safeParse(json);
    if (!result.success) {
      throw new StoredDataError(key, result.error.message);
    }
    return result.data as z.infer<(typeof schemas)[K]>;
  }

  private async write<K extends keyof typeof schemas>(
    name: K,
    value: z.input<(typeof schemas)[K]>,
  ): Promise<void> {
    // Throws a ZodError for invalid data, so nothing invalid is ever written.
    const parsed = schemas[name].parse(value);
    await this.store.setItem(STORAGE_KEYS[name], JSON.stringify(parsed));
  }
}
