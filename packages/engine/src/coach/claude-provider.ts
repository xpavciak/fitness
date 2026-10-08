import { z } from 'zod';
import { weeklyStreak, type AdherenceStats } from '../adherence/adherence.js';
import { EXERCISE_CATALOG } from '../catalog/index.js';
import { createCatalogLookup } from '../catalog/lookup.js';
import { weekdayIndex } from '../dates.js';
import type { Exercise, Plan, Profile } from '../schemas/index.js';
import { TemplateCoachProvider, weekStats, type CoachTextProvider } from './template-provider.js';

/** Model used for coach texts (D5). The server-side proxy may override it. */
export const CLAUDE_COACH_MODEL = 'claude-sonnet-5-5';
export const COACH_MAX_TOKENS = 400;
export const COACH_TIMEOUT_MS = 10_000;
/** Longest coach text accepted from the proxy (characters). */
export const COACH_MAX_TEXT_LENGTH = 2000;

/**
 * Minimal `fetch` shape the provider needs. The package builds without DOM or Node types, so
 * the real `fetch` (browser, React Native, Node 18+) is passed in by the app.
 */
export type CoachFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal?: unknown;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface ClaudeCoachOptions {
  fetch: CoachFetch;
  /**
   * URL of the app's server-side proxy (e.g. a Supabase Edge Function) that holds the Anthropic
   * API key and forwards the request. Must be https (or a same-origin path starting with `/`).
   * Calling the Anthropic API directly from the client is rejected: it would need the key.
   */
  endpoint: string;
  /** Used on any error, invalid response or timeout. Default: `TemplateCoachProvider`. */
  fallback?: CoachTextProvider;
  timeoutMs?: number;
  /** Resolves after `ms` milliseconds; injectable for tests. Default: `globalThis.setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  catalog?: readonly Exercise[];
  /** Called with the reason whenever the provider falls back to the template (for logging). */
  onError?: (error: Error) => void;
}

/** The JSON body sent to the proxy (Anthropic Messages API shape, without any key). */
export interface CoachRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: 'user'; content: string }[];
  /** For the proxy's logging and rate limits. */
  task: 'explain_plan' | 'weekly_reflection';
}

export const COACH_SYSTEM_PROMPT = [
  'You are a friendly, encouraging strength coach writing for the user of a training app.',
  'Write plain English in the second person, at most 120 words, no lists or headings.',
  'Explain only what the data shows; never change the plan, loads or schedule.',
  'Never blame or guilt the user; missed or skipped sessions are normal.',
  'Do not give medical advice, diagnoses, injury treatment, medication or diet advice.',
  'If health concerns come up, suggest talking to a doctor or qualified professional.',
].join(' ');

/**
 * Proxy response: either `{ text }` or the Anthropic Messages API response (`content` blocks).
 */
const CoachResponseSchema = z.union([
  z.object({ text: z.string() }),
  z.object({
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).min(1),
  }),
]);

function responseText(body: unknown): string | undefined {
  const parsed = CoachResponseSchema.safeParse(body);
  if (!parsed.success) {
    return undefined;
  }
  const text =
    'text' in parsed.data
      ? parsed.data.text
      : parsed.data.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('');
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= COACH_MAX_TEXT_LENGTH ? trimmed : undefined;
}

/**
 * Prompt data for a plan explanation. Redaction: only structured, non-identifying fields are
 * sent. Never included: user and plan ids, birth year, sex, height, weight, time zone, PAR-Q+
 * answers, consent, `limitation_notes`, training-slot locations and any other free text.
 * Limitations are sent as body-region tags only (so the text can say which areas are protected).
 */
export function buildExplainPlanPrompt(
  plan: Plan,
  profile: Profile,
  catalog: readonly Exercise[] = EXERCISE_CATALOG,
): CoachRequest {
  const lookup = createCatalogLookup(catalog);
  const data = {
    experience_level: profile.experience_level,
    days_per_week: profile.days_per_week,
    session_minutes: profile.session_minutes,
    equipment: profile.equipment,
    protected_body_areas: profile.limitations,
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
  };
  return {
    model: CLAUDE_COACH_MODEL,
    max_tokens: COACH_MAX_TOKENS,
    system: COACH_SYSTEM_PROMPT,
    task: 'explain_plan',
    messages: [
      {
        role: 'user',
        content: `Explain this training plan to the user: why it is built this way, what to focus on, and how progress works. Plan data (JSON): ${JSON.stringify(data)}`,
      },
    ],
  };
}

