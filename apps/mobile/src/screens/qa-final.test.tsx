// @vitest-environment jsdom
/**
 * QA final (T11): UI defects found while driving the exported web app with Playwright, now fixed.
 * These are regression tests (they started as `it.fails` bug markers).
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
  // Was a major bug: "Delete all local data" asked for a second tap to confirm, but a double tap (two
  // taps in quick succession) satisfies the confirmation and wipes all local-only data with no
  // undo. Reproduced in Chromium with Playwright `dblclick()` on `delete-data`. Expected: a second
  // tap only confirms after a short delay (e.g. 500 ms) or through a separate confirm dialog.
  it('a double tap on "Delete all local data" does not delete anything', async () => {
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

describe('QA final - Settings: deliberate confirmation still works', () => {
  async function renderSettings() {
    const { services, data } = await onboardedServices();
    const onDeleted = vi.fn();
    render(
      <StoreProvider services={services}>
        <SettingsScreen data={data} onEditAnswers={vi.fn()} onDeleted={onDeleted} />
      </StoreProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('delete-data').getAttribute('aria-disabled')).not.toBe('true');
    });
    return { services, onDeleted };
  }

  it('deletes after a second tap at least 600 ms after the first', async () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { services, onDeleted } = await renderSettings();
      fireEvent.click(screen.getByTestId('delete-data'));
      await screen.findByText('Tap again to delete everything');
      now += 700;
      fireEvent.click(screen.getByTestId('delete-data'));
      await waitFor(() => {
        expect(onDeleted).toHaveBeenCalledTimes(1);
      });
      expect((await services.repository.load()).profile).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });

  it('a double tap on "Regenerate plan" does not replace the plan', async () => {
    const { services } = await renderSettings();
    const before = (await services.repository.load()).plan?.id;
    fireEvent.click(screen.getByTestId('regenerate-plan'));
    await screen.findByText('Tap again to replace your plan');
    fireEvent.click(screen.getByTestId('regenerate-plan'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await services.repository.load()).plan?.id).toBe(before);
    // Cancel disarms.
    fireEvent.click(screen.getByTestId('cancel-confirm'));
    expect(screen.getByText('Regenerate plan')).toBeTruthy();
  });
});

describe('QA final - Progress', () => {
  const log: WorkoutLog = {
    id: '00000000-0000-4000-8000-0000000000aa',
    user_id: '00000000-0000-4000-8000-000000000001',
    started_at: '2026-10-12T05:35:00.000Z',
    sets: [],
  };

  // Was a minor bug: after "Edit answers" set a PAR-Q+ red flag, the plan is removed (as designed),
  // but Progress then says "Finish onboarding to start tracking your progress." although the user
  // finished onboarding and has logged workouts; their history and records are hidden.
  it('does not tell an onboarded user with logs to finish onboarding', async () => {
    const { services, data } = await onboardedServices();
    const blocked: AppData = { ...EMPTY_APP_DATA, profile: data.profile, workoutLogs: [log] };
    render(
      <StoreProvider services={services}>
        <ProgressScreen data={blocked} />
      </StoreProvider>,
    );
    expect(screen.getByTestId('progress-empty').textContent).not.toMatch(/finish onboarding/i);
    // The history is still shown.
    expect(screen.getByTestId('workout-history').textContent).toContain('0 sets');
    expect(screen.getByText('Personal records')).toBeTruthy();
  });
});
