import type { ScheduleProposal, WorkoutLog } from '@fitness/engine';
import type { PlanResult } from '../engine/engine-service';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
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
  timezone: () => string;
  /** Current instant (ISO 8601). */
  now: () => string;
}

export interface Store {
  state: LoadState;
  services: Services;
  /** The user's local date in the profile (or device) time zone. */
  today: () => string;
  completeOnboarding(draft: OnboardingDraft): Promise<PlanResult>;
  saveWorkout(log: WorkoutLog): Promise<void>;
  acceptProposal(proposal: ScheduleProposal): Promise<void>;
  regeneratePlan(): Promise<PlanResult>;
  exportData(): Promise<DataExport>;
  deleteAllData(): Promise<void>;
  reload(): Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function StoreProvider({ services, children }: { services: Services; children: ReactNode }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const { repository } = services;

  const reload = useCallback(async () => {
    try {
      setState({ status: 'ready', data: await repository.load() });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }, [repository]);

  useEffect(() => {
    let active = true;
    repository.load().then(
      (data) => {
        if (active) {
          setState({ status: 'ready', data });
        }
      },
      (error: unknown) => {
        if (active) {
          setState({ status: 'error', message: errorMessage(error) });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [repository]);

  const store = useMemo((): Store => {
    const current = (): AppData => {
      if (state.status !== 'ready') {
        throw new Error('Local data is not loaded yet');
      }
      return state.data;
    };
    const update = (data: AppData) => {
      setState({ status: 'ready', data });
    };
    const ctx = () => ({ now: services.now(), newId: services.newId });
    const requireProfile = () => {
      const { profile, goal, plan } = current();
      if (!profile || !goal || !plan) {
        throw new Error('Finish onboarding first');
      }
      return { profile, goal, plan };
    };

    return {
      state,
      services,
      today: () =>
        localToday(
          services.now(),
          state.status === 'ready'
            ? (state.data.profile?.timezone ?? services.timezone())
            : services.timezone(),
        ),

      async completeOnboarding(draft) {
        const data = current();
        const outcome = completeOnboardingAction(draft, data, {
          ...ctx(),
          timezone: data.profile?.timezone ?? services.timezone(),
        });
        // A blocked result stores nothing: the user sees the "consult a doctor" message.
        if (!outcome.result.ok) {
          return outcome.result;
        }
        await repository.saveProfile(outcome.profile);
        await repository.saveGoal(outcome.goal);
        await repository.savePlan(outcome.result.plan);
        update({
          ...data,
          profile: outcome.profile,
          goal: outcome.goal,
          plan: outcome.result.plan,
        });
        return outcome.result;
      },

      async saveWorkout(log) {
        const data = current();
        await repository.saveWorkoutLog(log);
        const plan = data.plan ? markSessionDone(data.plan, log) : null;
        if (plan && plan !== data.plan) {
          await repository.savePlan(plan);
        }
        const workoutLogs = [...data.workoutLogs.filter((l) => l.id !== log.id), log];
        update({ ...data, plan, workoutLogs });
      },

      async acceptProposal(proposal) {
        const data = current();
        const { profile, plan } = requireProfile();
        const result = acceptProposalAction(plan, profile, proposal, ctx());
        await repository.savePlan(result.plan);
        await repository.addScheduleChanges(result.changes);
        update({
          ...data,
          plan: result.plan,
          scheduleChanges: [...data.scheduleChanges, ...result.changes],
        });
      },

      async regeneratePlan() {
        const data = current();
        const { profile, goal } = data;
        if (!profile || !goal) {
          throw new Error('Finish onboarding first');
        }
        const result = regeneratePlanAction(profile, goal, ctx());
        if (result.ok) {
          await repository.savePlan(result.plan);
          update({ ...data, plan: result.plan });
        }
        return result;
      },

      exportData: () => repository.exportData(services.now()),

      async deleteAllData() {
        await repository.clearAll();
        setState({ status: 'ready', data: EMPTY_APP_DATA });
      },

      reload,
    };
  }, [state, services, repository, reload]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error('useStore must be used inside <StoreProvider>');
  }
  return store;
}
