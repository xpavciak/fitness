import { PARQ_BLOCK_MESSAGE, UNDER_18_MESSAGE } from '@fitness/engine';
import { describe, expect, it } from 'vitest';
import { completedDraft, NOW, onboard, TIMEZONE } from '../test/fixtures';
import {
  buildProfile,
  draftFromProfile,
  emptyOnboardingDraft,
  toggleAvailableDay,
  toggleInList,
  validateOnboarding,
  validateOnboardingStep,
} from './onboarding';

const USER_ID = '00000001-0000-4000-8000-0000000000aa';

describe('validateOnboardingStep', () => {
  it('requires a plausible birth year', () => {
    const draft = emptyOnboardingDraft();
    expect(validateOnboardingStep(draft, 'about', 2026).birthYear).toMatch(/year of birth/);
    expect(validateOnboardingStep({ ...draft, birthYear: '2027' }, 'about', 2026).birthYear).toBe(
      'Enter your year of birth (1900-2026).',
    );
    expect(validateOnboardingStep({ ...draft, birthYear: ' 1985 ' }, 'about', 2026)).toEqual({});
  });

  it('requires enough available days, valid times and a place', () => {
    const draft = { ...emptyOnboardingDraft(), daysPerWeek: 4 };
    expect(validateOnboardingStep(draft, 'schedule', 2026).availableDays).toBe(
      'Pick at least 4 days you could train.',
    );
    const badTime = { ...emptyOnboardingDraft(), slotTimes: { mon: '7:5' }, location: '' };
    const errors = validateOnboardingStep(badTime, 'schedule', 2026);
    expect(errors.slot_mon).toMatch(/HH:MM/);
    expect(errors.location).toMatch(/where/);
  });

  it('requires every PAR-Q+ answer, consent and the disclaimer', () => {
    const draft = emptyOnboardingDraft();
    expect(validateOnboardingStep(draft, 'health', 2026).parq).toBe(
      'Please answer every question.',
    );
    const goalErrors = validateOnboardingStep(draft, 'goal', 2026);
    expect(Object.keys(goalErrors).sort()).toEqual(['disclaimerAccepted', 'healthConsent']);
  });

  it('reports the first incomplete step', () => {
    expect(validateOnboarding(completedDraft(), 2026)).toBeNull();
    expect(validateOnboarding(completedDraft({ healthConsent: false }), 2026)?.step).toBe('goal');
    expect(validateOnboarding(emptyOnboardingDraft(), 2026)?.step).toBe('about');
  });
});

describe('toggle helpers', () => {
  it('keeps canonical order', () => {
    expect(toggleInList(['c', 'a'], 'b', ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(toggleInList(['a', 'b'], 'a', ['a', 'b'])).toEqual(['b']);
  });

  it('adds and removes the preferred time with the day', () => {
    const added = toggleAvailableDay(emptyOnboardingDraft(), 'sat');
    expect(added.availableDays).toEqual(['mon', 'wed', 'fri', 'sat']);
    expect(added.slotTimes.sat).toBe('18:00');
    const removed = toggleAvailableDay(added, 'mon');
    expect(removed.availableDays).not.toContain('mon');
    expect(removed.slotTimes.mon).toBeUndefined();
  });
});

describe('buildProfile (onboarding -> profile mapping)', () => {
  it('maps the draft to a schema-valid profile', () => {
    const profile = buildProfile(
      completedDraft({
        limitations: ['knee'],
        slotTimes: { mon: '07:00', wed: '', fri: '18:30' },
        location: ' Gym near work ',
      }),
      { userId: USER_ID, now: NOW, timezone: TIMEZONE },
    );
    expect(profile).toMatchObject({
      user_id: USER_ID,
      birth_year: 1990,
      timezone: TIMEZONE,
      equipment: ['bodyweight', 'dumbbells', 'bench'],
      limitations: ['knee'],
      days_per_week: 3,
      available_days: ['mon', 'wed', 'fri'],
      session_minutes: 45,
      consent_health_at: NOW,
    });
    expect(profile.training_slots).toEqual([
      { day: 'mon', start_time: '07:00', location: 'Gym near work' },
      { day: 'fri', start_time: '18:30', location: 'Gym near work' },
    ]);
    expect(profile.parq.answered_at).toBe(NOW);
    expect(profile.parq.chest_pain).toBe(false);
  });

  it('refuses an unanswered PAR-Q+ or missing consent', () => {
    const ctx = { userId: USER_ID, now: NOW, timezone: TIMEZONE };
    expect(() => buildProfile(emptyOnboardingDraft(), ctx)).toThrow(/not answered/);
    expect(() => buildProfile(completedDraft({ healthConsent: false }), ctx)).toThrow(/consent/);
  });

  it('rejects an invalid time zone through the schema', () => {
    expect(() =>
      buildProfile(completedDraft(), { userId: USER_ID, now: NOW, timezone: 'Mars/Base' }),
    ).toThrow();
  });

  it('round-trips through draftFromProfile (consent asked again)', () => {
    const { profile, goal } = onboard({ goalType: 'strength', goalTarget: '5 pull-ups' });
    const draft = draftFromProfile(profile, goal);
    expect(draft).toMatchObject({
      birthYear: '1990',
      equipment: ['dumbbells', 'bench'],
      goalType: 'strength',
      goalTarget: '5 pull-ups',
      healthConsent: false,
      location: 'Home',
    });
    expect(
      buildProfile(
        { ...draft, healthConsent: true },
        {
          userId: profile.user_id,
          now: NOW,
          timezone: TIMEZONE,
        },
      ),
    ).toEqual(profile);
  });
});

describe('completeOnboarding', () => {
  it('generates a plan for a cleared adult', () => {
    const { result, goal, profile } = onboard({ goalType: 'hypertrophy' });
    expect(result.ok).toBe(true);
    expect(goal).toMatchObject({ type: 'hypertrophy', status: 'active', user_id: profile.user_id });
    if (result.ok) {
      expect(result.plan.start_date).toBe('2026-10-12');
      expect(result.plan.weeks[0]?.sessions).toHaveLength(3);
    }
  });

  it('shows the consult-a-doctor message on a PAR-Q+ red flag', () => {
    const draft = completedDraft();
    const { result } = onboard({ parq: { ...draft.parq, chest_pain: true } });
    expect(result).toMatchObject({
      ok: false,
      reason: 'parq_red_flag',
      message: PARQ_BLOCK_MESSAGE,
      redFlags: ['chest_pain'],
    });
  });

  it('blocks a user who may be under 18', () => {
    const { result } = onboard({ birthYear: '2008' });
    expect(result).toMatchObject({ ok: false, reason: 'under_18', message: UNDER_18_MESSAGE });
  });
});
