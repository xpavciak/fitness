// @vitest-environment jsdom
/**
 * QA final, re-verification after the T9 fix round (dd86fba). Fixed; now a regression test.
 */
import { createSeededIdGenerator } from '@fitness/engine';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppController, type Services } from '../state/app-controller';
import { StoreProvider, useStore } from '../state/store';
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
    newId: createSeededIdGenerator(11),
    timezone: () => TIMEZONE,
    now: () => NOW,
  };
  const controller = new AppController(services);
  await controller.load();
  expect((await controller.completeOnboarding(completedDraft())).ok).toBe(true);
  return services;
}

function LivePlan() {
  const { state } = useStore();
  return state.status === 'ready' ? (
    <PlanScreen data={state.data} onOpenSession={vi.fn()} onEditAnswers={vi.fn()} />
  ) : null;
}

describe('QA final r2 - Plan screen tap guard', () => {
  // Was a minor bug: the 600 ms tap guard was shared by every guarded control on the Plan screen, so a
  // deliberate tap on a DIFFERENT control shortly after the previous one is silently dropped.
  // Playwright: "Can't make it" then "Accept" 150/400 ms later -> nothing happens, no feedback, no
  // schedule change stored; at 700 ms it applies. Expected: the guard only drops a repeat tap on
  // the same control (or the tap that lands on what moved under the finger), not a tap on the
  // control that the first tap revealed.
  it('accepts a proposal tapped 300 ms after opening the panel', async () => {
    let now = 5_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const services = await onboardedServices();
      render(
        <StoreProvider services={services}>
          <LivePlan />
        </StoreProvider>,
      );
      const cant = await screen.findAllByTestId('cant-make-it');
      await waitFor(() => {
        expect(must(cant[0]).getAttribute('aria-disabled')).not.toBe('true');
      });
      fireEvent.click(must(cant[0]));
      const accept = await screen.findByTestId('accept-proposal-0');
      now += 300;
      fireEvent.click(accept);
      await waitFor(() => {
        expect(screen.getByTestId('notice').textContent).toMatch(/week has been updated/);
      });
      expect((await services.repository.load()).scheduleChanges.length).toBeGreaterThan(0);
    } finally {
      clock.mockRestore();
    }
  });
});
