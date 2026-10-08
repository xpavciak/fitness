import { z } from 'zod';
import { IdSchema, IsoDateSchema, IsoDateTimeSchema } from './common.js';

export const SCHEDULE_CHANGE_KINDS = ['move', 'merge', 'shorten', 'skip'] as const;
export const ScheduleChangeKindSchema = z.enum(SCHEDULE_CHANGE_KINDS);
export type ScheduleChangeKind = z.infer<typeof ScheduleChangeKindSchema>;

export const CHANGE_AUTHORS = ['user', 'system'] as const;
export const ChangeAuthorSchema = z.enum(CHANGE_AUTHORS);
export type ChangeAuthor = z.infer<typeof ChangeAuthorSchema>;

/**
 * An auditable change to a planned session (plans are never overwritten).
 * - move:    `to_date` required.
 * - merge:   `merged_into_session_id` required (the session absorbing this one).
 * - shorten: `new_est_minutes` required.
 * - skip:    no target fields.
 */
export const ScheduleChangeSchema = z
  .object({
    id: IdSchema,
    plan_id: IdSchema,
    planned_session_id: IdSchema,
    kind: ScheduleChangeKindSchema,
    /** Plain-language explanation shown to the user. */
    reason: z.string().trim().min(1).max(500),
    from_date: IsoDateSchema,
    to_date: IsoDateSchema.optional(),
    merged_into_session_id: IdSchema.optional(),
    new_est_minutes: z.int().min(1).max(240).optional(),
    created_by: ChangeAuthorSchema,
    created_at: IsoDateTimeSchema,
  })
  .superRefine((change, ctx) => {
    const require = (field: 'to_date' | 'merged_into_session_id' | 'new_est_minutes') => {
      if (change[field] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required for a "${change.kind}" change`,
        });
      }
    };
    switch (change.kind) {
      case 'move':
        require('to_date');
        if (change.to_date !== undefined && change.to_date === change.from_date) {
          ctx.addIssue({
            code: 'custom',
            path: ['to_date'],
            message: 'A move must change the date',
          });
        }
        break;
      case 'merge':
        require('merged_into_session_id');
        if (change.merged_into_session_id === change.planned_session_id) {
          ctx.addIssue({
            code: 'custom',
            path: ['merged_into_session_id'],
            message: 'A session cannot be merged into itself',
          });
        }
        break;
      case 'shorten':
        require('new_est_minutes');
        break;
      case 'skip':
        break;
    }
  });
export type ScheduleChange = z.infer<typeof ScheduleChangeSchema>;
