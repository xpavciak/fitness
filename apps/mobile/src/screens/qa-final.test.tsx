// @vitest-environment jsdom
/**
 * QA final (T11): UI defects found while driving the exported web app with Playwright. Each
 * `it.fails` documents a BUG that is still open; the test starts passing (and must be turned into
 * a plain `it`) once the bug is fixed.
 */
import type { WorkoutLog } from '@fitness/engine';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSeededIdGenerator } from '@fitness/engine';
import { AppController, type Services } from '../state/app-controller';
import { StoreProvider } from '../state/store';
import { MemoryKeyValueStore } from '../storage/key-value-store';
import { EMPTY_APP_DATA, LocalRepository, type AppData } from '../storage/repository';
import { NoopSyncAdapter } from '../sync/sync-adapter';
import { completedDraft, NOW, TIMEZONE } from '../test/fixtures';
import { ProgressScreen } from './ProgressScreen';
import { SettingsScreen } from './SettingsScreen';

// The native share module pulls in expo-file-system, which cannot load in jsdom.
vi.mock('../platform/share-json', () => ({ shareJson: vi.fn(() => Promise.resolve('ok')) }));

afterEach(cleanup);

async function onboardedServices(): Promise<{ services: Services; data: AppData }> {
  const repository = new LocalRepository(new MemoryKeyValueStore());
  const services: Services = {
    repository,
    sync: new NoopSyncAdapter(),
    newId: createSeededIdGenerator(5),
    timezone: () => TIMEZONE,
    now: () => NOW,
  };
  const controller = new AppController(services);
  await controller.load();
  const result = await controller.completeOnboarding(completedDraft());
  expect(result.ok).toBe(true);
  return { services, data: await repository.load() };
}

describe('QA final - Settings', () => {
  // BUG (major): "Delete all local data" asks for a second tap to confirm, but a double tap (two
  // taps in quick succession) satisfies the confirmation and wipes all local-only data with no
  // undo. Reproduced in Chromium with Playwright `dblclick()` on `delete-data`. Expected: a second
  // tap only confirms after a short delay (e.g. 500 ms) or through a separate confirm dialog.
  it.fails('a double tap on "Delete all local data" does not delete anything', async () => {
    const { services, data } = await onboardedServices();
    const onDeleted = vi.fn();
    render(
      <StoreProvider services={services}>
        <SettingsScreen data={data} onEditAnswers={vi.fn()} onDeleted={onDeleted} />
      </StoreProvider>,
    );
    // Wait for the provider's initial load (buttons are disabled while the store is busy).
    await waitFor(() => {
      expect(screen.getByTestId('delete-data').getAttribute('aria-disabled')).not.toBe('true');
    });
    fireEvent.click(screen.getByTestId('delete-data'));
    // As in a browser double click: the first tap re-renders, the second follows within ms.
    await screen.findByText('Tap again to delete everything');
    fireEvent.click(screen.getByTestId('delete-data'));
    // Give a (wrongly) confirmed delete time to run.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await waitFor(() => {
      expect(onDeleted).not.toHaveBeenCalled();
    });
    const after = await services.repository.load();
    expect(after.profile).not.toBeNull();
  });
});

describe('QA final - Progress', () => {
  const log: WorkoutLog = {
    id: '00000000-0000-4000-8000-0000000000aa',
    user_id: '00000000-0000-4000-8000-000000000001',
    started_at: '2026-10-12T05:35:00.000Z',
    sets: [],
  };

  // BUG (minor): after "Edit answers" sets a PAR-Q+ red flag, the plan is removed (as designed),
  // but Progress then says "Finish onboarding to start tracking your progress." although the user
  // finished onboarding and has logged workouts; their history and records are hidden.
  it.fails('does not tell an onboarded user with logs to finish onboarding', async () => {
    const { services, data } = await onboardedServices();
    const blocked: AppData = { ...EMPTY_APP_DATA, profile: data.profile, workoutLogs: [log] };
    render(
      <StoreProvider services={services}>
        <ProgressScreen data={blocked} />
      </StoreProvider>,
    );
    expect(screen.getByTestId('progress-empty').textContent).not.toMatch(/finish onboarding/i);
  });
});
