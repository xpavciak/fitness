import type { ScheduleProposal, WorkoutLog } from '@fitness/engine';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import type { PlanResult } from '../engine/engine-service';
import type { OnboardingDraft } from '../logic/onboarding';
import type { DataExport } from '../storage/repository';
import { AppController, type LoadState, type Services } from './app-controller';

export type { LoadState, Services } from './app-controller';

export interface Store {
  state: LoadState;
  /** An action is running: disable action buttons. */
  busy: boolean;
  /** Changes when the app is foregrounded or a tab gains focus (a new screen visit). */
  clock: number;
  services: Services;
  /** Stable controller (e.g. for `refreshClock` in focus effects). */
  controller: AppController;
  /** The user's local date in the profile's time zone. */
  today: () => string;
  completeOnboarding(draft: OnboardingDraft): Promise<PlanResult>;
  saveWorkout(log: WorkoutLog): Promise<void>;
  discardWorkoutDraft(sessionId: string): Promise<void>;
  acceptProposal(proposal: ScheduleProposal): Promise<void>;
  regeneratePlan(): Promise<PlanResult>;
  exportData(): Promise<DataExport>;
  deleteAllData(): Promise<void>;
  reload(): Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ services, children }: { services: Services; children: ReactNode }) {
  const [controller] = useState(() => new AppController(services));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    void controller.load();
  }, [controller]);

  // "Today" changes overnight: recompute it whenever the app comes back to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        controller.refreshClock();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [controller]);

  const store = useMemo(
    (): Store => ({
      state: snapshot.state,
      busy: snapshot.busy,
      clock: snapshot.clock,
      services: controller.services,
      controller,
      today: () => controller.today(),
      completeOnboarding: (draft) => controller.completeOnboarding(draft),
      saveWorkout: (log) => controller.saveWorkout(log),
      discardWorkoutDraft: (sessionId) => controller.discardWorkoutDraft(sessionId),
      acceptProposal: (proposal) => controller.acceptProposal(proposal),
      regeneratePlan: () => controller.regeneratePlan(),
      exportData: () => controller.exportData(),
      deleteAllData: () => controller.deleteAllData(),
      reload: () => controller.load(),
    }),
    [snapshot, controller],
  );

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error('useStore must be used inside <StoreProvider>');
  }
  return store;
}
