// @vitest-environment jsdom
import { createSeededIdGenerator } from '@fitness/engine';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionsByDate } from '../logic/plan-view';
import { AppController, type Services } from '../state/app-controller';
import { StoreProvider, useStore } from '../state/store';
import { MemoryKeyValueStore } from '../storage/key-value-store';
import { LocalRepository, WORKOUT_DRAFT_PREFIX } from '../storage/repository';
import { NoopSyncAdapter } from '../sync/sync-adapter';
import { completedDraft, must, NOW, TIMEZONE } from '../test/fixtures';
import { WorkoutScreen } from './WorkoutScreen';

afterEach(cleanup);

async function setup() {
  const kv = new MemoryKeyValueStore();
  const services: Services = {
    repository: new LocalRepository(kv),
    sync: new NoopSyncAdapter(),
    newId: createSeededIdGenerator(13),
    timezone: () => TIMEZONE,
    now: () => NOW,
  };
  const controller = new AppController(services);
  await controller.load();
  expect((await controller.completeOnboarding(completedDraft())).ok).toBe(true);
  const plan = must((await services.repository.load()).plan);
  return { kv, services, session: must(sessionsByDate(must(plan.weeks[0]))[0]) };
}

function LiveWorkout({ sessionId }: { sessionId: string }) {
  const { state } = useStore();
  return state.status === 'ready' ? (
    <WorkoutScreen data={state.data} sessionId={sessionId} onFinished={vi.fn()} />
  ) : null;
}

const draftKeys = (kv: MemoryKeyValueStore) =>
  kv.keys().filter((key) => key.startsWith(WORKOUT_DRAFT_PREFIX));

describe('WorkoutScreen: saved drafts', () => {
  it('stores nothing until the first change, then saves the inputs', async () => {
    const { kv, services, session } = await setup();
    render(
      <StoreProvider services={services}>
        <LiveWorkout sessionId={session.id} />
      </StoreProvider>,
    );
    await screen.findByTestId('workout-screen');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(draftKeys(kv)).toEqual([]);

    const load = screen.queryByTestId('set-0-0-load');
    if (load) {
      fireEvent.change(load, { target: { value: '10' } });
    }
    fireEvent.click(screen.getByTestId('set-0-0-complete'));
    await waitFor(() => {
      expect(draftKeys(kv)).toEqual([`${WORKOUT_DRAFT_PREFIX}${session.id}`]);
    });
    const saved = must(await services.repository.loadWorkoutDraft(session.id));
    expect(saved.sets.filter((set) => set.completed)).toHaveLength(1);
  });

  it('shows no RIR on timed exercises', async () => {
    const { services, session } = await setup();
    render(
      <StoreProvider services={services}>
        <LiveWorkout sessionId={session.id} />
      </StoreProvider>,
    );
    await screen.findByTestId('workout-screen');
    expect(session.exercises.some((exercise) => exercise.measure === 'seconds')).toBe(true);
    session.exercises.forEach((exercise, index) => {
      const card = screen.getByTestId(`exercise-${index}`);
      const timed = exercise.measure === 'seconds';
      expect(card.textContent.includes('target RIR')).toBe(!timed);
      expect(screen.queryByTestId(`set-${index}-0-rir-plus`) === null).toBe(timed);
    });
  });
});
