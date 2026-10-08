import { z } from 'zod';
import {
  BodyRegionSchema,
  EquipmentSchema,
  ExperienceLevelSchema,
  IdSchema,
  IsoDateTimeSchema,
  TimeOfDaySchema,
  WeekdaySchema,
  hasNoDuplicates,
  uniqueArray,
} from './common.js';

/**
 * PAR-Q+ (2023) general health questions. `true` means the user answered "yes".
 * Any "yes" is a red flag: the engine must not generate a plan and the app shows
 * a "see a doctor" message instead (feature A).
 */
export const PARQ_QUESTIONS = {
  heart_condition_or_high_blood_pressure:
    'Has your doctor ever said that you have a heart condition or high blood pressure?',
  chest_pain:
    'Do you feel pain in your chest at rest, during your daily activities, or when you do physical activity?',
  dizziness_or_loss_of_consciousness:
    'Do you lose balance because of dizziness, or have you lost consciousness in the last 12 months?',
  other_chronic_condition:
    'Have you ever been diagnosed with another chronic medical condition (other than heart disease or high blood pressure)?',
  prescribed_medication_for_chronic_condition:
    'Are you currently taking prescribed medications for a chronic medical condition?',
  bone_joint_or_soft_tissue_problem:
    'Do you currently have (or have you had within the past 12 months) a bone, joint, or soft tissue problem that could be made worse by becoming more physically active?',
  medically_supervised_activity_only:
    'Has your doctor ever said that you should only do medically supervised physical activity?',
} as const;

export type ParqQuestionKey = keyof typeof PARQ_QUESTIONS;

export const ParqAnswersSchema = z.object({
  heart_condition_or_high_blood_pressure: z.boolean(),
  chest_pain: z.boolean(),
  dizziness_or_loss_of_consciousness: z.boolean(),
  other_chronic_condition: z.boolean(),
  prescribed_medication_for_chronic_condition: z.boolean(),
  bone_joint_or_soft_tissue_problem: z.boolean(),
  medically_supervised_activity_only: z.boolean(),
  answered_at: IsoDateTimeSchema,
});
export type ParqAnswers = z.infer<typeof ParqAnswersSchema>;

/** Keys of the PAR-Q+ questions answered "yes". Empty means cleared for activity. */
export function parqRedFlags(answers: ParqAnswers): ParqQuestionKey[] {
  return (Object.keys(PARQ_QUESTIONS) as ParqQuestionKey[]).filter((key) => answers[key]);
}

export function parqHasRedFlag(answers: ParqAnswers): boolean {
  return parqRedFlags(answers).length > 0;
}

/**
 * One "when and where" slot of the user's implementation intention,
 * e.g. "Monday 07:00 at home".
 */
export const TrainingSlotSchema = z.object({
  day: WeekdaySchema,
  start_time: TimeOfDaySchema,
  location: z.string().trim().min(1).max(80),
});
export type TrainingSlot = z.infer<typeof TrainingSlotSchema>;

export const SEXES = ['female', 'male', 'other', 'prefer_not_to_say'] as const;
export const SexSchema = z.enum(SEXES);
export type Sex = z.infer<typeof SexSchema>;

export const MIN_SESSION_MINUTES = 10;
export const MAX_SESSION_MINUTES = 180;

export const ProfileSchema = z
  .object({
    user_id: IdSchema,
    birth_year: z.int().min(1900).max(2100),
    sex: SexSchema.optional(),
    height_cm: z.number().min(100).max(250).optional(),
    weight_kg: z.number().min(25).max(350).optional(),
    experience_level: ExperienceLevelSchema,
    /** Equipment the user has access to. `bodyweight` is always implied. */
    equipment: uniqueArray(EquipmentSchema),
    /** Body regions to protect; contraindicated exercises are filtered out. */
    limitations: uniqueArray(BodyRegionSchema),
    /** Optional free text about limitations (never sent to an LLM unredacted). */
    limitation_notes: z.string().max(500).optional(),
    days_per_week: z.int().min(1).max(7),
    /** Days the user could train. Must offer at least `days_per_week` days. */
    available_days: uniqueArray(WeekdaySchema).min(1),
    session_minutes: z.int().min(MIN_SESSION_MINUTES).max(MAX_SESSION_MINUTES),
    /** Implementation intention: preferred day, time and place for each session. */
    training_slots: z.array(TrainingSlotSchema).max(7),
    parq: ParqAnswersSchema,
    consent_health_at: IsoDateTimeSchema,
  })
  .superRefine((profile, ctx) => {
    if (profile.available_days.length < profile.days_per_week) {
      ctx.addIssue({
        code: 'custom',
        path: ['available_days'],
        message: `available_days must contain at least days_per_week (${profile.days_per_week}) days`,
      });
    }
    const slotDays = profile.training_slots.map((slot) => slot.day);
    if (!hasNoDuplicates(slotDays)) {
      ctx.addIssue({
        code: 'custom',
        path: ['training_slots'],
        message: 'training_slots must have at most one slot per day',
      });
    }
    profile.training_slots.forEach((slot, index) => {
      if (!profile.available_days.includes(slot.day)) {
        ctx.addIssue({
          code: 'custom',
          path: ['training_slots', index, 'day'],
          message: `Slot day "${slot.day}" is not in available_days`,
        });
      }
    });
  });
export type Profile = z.infer<typeof ProfileSchema>;
