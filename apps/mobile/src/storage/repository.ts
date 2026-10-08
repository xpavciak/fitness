import {
  EXERCISE_CATALOG,
  GoalSchema,
  IdSchema,
  IsoDateTimeSchema,
  MAX_LOGGED_RIR,
  ProfileSchema,
  ScheduleChangeSchema,
  createCatalogValidators,
  type Goal,
  type Plan,
  type Profile,
  type ScheduleChange,
  type WorkoutLog,
} from '@fitness/engine';
import { z } from 'zod';
import { SerialQueue } from '../lib/serial-queue';
import type { KeyValueStore } from './key-value-store';

/** App-side metadata of the active plan: the generator's warnings (shown on the Plan screen). */
export const PlanNotesSchema = z.object({
  plan_id: IdSchema,
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
});
export type PlanNotes = z.infer<typeof PlanNotesSchema>;

/**
 * An in-progress workout (the user's inputs only), saved after every change so a reload or an
 * app kill never loses completed sets. The form is rebuilt from the plan and then overlaid with
 * these values (`restoreDraft`). One key per session; removed on finish, discard and delete-all.
 */
export const SavedWorkoutDraftSchema = z.object({
  id: IdSchema,
  session_id: IdSchema,
  started_at: IsoDateTimeSchema,
  saved_at: IsoDateTimeSchema,
  sets: z
    .array(
      z.object({
        id: IdSchema,
        planned_exercise_id: IdSchema,
        set_index: z.int().min(0),
        reps: z.string().max(12),
        load_kg: z.string().max(12),
        rir: z.int().min(0).max(MAX_LOGGED_RIR).optional(),
        completed: z.boolean(),
        performed_at: IsoDateTimeSchema.optional(),
      }),
    )
    .max(200),
});
export type SavedWorkoutDraft = z.infer<typeof SavedWorkoutDraftSchema>;

/** Everything the app stores on the device. */
export interface AppData {
  profile: Profile | null;
  goal: Goal | null;
  /** The active plan. Regenerating replaces it; logs and schedule changes are kept. */
  plan: Plan | null;
  /** Notes for `plan` (null when there is no plan or the notes belong to another plan). */
  planNotes: PlanNotes | null;
  workoutLogs: WorkoutLog[];
  /** Append-only audit trail of accepted schedule changes (all plans). */
  scheduleChanges: ScheduleChange[];
}

