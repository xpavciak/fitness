import { z } from 'zod';
import { IdSchema, IsoDateSchema, IsoDateTimeSchema } from './common.js';

/**
 * Goal types the MVP engine can serve. Endurance and hybrid (running) goals are out of
 * MVP scope (decision D7) and will be added with the running module.
 */
export const GOAL_TYPES = ['strength', 'hypertrophy', 'fat_loss', 'general'] as const;
export const GoalTypeSchema = z.enum(GOAL_TYPES);
export type GoalType = z.infer<typeof GoalTypeSchema>;

export const GOAL_STATUSES = ['active', 'achieved', 'abandoned'] as const;
export const GoalStatusSchema = z.enum(GOAL_STATUSES);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

/** Goals have no cross-field rules, so the row schema is also the full schema. */
export const GoalRowSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  type: GoalTypeSchema,
  /** Optional free-text target, e.g. "10 push-ups in a row". */
  target: z.string().trim().min(1).max(200).optional(),
  deadline: IsoDateSchema.optional(),
  status: GoalStatusSchema,
  created_at: IsoDateTimeSchema,
});
export const GoalSchema = GoalRowSchema;
export type Goal = z.infer<typeof GoalSchema>;
