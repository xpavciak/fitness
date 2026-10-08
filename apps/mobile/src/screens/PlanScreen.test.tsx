// @vitest-environment jsdom
import { createSeededIdGenerator } from '@fitness/engine';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionsByDate } from '../logic/plan-view';
import { AppController, type Services } from '../state/app-controller';
import { StoreProvider, useStore, type Store } from '../state/store';
import { MemoryKeyValueStore } from '../storage/key-value-store';
import { LocalRepository } from '../storage/repository';
import { NoopSyncAdapter } from '../sync/sync-adapter';
import { completedDraft, must, NOW, TIMEZONE } from '../test/fixtures';
import { PlanScreen } from './PlanScreen';

afterEach(cleanup);

async function onboardedServices(): Promise<Services> {
  const services: Services = {
    repository: new LocalRepository(new MemoryKeyValueStore()),
    sync: new NoopSyncAdapter(),
    newId: createSeededIdGenerator(9),
    timezone: () => TIMEZONE,
    now: () => NOW,
  };
  const controller = new AppController(services);
  await controller.load();
  expect((await controller.completeOnboarding(completedDraft())).ok).toBe(true);
  return services;
}

let liveStore: Store | null = null;
function keepStore(store: Store): void {
  liveStore = store;
}

/** Renders the Plan screen with the store's live data (as the route does). */
function LivePlan({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const store = useStore();
  useEffect(() => {
    keepStore(store);
  }, [store]);
  const { state } = store;
  return state.status === 'ready' ? (
    <PlanScreen data={state.data} onOpenSession={onOpenSession} onEditAnswers={vi.fn()} />
  ) : null;
}

describe('PlanScreen: double-tap guard', () => {
  it('a double tap on "Minimum dose" applies it once', async () => {
    const services = await onboardedServices();
    render(
      <StoreProvider services={services}>
        <LivePlan onOpenSession={vi.fn()} />
      </StoreProvider>,
    );
    const button = must((await screen.findAllByTestId('minimum-dose'))[0]);
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByTestId('notice');
    const plan = must((await services.repository.load()).plan);
    const doses = sessionsByDate(must(plan.weeks[0])).filter((s) => s.variant === 'minimum_dose');
    expect(doses).toHaveLength(1);
    expect(screen.getByTestId('notice').textContent).toMatch(/minimum-dose/);
  });

  it('ignores taps for 400 ms after the screen regains focus (e.g. back from a workout)', async () => {
    let now = 7_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const services = await onboardedServices();
      const onOpenSession = vi.fn();
      render(
        <StoreProvider services={services}>
          <LivePlan onOpenSession={onOpenSession} />
        </StoreProvider>,
      );
      await screen.findAllByTestId('short-on-time');
      await waitFor(() => {
        expect(screen.getAllByTestId('start-today')[0]?.getAttribute('aria-disabled')).not.toBe(
          'true',
        );
      });
      // The second tap of a double tap on "Finish workout" arrives right after the Plan screen
      // regains focus: it must not open "Short on time" (QA) or a session.
      act(() => {
        must(liveStore).controller.refreshClock();
      });
      now += 100;
      fireEvent.click(must(screen.getAllByTestId('short-on-time')[0]));
      fireEvent.click(must(screen.getAllByTestId(/^open-session-/)[0]));
      expect(screen.queryByTestId('proposals')).toBeNull();
      expect(onOpenSession).not.toHaveBeenCalled();
      // A deliberate tap once the screen has settled works.
      now += 400;
      fireEvent.click(must(screen.getAllByTestId('short-on-time')[0]));
      expect(screen.getByTestId('proposals')).toBeTruthy();
    } finally {
      clock.mockRestore();
    }
  });
});

describe('PlanScreen: minimum-dose notice', () => {
  it('disappears once that session is done', async () => {
    const services = await onboardedServices();
    render(
      <StoreProvider services={services}>
        <LivePlan onOpenSession={vi.fn()} />
      </StoreProvider>,
    );
    fireEvent.click(must((await screen.findAllByTestId('minimum-dose'))[0]));
    await screen.findByTestId('notice');
    const plan = must((await services.repository.load()).plan);
    const session = must(
      sessionsByDate(must(plan.weeks[0])).find((s) => s.variant === 'minimum_dose'),
    );
    const planned = must(session.exercises[0]);
    const id = '00000007-0000-4000-8000-000000000001';
    await act(async () => {
      await must(liveStore).saveWorkout({
        id,
        user_id: must((await services.repository.load()).profile).user_id,
        planned_session_id: session.id,
        started_at: NOW,
        ended_at: NOW,
        sets: [
          {
            id: '00000007-0000-4000-8000-000000000002',
            workout_log_id: id,
            exercise_id: planned.exercise_id,
            planned_exercise_id: planned.id,
            set_index: 0,
            measure: planned.measure,
            reps: planned.rep_min,
            load_kg: 0,
            is_warmup: false,
            completed: true,
            performed_at: NOW,
          },
        ],
      });
    });
    expect(screen.getByTestId(`status-${session.id}`).textContent).toBe('Done');
    expect(screen.queryByTestId('notice')).toBeNull();
  });
});
