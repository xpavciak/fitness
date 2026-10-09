import { createSeededIdGenerator, type Plan } from '@fitness/engine';
import { completeOnboarding, type OnboardingOutcome } from '../logic/actions';
import { emptyOnboardingDraft, type OnboardingDraft } from '../logic/onboarding';

/** Thursday 8 October 2026; the generated plan starts on Monday 12 October. */
export const NOW = '2026-10-08T10:00:00.000Z';
export const TIMEZONE = 'Europe/Bratislava';

export function completedDraft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  const draft = emptyOnboardingDraft();
  return {
    ...draft,
    birthYear: '1990',
    equipment: ['dumbbells', 'bench'],
    parq: Object.fromEntries(Object.keys(draft.parq).map((key) => [key, false])) as Record<
      keyof OnboardingDraft['parq'],
      boolean
    >,
    healthConsent: true,
    disclaimerAccepted: true,
    ...overrides,
  };
}

export function onboard(
  overrides: Partial<OnboardingDraft> = {},
  seed = 1,
): OnboardingOutcome & { newId: () => string } {
  const newId = createSeededIdGenerator(seed);
  const outcome = completeOnboarding(
    completedDraft(overrides),
    { profile: null, goal: null },
    { now: NOW, timezone: TIMEZONE, newId },
  );
  return { ...outcome, newId };
}

export function onboardedPlan(overrides: Partial<OnboardingDraft> = {}): {
  outcome: OnboardingOutcome;
  plan: Plan;
  newId: () => string;
} {
  const { newId, ...outcome } = onboard(overrides);
  if (!outcome.result.ok) {
    throw new Error(`Expected a plan, got: ${outcome.result.message}`);
  }
  return { outcome, plan: outcome.result.plan, newId };
}

/** ISO instant at 10:00 UTC on a calendar date. */
export function at(date: string, time = '10:00:00'): string {
  return `${date}T${time}.000Z`;
}

/** Narrows away `undefined` in tests (the lint config forbids non-null assertions). */
export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${what} to be present`);
  }
  return value;
}