export const EMPTY_APP_DATA: AppData = {
  profile: null,
  goal: null,
  plan: null,
  planNotes: null,
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
  /** Updates the active plan in place (status changes, rescheduling); its notes are kept. */
  savePlan(plan: Plan): Promise<void>;
  /** Replaces the active plan with a newly generated one and its warnings (plan first). */
  saveNewPlan(plan: Plan, warnings: readonly string[]): Promise<void>;
  /** Removes the active plan and its notes (e.g. when screening blocks after the answers were edited). */
  removePlan(): Promise<void>;
  /**
   * Saves the result of onboarding. Everything is validated before anything is written, and the
   * plan is written (or removed) first, so a failure part-way never leaves a usable plan that
   * contradicts the saved profile.
   */
  saveSetup(setup: {
    profile: Profile;
    goal: Goal;
    plan: Plan | null;
    warnings?: readonly string[];
  }): Promise<void>;
  /** Inserts or replaces (by `id`) a workout log. */
  saveWorkoutLog(log: WorkoutLog): Promise<void>;
  /** Appends schedule changes (replacing any with the same `id`). */
  addScheduleChanges(changes: readonly ScheduleChange[]): Promise<void>;
  exportData(exportedAt: string): Promise<DataExport>;
  /** The saved in-progress workout for a session, or null. Invalid drafts throw `StoredDataError`. */
  loadWorkoutDraft(sessionId: string): Promise<SavedWorkoutDraft | null>;
  saveWorkoutDraft(draft: SavedWorkoutDraft): Promise<void>;
  removeWorkoutDraft(sessionId: string): Promise<void>;
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
/** Prefix of the per-session workout draft keys (`<prefix><session id>`). */
export const WORKOUT_DRAFT_PREFIX = `${PREFIX}workout_draft/`;
export const STORAGE_KEYS = {
  profile: `${PREFIX}profile`,
  goal: `${PREFIX}goal`,
  plan: `${PREFIX}plan`,
  planNotes: `${PREFIX}plan_notes`,
  workoutLogs: `${PREFIX}workout_logs`,
  scheduleChanges: `${PREFIX}schedule_changes`,
} as const;

const validators = createCatalogValidators(EXERCISE_CATALOG);
const schemas = {
  profile: ProfileSchema,
  goal: GoalSchema,
  plan: validators.Plan,
  planNotes: PlanNotesSchema,
  workoutLogs: validators.WorkoutLog.array(),
  scheduleChanges: ScheduleChangeSchema.array(),
} satisfies Record<keyof typeof STORAGE_KEYS, z.ZodType>;

function draftKey(sessionId: string): string {
  return `${WORKOUT_DRAFT_PREFIX}${IdSchema.parse(sessionId)}`;
}

function parseJson(key: string, raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new StoredDataError(key, error instanceof Error ? error.message : 'not JSON');
  }
}

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

  saveNewPlan(plan: Plan, warnings: readonly string[]): Promise<void> {
    return this.queue.run(async () => {
      const parsed = schemas.plan.parse(plan);
      const notes = schemas.planNotes.parse({ plan_id: parsed.id, warnings });
      await this.store.setItem(STORAGE_KEYS.plan, JSON.stringify(parsed));
      await this.store.setItem(STORAGE_KEYS.planNotes, JSON.stringify(notes));
    });
  }

  removePlan(): Promise<void> {
    return this.queue.run(async () => {
      await this.store.removeItem(STORAGE_KEYS.plan);
      await this.store.removeItem(STORAGE_KEYS.planNotes);
    });
  }

  saveSetup(setup: {
    profile: Profile;
    goal: Goal;
    plan: Plan | null;
    warnings?: readonly string[];
  }): Promise<void> {
    return this.queue.run(async () => {
      // Validate everything up front: nothing is written when any part is invalid.
      const profile = schemas.profile.parse(setup.profile);
      const goal = schemas.goal.parse(setup.goal);
      const plan = setup.plan === null ? null : schemas.plan.parse(setup.plan);
      const notes =
        plan === null
          ? null
          : schemas.planNotes.parse({ plan_id: plan.id, warnings: setup.warnings ?? [] });
      if (goal.user_id !== profile.user_id || (plan !== null && plan.user_id !== profile.user_id)) {
        throw new Error('Profile, goal and plan must belong to the same user');
      }
      if (plan === null || notes === null) {
        // Blocked by screening: remove the plan first, so a failure later never leaves a usable
        // plan next to answers that block it.
        await this.store.removeItem(STORAGE_KEYS.plan);
        await this.store.removeItem(STORAGE_KEYS.planNotes);
        await this.store.setItem(STORAGE_KEYS.goal, JSON.stringify(goal));
        await this.store.setItem(STORAGE_KEYS.profile, JSON.stringify(profile));
      } else {
        // A new plan: write the (screened) profile and goal first, then the plan built from them.
        await this.store.setItem(STORAGE_KEYS.profile, JSON.stringify(profile));
        await this.store.setItem(STORAGE_KEYS.goal, JSON.stringify(goal));
        await this.store.setItem(STORAGE_KEYS.plan, JSON.stringify(plan));
        await this.store.setItem(STORAGE_KEYS.planNotes, JSON.stringify(notes));
      }
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

  loadWorkoutDraft(sessionId: string): Promise<SavedWorkoutDraft | null> {
    return this.queue.run(async () => {
      const key = draftKey(sessionId);
      const raw = await this.store.getItem(key);
      if (raw === null) {
        return null;
      }
      const result = SavedWorkoutDraftSchema.safeParse(parseJson(key, raw));
      if (!result.success || result.data.session_id !== sessionId) {
        throw new StoredDataError(
          key,
          result.success ? 'session id mismatch' : result.error.message,
        );
      }
      return result.data;
    });
  }

  saveWorkoutDraft(draft: SavedWorkoutDraft): Promise<void> {
    return this.queue.run(async () => {
      const parsed = SavedWorkoutDraftSchema.parse(draft);
      await this.store.setItem(draftKey(parsed.session_id), JSON.stringify(parsed));
    });
  }

  removeWorkoutDraft(sessionId: string): Promise<void> {
    return this.queue.run(() => this.store.removeItem(draftKey(sessionId)));
  }

  clearAll(): Promise<void> {
    return this.queue.run(async () => {
      const drafts = (await this.store.getAllKeys()).filter((key) =>
        key.startsWith(WORKOUT_DRAFT_PREFIX),
      );
      const keys = [...Object.values(STORAGE_KEYS), ...drafts];
      const results = await Promise.allSettled(keys.map((key) => this.store.removeItem(key)));
      const failed = keys.filter((_, index) => results[index]?.status === 'rejected');
      if (failed.length > 0) {
        throw new ClearDataError(failed);
      }
    });
  }

  private async loadUnlocked(): Promise<AppData> {
    const [profile, goal, plan, planNotes, workoutLogs, scheduleChanges] = await Promise.all([
      this.read('profile'),
      this.read('goal'),
      this.read('plan'),
      this.read('planNotes'),
      this.read('workoutLogs'),
      this.read('scheduleChanges'),
    ]);
    return {
      profile: profile ?? null,
      goal: goal ?? null,
      plan: plan ?? null,
      // Notes left over from another plan (e.g. an interrupted write) are ignored.
      planNotes: plan && planNotes?.plan_id === plan.id ? planNotes : null,
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
    const json = parseJson(key, raw);
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
