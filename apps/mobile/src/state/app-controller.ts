import type { ScheduleProposal, WorkoutLog } from '@fitness/engine';
import type { PlanResult } from '../engine/engine-service';
import { SerialQueue } from '../lib/serial-queue';
import {
  acceptProposal as acceptProposalAction,
  completeOnboarding as completeOnboardingAction,
  localToday,
  markSessionDone,
  regeneratePlan as regeneratePlanAction,
} from '../logic/actions';
import type { OnboardingDraft } from '../logic/onboarding';
import {
  EMPTY_APP_DATA,
  upsertById,
  type AppData,
  type DataExport,
  type Repository,
} from '../storage/repository';
import type { SyncAdapter } from '../sync/sync-adapter';

export type LoadState =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: AppData };

export interface Services {
  repository: Repository;
  sync: SyncAdapter;
  newId: () => string;
  /** Device IANA time zone (used at onboarding; the profile's zone is used afterwards). */
  timezone: () => string;
  /** Current instant (ISO 8601). */
  now: () => string;
}

export interface StoreSnapshot {
  state: LoadState;
  /** An action is running or queued: screens disable their action buttons. */
  busy: boolean;
  /** Bumped when "today" may have changed (app foregrounded, screen focused). */
  clock: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The app's state and actions, free of React so it can be unit-tested. Every action runs
 * through one `SerialQueue`, reads the latest data when it starts (never a stale render
 * closure) and publishes the new data when it finishes. When an action fails, the in-memory
 * data is re-read from the repository so it matches what was actually persisted.
 *
 * Time zone: the profile's `timezone` is captured from the device at onboarding and stays
 * frozen afterwards ("today" is always computed in that zone); editing the answers keeps it.
 */
export class AppController {
  private snapshot: StoreSnapshot = { state: { status: 'loading' }, busy: false, clock: 0 };
  private readonly listeners = new Set<() => void>();
  private readonly queue = new SerialQueue();

  constructor(readonly services: Services) {}

  readonly getSnapshot = (): StoreSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Re-render subscribers so "today" is recomputed (stable reference for effects). */
  readonly refreshClock = (): void => {
    this.publish({ clock: this.snapshot.clock + 1 });
  };

  /** The user's local date in the profile's time zone (the device zone before onboarding). */
  today(): string {
    const { state } = this.snapshot;
    const zone =
      state.status === 'ready' && state.data.profile
        ? state.data.profile.timezone
        : this.services.timezone();
    return localToday(this.services.now(), zone);
  }

  load(): Promise<void> {
    return this.enqueue(() => this.resync());
  }

  /**
   * Onboarding or edited answers -> profile, goal and plan. When screening blocks:
   * - first onboarding: nothing is stored;
   * - an existing profile: the updated, consented profile is saved and the plan is removed,
   *   so no plan contradicting the new answers stays usable.
   */
  completeOnboarding(draft: OnboardingDraft): Promise<PlanResult> {
    return this.mutate<PlanResult>(async (data) => {
      const outcome = completeOnboardingAction(draft, data, {
        now: this.services.now(),
        newId: this.services.newId,
        timezone: data.profile?.timezone ?? this.services.timezone(),
      });
      const { profile, goal, result } = outcome;
      if (result.ok) {
        await this.services.repository.saveSetup({ profile, goal, plan: result.plan });
        return { data: { ...data, profile, goal, plan: result.plan }, result };
      }
      if (data.profile === null) {
        return { data, result };
      }
      await this.services.repository.saveSetup({ profile, goal, plan: null });
      return { data: { ...data, profile, goal, plan: null }, result };
    });
  }

  saveWorkout(log: WorkoutLog): Promise<void> {
    return this.mutate(async (data) => {
      const duplicate = data.workoutLogs.find(
        (existing) =>
          existing.id !== log.id &&
          log.planned_session_id !== undefined &&
          existing.planned_session_id === log.planned_session_id,
      );
      if (duplicate) {
        throw new Error('This session is already logged.');
      }
      await this.services.repository.saveWorkoutLog(log);
      const plan = data.plan ? markSessionDone(data.plan, log) : null;
      if (plan && plan !== data.plan) {
        await this.services.repository.savePlan(plan);
      }
      return {
        data: { ...data, plan, workoutLogs: upsertById(data.workoutLogs, [log]) },
        result: undefined,
      };
    });
  }

  acceptProposal(proposal: ScheduleProposal): Promise<void> {
    return this.mutate(async (data) => {
      const { profile, plan } = data;
      if (!profile || !plan) {
        throw new Error('There is no active plan.');
      }
      // Throws when the proposal is stale (the plan changed since it was computed).
      const result = acceptProposalAction(plan, profile, proposal, { newId: this.services.newId });
      await this.services.repository.savePlan(result.plan);
      await this.services.repository.addScheduleChanges(result.changes);
      return {
        data: {
          ...data,
          plan: result.plan,
          scheduleChanges: upsertById(data.scheduleChanges, result.changes),
        },
        result: undefined,
      };
    });
  }

  /** A fresh plan; re-screens the profile and removes the plan when screening blocks. */
  regeneratePlan(): Promise<PlanResult> {
    return this.mutate<PlanResult>(async (data) => {
      const { profile, goal } = data;
      if (!profile || !goal) {
        throw new Error('Finish onboarding first.');
      }
      const result = regeneratePlanAction(profile, goal, {
        now: this.services.now(),
        newId: this.services.newId,
      });
      if (result.ok) {
        await this.services.repository.savePlan(result.plan);
        return { data: { ...data, plan: result.plan }, result };
      }
      await this.services.repository.removePlan();
      return { data: { ...data, plan: null }, result };
    });
  }

  exportData(): Promise<DataExport> {
    return this.enqueue(() => this.services.repository.exportData(this.services.now()));
  }

  /** Works from any state (also when stored data could not be read). */
  deleteAllData(): Promise<void> {
    return this.enqueue(async () => {
      try {
        await this.services.repository.clearAll();
      } catch (error) {
        await this.resync();
        throw error;
      }
      this.publish({ state: { status: 'ready', data: EMPTY_APP_DATA } });
    });
  }

  private publish(patch: Partial<StoreSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.run(task);
    if (!this.snapshot.busy) {
      this.publish({ busy: true });
    }
    const settle = () => {
      if (!this.queue.busy) {
        this.publish({ busy: false });
      }
    };
    result.then(settle, settle);
    return result;
  }

  private mutate<T>(action: (data: AppData) => Promise<{ data: AppData; result: T }>): Promise<T> {
    return this.enqueue(async () => {
      const { state } = this.snapshot;
      if (state.status !== 'ready') {
        throw new Error('Local data is not loaded yet.');
      }
      try {
        const { data, result } = await action(state.data);
        this.publish({ state: { status: 'ready', data } });
        return result;
      } catch (error) {
        await this.resync();
        throw error;
      }
    });
  }

  /** Re-reads everything from the repository (the source of truth). */
  private async resync(): Promise<void> {
    try {
      this.publish({ state: { status: 'ready', data: await this.services.repository.load() } });
    } catch (error) {
      this.publish({ state: { status: 'error', message: errorMessage(error) } });
    }
  }
}
