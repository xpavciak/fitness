import { z } from 'zod';
import { weeklyStreak, type AdherenceStats } from '../adherence/adherence.js';
import { EXERCISE_CATALOG } from '../catalog/index.js';
import { createCatalogLookup } from '../catalog/lookup.js';
import { weekdayIndex } from '../dates.js';
import {
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  PLAN_PHASES,
  type Exercise,
  type Plan,
  type Profile,
} from '../schemas/index.js';
import { weekStats } from './template-provider.js';

/*
 * Coach proxy contract (D5). Pure and dependency-free apart from zod, so a server-side proxy
 * (e.g. a Supabase Edge Function) can import it.
 *
 * Client -> proxy: `CoachRequest` = `{ task, data }` only. The client never sends a model, a
 * system prompt, token limits or free text, and never holds an API key.
 *
 * Proxy requirements:
 * - Authenticate every call with the user's Supabase JWT (`Authorization: Bearer <access token>`,
 *   supplied by the client through the provider's `headers` option); reject anonymous calls.
 * - Validate the body with `CoachRequestSchema` (strict: unknown fields are rejected).
 * - Rate-limit per user (e.g. a few explanations and reflections per day) and log usage.
 * - Build the Anthropic request server-side with `buildMessagesRequest`: fixed model
 *   (`CLAUDE_COACH_MODEL`), fixed `max_tokens` and system prompt. Never accept them from the client.
 * - Keep the Anthropic API key in server secrets; respond with `{ text }`.
 */

/** Fixed model for coach texts (D5); set by the proxy, never by the client. */
export const CLAUDE_COACH_MODEL = 'claude-sonnet-5-5';
export const COACH_MAX_TOKENS = 400;

export const COACH_SYSTEM_PROMPT = [
  'You are a friendly, encouraging strength coach writing for the user of a training app.',
  'Write plain English in the second person, at most 120 words, no lists or headings.',
  'Explain only what the data shows; never change the plan, loads or schedule.',
  'Never blame or guilt the user; missed or skipped sessions are normal.',
  'Do not give medical advice, diagnoses, injury treatment, medication or diet advice.',
  'If health concerns come up, suggest talking to a doctor or qualified professional.',
].join(' ');

const count = z.int().min(0).max(100);

/**
 * Redacted plan data. Only structured, non-identifying training fields: no ids, birth year, sex,
 * height, weight, time zone, PAR-Q+ answers, consent, limitations (health data, GDPR Art. 9),
 * `limitation_notes`, training-slot locations or other free text. Exercise names come from the
 * catalog.
 */
export const ExplainPlanDataSchema = z.strictObject({
  experience_level: z.enum(EXPERIENCE_LEVELS),
  days_per_week: z.int().min(1).max(7),
  session_minutes: z.int().min(1).max(240),
  equipment: z.array(z.enum(EQUIPMENT)).max(EQUIPMENT.length),
  template: z.string().max(64),
  weeks: z
    .array(
      z.strictObject({
        week: z.int().min(1).max(16),
        phase: z.enum(PLAN_PHASES),
        sessions: z
          .array(
            z.strictObject({
              weekday: z.int().min(0).max(6),
              title: z.string().max(80),
              minutes: z.int().min(1).max(240),
              exercises: z
                .array(
                  z.strictObject({
                    name: z.string().max(80),
                    sets: z.int().min(1).max(10),
                    range: z.string().max(32),
                    reps_in_reserve: z.int().min(0).max(5),
                    key: z.boolean(),
                  }),
                )
                .max(20),
            }),
          )
          .max(7),
      }),
    )
    .max(16),
});
export type ExplainPlanData = z.infer<typeof ExplainPlanDataSchema>;

/** Redacted weekly reflection data (counts only). */
export const WeeklyReflectionDataSchema = z.strictObject({
  experience_level: z.enum(EXPERIENCE_LEVELS),
  week: z.int().min(1).max(16),
  week_status: z.enum(['past', 'current', 'future']),
  planned: count,
  completed: count,
  missed: count,
  skipped: count,
  still_to_do: count,
  extra_workouts: count,
  current_streak_weeks: count,
  best_streak_weeks: count,
  overall_adherence_percent: z.int().min(0).max(100).nullable(),
});
export type WeeklyReflectionData = z.infer<typeof WeeklyReflectionDataSchema>;

/** The only body the client sends to the proxy. */
export const CoachRequestSchema = z.discriminatedUnion('task', [
  z.strictObject({ task: z.literal('explain_plan'), data: ExplainPlanDataSchema }),
  z.strictObject({ task: z.literal('weekly_reflection'), data: WeeklyReflectionDataSchema }),
]);
export type CoachRequest = z.infer<typeof CoachRequestSchema>;

export function buildExplainPlanRequest(
  plan: Plan,
  profile: Profile,
  catalog: readonly Exercise[] = EXERCISE_CATALOG,
): CoachRequest {
  const lookup = createCatalogLookup(catalog);
  return CoachRequestSchema.parse({
    task: 'explain_plan',
    data: {
      experience_level: profile.experience_level,
      days_per_week: profile.days_per_week,
      session_minutes: profile.session_minutes,
      equipment: profile.equipment,
      template: plan.template_id ?? 'custom',
      weeks: plan.weeks.map((week) => ({
        week: week.index + 1,
        phase: week.phase,
        sessions: week.sessions.map((session) => ({
          weekday: weekdayIndex(session.scheduled_date),
          title: session.title,
          minutes: session.est_minutes,
          exercises: session.exercises.map((pe) => ({
            name: lookup(pe.exercise_id).name,
            sets: pe.sets,
            range: `${pe.rep_min}-${pe.rep_max} ${pe.measure}`,
            reps_in_reserve: pe.target_rir,
            key: pe.is_key,
          })),
        })),
      })),
    },
  });
}

export function buildWeeklyReflectionRequest(
  stats: AdherenceStats,
  weekIndex: number,
  profile: Profile,
): CoachRequest {
  const week = weekStats(stats, weekIndex);
  const streak = weeklyStreak(stats);
  return CoachRequestSchema.parse({
    task: 'weekly_reflection',
    data: {
      experience_level: profile.experience_level,
      week: weekIndex + 1,
      week_status: week.status,
      planned: week.planned,
      completed: week.completed,
      missed: week.missed,
      skipped: week.skipped,
      still_to_do: week.upcoming,
      extra_workouts: week.unplanned_workouts,
      current_streak_weeks: streak.current,
      best_streak_weeks: streak.best,
      overall_adherence_percent: stats.overall.percentage,
    },
  });
}

/** Anthropic Messages API request body (without the key, which the proxy adds as a header). */
export interface MessagesRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: 'user'; content: string }[];
}

/**
 * Server side: turns a validated client request into the Messages API body with the fixed model,
 * token limit and system prompt. Throws on an invalid request.
 */
export function buildMessagesRequest(input: unknown): MessagesRequest {
  const request = CoachRequestSchema.parse(input);
  const instruction =
    request.task === 'explain_plan'
      ? 'Explain this training plan to the user: why it is built this way, what to focus on, and how progress works. Plan data (JSON):'
      : 'Write a short weekly reflection with one practical suggestion for next week. Skipped sessions are neutral. Week data (JSON):';
  return {
    model: CLAUDE_COACH_MODEL,
    max_tokens: COACH_MAX_TOKENS,
    system: COACH_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `${instruction} ${JSON.stringify(request.data)}` }],
  };
}
