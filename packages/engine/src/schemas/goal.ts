import { z } from 'zod';
import { IdSchema, IsoDateSchema, IsoDateTimeSchema } from './common.js';

export const GOAL_TYPES = [
  'strength',
  'hypertrophy',
  'fat_loss',
  'general',
  'endurance',
  'hybrid',
] as const;
export const GoalTypeSchema = z.enum(GOAL_TYPES);
export type GoalType = z.infer<typeof GoalTypeSchema>;

export const GOAL_STATUSES = ['active', 'achieved', 'abandoned'] as const;
export const GoalStatusSchema = z.enum(GOAL_STATUSES);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

export const GoalSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  type: GoalTypeSchema,
  /** Optional free-text target, e.g. "10 push-ups in a row". */
  target: z.string().trim().min(1).max(200).optional(),
  deadline: IsoDateSchema.optional(),
  status: GoalStatusSchema,
  created_at: IsoDateTimeSchema,
});
export type Goal = z.infer<typeof GoalSchema>;