/** Prompt data for a weekly reflection; same redaction rules as `buildExplainPlanPrompt`. */
export function buildWeeklyReflectionPrompt(
  stats: AdherenceStats,
  weekIndex: number,
  profile: Profile,
): CoachRequest {
  const week = weekStats(stats, weekIndex);
  const streak = weeklyStreak(stats);
  const data = {
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
  };
  return {
    model: CLAUDE_COACH_MODEL,
    max_tokens: COACH_MAX_TOKENS,
    system: COACH_SYSTEM_PROMPT,
    task: 'weekly_reflection',
    messages: [
      {
        role: 'user',
        content: `Write a short weekly reflection with one practical suggestion for next week. Skipped sessions are neutral. Week data (JSON): ${JSON.stringify(data)}`,
      },
    ],
  };
}

const defaultSleep = (ms: number): Promise<void> => {
  const timer = (globalThis as { setTimeout?: (callback: () => void, ms: number) => unknown })
    .setTimeout;
  return new Promise((resolve) => {
    if (timer) {
      timer(resolve, ms);
    }
    // Without a timer the request simply has no timeout.
  });
};

/** Validates the proxy endpoint: https or a same-origin path, never the Anthropic API itself. */
export function assertProxyEndpoint(endpoint: string): void {
  if (endpoint.startsWith('/') && !endpoint.startsWith('//')) {
    return;
  }
  const match = /^https:\/\/([^/?#]+)/i.exec(endpoint);
  if (!match?.[1]) {
    throw new Error('The coach endpoint must be an https URL or a same-origin path');
  }
  if (match[1].toLowerCase().endsWith('anthropic.com')) {
    throw new Error(
      'Call the Anthropic API through your server-side proxy, never from the client (the API key must stay on the server)',
    );
  }
}

/**
 * Coach texts from Claude via the app's server-side proxy (D5). The client never holds an API
 * key: it posts a redacted `CoachRequest` to `endpoint`, and the proxy adds the key and calls the
 * Messages API. Any failure (network error, non-2xx status, invalid or empty response, timeout)
 * falls back to the deterministic template text, so the app always gets a message.
 */
export function createClaudeCoachProvider(options: ClaudeCoachOptions): CoachTextProvider {
  assertProxyEndpoint(options.endpoint);
  const catalog = options.catalog ?? EXERCISE_CATALOG;
  const fallback = options.fallback ?? new TemplateCoachProvider(catalog);
  const timeoutMs = options.timeoutMs ?? COACH_TIMEOUT_MS;
  const sleep = options.sleep ?? defaultSleep;

  /** Reports why the template is used; returns no text so callers can `return fail(...)`. */
  const fail = (error: Error): string | undefined => {
    options.onError?.(error);
    return undefined;
  };

  const request = async (body: CoachRequest): Promise<string | undefined> => {
    const AbortControllerCtor = (
      globalThis as { AbortController?: new () => { signal: unknown; abort(): void } }
    ).AbortController;
    const controller = AbortControllerCtor ? new AbortControllerCtor() : undefined;
    let settled = false;
    // The catch is attached here so a late rejection (e.g. after the timeout aborted the
    // request) is never unhandled. Every failure is reported and leads to the template text.
    const call = (async () => {
      const response = await options.fetch(options.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response.ok) {
        return fail(new Error(`Coach proxy returned HTTP ${response.status}`));
      }
      const text = responseText(await response.json());
      return text ?? fail(new Error('Coach proxy returned an invalid or empty text'));
    })().catch((error: unknown) =>
      settled ? undefined : fail(error instanceof Error ? error : new Error(String(error))),
    );
    const timeout = sleep(timeoutMs).then(() => {
      if (settled) {
        return undefined;
      }
      controller?.abort();
      return fail(new Error(`Coach proxy timed out after ${timeoutMs} ms`));
    });
    const text = await Promise.race([call, timeout]);
    settled = true;
    return text;
  };

  return {
    async explainPlan(plan, profile) {
      const text = await request(buildExplainPlanPrompt(plan, profile, catalog));
      return text ?? fallback.explainPlan(plan, profile);
    },
    async weeklyReflection(stats, weekIndex, profile) {
      const text = await request(buildWeeklyReflectionPrompt(stats, weekIndex, profile));
      return text ?? fallback.weeklyReflection(stats, weekIndex, profile);
    },
  };
}
