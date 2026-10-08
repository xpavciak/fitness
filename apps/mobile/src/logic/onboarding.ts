import {
  GoalSchema,
  PARQ_QUESTIONS,
  ProfileSchema,
  TimeOfDaySchema,
  WEEKDAYS,
  type BodyRegion,
  type Equipment,
  type ExperienceLevel,
  type Goal,
  type GoalType,
  type ParqQuestionKey,
  type Profile,
  type TrainingSlot,
  type Weekday,
} from '@fitness/engine';

/** Form state of the onboarding wizard (strings where the user types). */
export interface OnboardingDraft {
  birthYear: string;
  experience: ExperienceLevel;
  equipment: Equipment[];
  limitations: BodyRegion[];
  daysPerWeek: number;
  sessionMinutes: number;
  availableDays: Weekday[];
  /** Preferred start time (`HH:MM`) per available day ("when"). */
  slotTimes: Partial<Record<Weekday, string>>;
  /** Where the user trains ("where"), e.g. "Home" or "Gym near work". */
  location: string;
  /** `null` until answered. */
  parq: Record<ParqQuestionKey, boolean | null>;
  goalType: GoalType;
  goalTarget: string;
  healthConsent: boolean;
  disclaimerAccepted: boolean;
}

export const ONBOARDING_STEPS = ['about', 'schedule', 'health', 'goal'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const SESSION_MINUTE_OPTIONS = [15, 20, 30, 45, 60, 75, 90] as const;
export const DEFAULT_SLOT_TIME = '18:00';

const PARQ_KEYS = Object.keys(PARQ_QUESTIONS) as ParqQuestionKey[];

export function emptyOnboardingDraft(): OnboardingDraft {
  return {
    birthYear: '',
    experience: 'beginner',
    equipment: [],
    limitations: [],
    daysPerWeek: 3,
    sessionMinutes: 45,
    availableDays: ['mon', 'wed', 'fri'],
    slotTimes: { mon: DEFAULT_SLOT_TIME, wed: DEFAULT_SLOT_TIME, fri: DEFAULT_SLOT_TIME },
    location: 'Home',
    parq: Object.fromEntries(PARQ_KEYS.map((key) => [key, null])) as Record<
      ParqQuestionKey,
      boolean | null
    >,
    goalType: 'general',
    goalTarget: '',
    healthConsent: false,
    disclaimerAccepted: false,
  };
}

/** Draft prefilled from a saved profile and goal (used to edit answers or regenerate). */
export function draftFromProfile(profile: Profile, goal: Goal | null): OnboardingDraft {
  const slotTimes: Partial<Record<Weekday, string>> = {};
  for (const slot of profile.training_slots) {
    slotTimes[slot.day] = slot.start_time;
  }
  const { answered_at: _answeredAt, ...parq } = profile.parq;
  return {
    birthYear: String(profile.birth_year),
    experience: profile.experience_level,
    equipment: profile.equipment.filter((item) => item !== 'bodyweight'),
    limitations: [...profile.limitations],
    daysPerWeek: profile.days_per_week,
    sessionMinutes: profile.session_minutes,
    availableDays: [...profile.available_days],
    slotTimes,
    location: profile.training_slots[0]?.location ?? '',
    parq,
    goalType: goal?.type ?? 'general',
    goalTarget: goal?.target ?? '',
    // Consent and the disclaimer are asked again whenever answers change.
    healthConsent: false,
    disclaimerAccepted: false,
  };
}

/** Toggles a value in a list, keeping the canonical order of `all`. */
export function toggleInList<T>(list: readonly T[], value: T, all: readonly T[]): T[] {
  const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  return all.filter((item) => next.includes(item));
}

/** Selects or deselects an available day, adding a default preferred time for new days. */
export function toggleAvailableDay(draft: OnboardingDraft, day: Weekday): OnboardingDraft {
  const availableDays = toggleInList(draft.availableDays, day, WEEKDAYS);
  const slotTimes: Partial<Record<Weekday, string>> = {};
  for (const available of availableDays) {
    slotTimes[available] = draft.slotTimes[available] ?? DEFAULT_SLOT_TIME;
  }
  return { ...draft, availableDays, slotTimes };
}

export type OnboardingErrors = Partial<Record<string, string>>;

/** Field errors for one wizard step (empty when the step is complete). */
export function validateOnboardingStep(
  draft: OnboardingDraft,
  step: OnboardingStep,
  currentYear: number,
): OnboardingErrors {
  const errors: OnboardingErrors = {};
  switch (step) {
    case 'about': {
      const year = Number(draft.birthYear.trim());
      if (!/^\d{4}$/.test(draft.birthYear.trim()) || year < 1900 || year > currentYear) {
        errors.birthYear = `Enter your year of birth (1900-${currentYear}).`;
      }
      break;
    }
    case 'schedule': {
      if (draft.availableDays.length < draft.daysPerWeek) {
        errors.availableDays = `Pick at least ${draft.daysPerWeek} days you could train.`;
      }
      for (const day of draft.availableDays) {
        const time = draft.slotTimes[day]?.trim() ?? '';
        if (time !== '' && !TimeOfDaySchema.safeParse(time).success) {
          errors[`slot_${day}`] = 'Use 24-hour HH:MM, e.g. 07:30.';
        }
      }
      const hasTimes = draft.availableDays.some(
        (day) => (draft.slotTimes[day]?.trim() ?? '') !== '',
      );
      if (hasTimes && draft.location.trim() === '') {
        errors.location = 'Say where you will train, e.g. "Home".';
      } else if (draft.location.trim().length > 80) {
        errors.location = 'Keep it under 80 characters.';
      }
      break;
    }
    case 'health': {
      if (PARQ_KEYS.some((key) => draft.parq[key] === null)) {
        errors.parq = 'Please answer every question.';
      }
      break;
    }
    case 'goal': {
      if (draft.goalTarget.trim().length > 200) {
        errors.goalTarget = 'Keep it under 200 characters.';
      }
      if (!draft.healthConsent) {
        errors.healthConsent = 'We need your consent to store health answers on this device.';
      }
      if (!draft.disclaimerAccepted) {
        errors.disclaimerAccepted = 'Please confirm you have read the disclaimer.';
      }
      break;
    }
  }
  return errors;
}

/** Errors for all steps; the first step with errors is where the wizard should go back to. */
export function validateOnboarding(
  draft: OnboardingDraft,
  currentYear: number,
): { step: OnboardingStep; errors: OnboardingErrors } | null {
  for (const step of ONBOARDING_STEPS) {
    const errors = validateOnboardingStep(draft, step, currentYear);
    if (Object.keys(errors).length > 0) {
      return { step, errors };
    }
  }
  return null;
}

export interface ProfileContext {
  userId: string;
  /** ISO instant used for `answered_at` and `consent_health_at`. */
  now: string;
  /** Device IANA time zone. */
  timezone: string;
}

/** Maps a completed draft to a schema-valid profile. Throws when the draft is incomplete. */
export function buildProfile(draft: OnboardingDraft, ctx: ProfileContext): Profile {
  const parqAnswers = Object.fromEntries(
    PARQ_KEYS.map((key) => {
      const answer = draft.parq[key];
      if (answer === null) {
        throw new Error(`PAR-Q+ question "${key}" is not answered`);
      }
      return [key, answer];
    }),
  ) as Record<ParqQuestionKey, boolean>;
  if (!draft.healthConsent) {
    throw new Error('Health-data consent is required');
  }
  const location = draft.location.trim();
  const training_slots: TrainingSlot[] = draft.availableDays.flatMap((day) => {
    const time = draft.slotTimes[day]?.trim() ?? '';
    return time !== '' && location !== '' ? [{ day, start_time: time, location }] : [];
  });
  return ProfileSchema.parse({
    user_id: ctx.userId,
    birth_year: Number(draft.birthYear.trim()),
    timezone: ctx.timezone,
    experience_level: draft.experience,
    equipment: ['bodyweight', ...draft.equipment.filter((item) => item !== 'bodyweight')],
    limitations: draft.limitations,
    days_per_week: draft.daysPerWeek,
    available_days: draft.availableDays,
    session_minutes: draft.sessionMinutes,
    training_slots,
    parq: { ...parqAnswers, answered_at: ctx.now },
    consent_health_at: ctx.now,
  });
}

export function buildGoal(
  draft: OnboardingDraft,
  ctx: { id: string; userId: string; now: string },
): Goal {
  const target = draft.goalTarget.trim();
  return GoalSchema.parse({
    id: ctx.id,
    user_id: ctx.userId,
    type: draft.goalType,
    ...(target === '' ? {} : { target }),
    status: 'active',
    created_at: ctx.now,
  });
}
