import {
  ageOn,
  parqRedFlags,
  type IsoDate,
  type ParqQuestionKey,
  type Profile,
} from '../schemas/index.js';

export const MINIMUM_AGE = 18;

export const SCREENING_BLOCK_REASONS = ['parq_red_flag', 'under_18'] as const;
export type ScreeningBlockReason = (typeof SCREENING_BLOCK_REASONS)[number];

export type ScreeningResult =
  | { ok: true }
  | {
      ok: false;
      reason: ScreeningBlockReason;
      /** Plain-English message for the user. */
      message: string;
      /** PAR-Q+ questions answered "yes" (empty for the age gate). */
      redFlags: ParqQuestionKey[];
    };

export const PARQ_BLOCK_MESSAGE =
  'Thanks for answering honestly. Based on your health answers, please consult a doctor or ' +
  'a qualified exercise professional before starting a training plan. Once you have their ' +
  'go-ahead, update your answers and we will build your plan. This app does not give medical advice.';

export const UNDER_18_MESSAGE =
  'This app is designed for adults aged 18 and over. Please consult a doctor or a qualified ' +
  'professional, such as a coach or PE teacher, before starting a training plan. ' +
  'This app does not give medical advice.';

/**
 * PAR-Q+ and age gate (feature A). Blocks on any PAR-Q+ "yes" or when the user may be under 18.
 *
 * Only the birth year is stored, so `ageOn` is an upper bound on the true age (the birthday may
 * still be ahead). The gate is conservative: it passes only when the user is certainly 18,
 * i.e. `ageOn(profile, today) - 1 >= 18`. Someone turning 18 this calendar year is blocked until
 * January 1 of the next year.
 */
export function screenProfile(
  profile: Pick<Profile, 'parq' | 'birth_year'>,
  today: IsoDate,
): ScreeningResult {
  const redFlags = parqRedFlags(profile.parq);
  if (redFlags.length > 0) {
    return { ok: false, reason: 'parq_red_flag', message: PARQ_BLOCK_MESSAGE, redFlags };
  }
  const minimumPossibleAge = ageOn(profile, today) - 1;
  if (minimumPossibleAge < MINIMUM_AGE) {
    return { ok: false, reason: 'under_18', message: UNDER_18_MESSAGE, redFlags: [] };
  }
  return { ok: true };
}
