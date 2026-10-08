// @vitest-environment jsdom
import { PARQ_BLOCK_MESSAGE } from '@fitness/engine';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyOnboardingDraft } from '../logic/onboarding';
import { completedDraft } from '../test/fixtures';
import { OnboardingScreen, type OnboardingSubmitResult } from './OnboardingScreen';

// Smoke render through react-native-web (aliased in vitest.config.mts); testID -> data-testid.
afterEach(cleanup);

function renderScreen(
  onSubmit = vi.fn<() => Promise<OnboardingSubmitResult>>(() => Promise.resolve({ ok: true })),
  draft = emptyOnboardingDraft(),
) {
  render(
    <OnboardingScreen
      initialDraft={draft}
      currentYear={2026}
      timezone="Europe/Bratislava"
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

describe('OnboardingScreen (smoke)', () => {
  it('renders the first step and validates the birth year', () => {
    renderScreen();
    expect(screen.getByTestId('onboarding-about')).toBeTruthy();
    expect(screen.getByText('About you')).toBeTruthy();
    fireEvent.click(screen.getByTestId('onboarding-next'));
    expect(screen.getByText('Enter your year of birth (1900-2026).')).toBeTruthy();
    fireEvent.change(screen.getByTestId('birth-year'), { target: { value: '1990' } });
    fireEvent.click(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('onboarding-schedule')).toBeTruthy();
    expect(screen.getByText('Time zone: Europe/Bratislava')).toBeTruthy();
  });

  it('shows the consult-a-doctor message when submission is blocked', async () => {
    const onSubmit = renderScreen(
      vi.fn(() =>
        Promise.resolve({ ok: false, message: PARQ_BLOCK_MESSAGE, redFlags: ['chest_pain'] }),
      ),
      completedDraft(),
    );
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByTestId('onboarding-next'));
    }
    expect(screen.getByTestId('onboarding-goal')).toBeTruthy();
    expect(screen.getByText('Not medical advice')).toBeTruthy();
    expect(screen.getByTestId('consent-checkbox')).toBeTruthy();
    fireEvent.click(screen.getByTestId('onboarding-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('screening-message').textContent).toContain('consult a doctor');
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('review-answers'));
    expect(screen.getByTestId('onboarding-about')).toBeTruthy();
  });

  it('labels PAR-Q+ answers with their question as radio buttons', () => {
    renderScreen(undefined, completedDraft());
    fireEvent.click(screen.getByTestId('onboarding-next'));
    fireEvent.click(screen.getByTestId('onboarding-next'));
    const no = screen.getByTestId('parq-chest_pain-no');
    expect(no.getAttribute('role')).toBe('radio');
    expect(no.getAttribute('aria-checked')).toBe('true');
    expect(no.getAttribute('aria-label')).toMatch(/^Do you feel pain in your chest.* No$/);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(7);
  });
});
