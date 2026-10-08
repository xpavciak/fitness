import { z } from 'zod';
import { EXERCISE_CATALOG } from '../catalog/index.js';
import type { Exercise } from '../schemas/index.js';
import {
  buildExplainPlanRequest,
  buildWeeklyReflectionRequest,
  type CoachRequest,
} from './proxy-contract.js';
import {
  NOT_MEDICAL_ADVICE,
  TemplateCoachProvider,
  type CoachText,
  type CoachTextProvider,
} from './template-provider.js';

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

/** Starts a timer and returns a function that cancels it. */
export type CoachTimer = (callback: () => void, ms: number) => () => void;

export interface ClaudeCoachOptions {
  fetch: CoachFetch;
  /**
   * URL of the app's server-side proxy (e.g. a Supabase Edge Function) that holds the Anthropic
   * API key; see `proxy-contract.ts` for its requirements. Must be https (or a same-origin path
   * starting with `/`). The Anthropic API itself is rejected: calling it would need the key.
   */
  endpoint: string;
  /**
   * Extra request headers, resolved per call; typically
   * `{ Authorization: 'Bearer <Supabase access token>' }`.
   */
  headers?: () => Promise<Record<string, string>>;
  /** Used on any error, invalid response or timeout. Default: `TemplateCoachProvider`. */
  fallback?: CoachTextProvider;
  timeoutMs?: number;
  /** Injectable for tests. Default: `globalThis.setTimeout` / `clearTimeout`. */
  timer?: CoachTimer;
  catalog?: readonly Exercise[];
  /** Called with the reason whenever the provider falls back to the template (for logging). */
  onError?: (error: Error) => void;
}

/** Proxy response: `{ text }`, or an Anthropic Messages API response forwarded as-is. */
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

/** AI text always ends with the disclaimer (added once). */
function withDisclaimer(text: string): string {
  return text.endsWith(NOT_MEDICAL_ADVICE) ? text : `${text} ${NOT_MEDICAL_ADVICE}`;
}

const defaultTimer: CoachTimer = (callback, ms) => {
  const g = globalThis as {
    setTimeout?: (callback: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
  };
  if (!g.setTimeout) {
    return () => undefined; // no timer available: the request simply has no timeout
  }
  const handle = g.setTimeout(callback, ms);
  return () => g.clearTimeout?.(handle);
};

/** Hostname of an https URL (lowercase, without port, credentials or trailing dot). */
function httpsHostname(url: string): string | undefined {
  const match = /^https:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]+)(?::\d*)?(?:[/?#]|$)/i.exec(url);
  return match?.[1]?.toLowerCase().replace(/\.+$/, '');
}

/** Validates the proxy endpoint: https or a same-origin path, never the Anthropic API itself. */
export function assertProxyEndpoint(endpoint: string): void {
  if (endpoint.startsWith('/') && !endpoint.startsWith('//')) {
    return;
  }
  const host = httpsHostname(endpoint);
  if (!host) {
    throw new Error('The coach endpoint must be an https URL or a same-origin path');
  }
  if (host === 'anthropic.com' || host.endsWith('.anthropic.com')) {
    throw new Error(
      'Call the Anthropic API through your server-side proxy, never from the client (the API key must stay on the server)',
    );
  }
}

/**
 * Coach texts from Claude via the app's server-side proxy (D5). The client posts only the
 * redacted `CoachRequest` (`{ task, data }`, see `proxy-contract.ts`); the proxy authenticates the
 * user, applies rate limits and builds the Messages API request with the fixed model. AI texts
 * come back as `{ text, source: 'ai' }` with `NOT_MEDICAL_ADVICE` appended. Any failure (headers,
 * network error, non-2xx status, invalid or empty response, timeout) falls back to the template
 * provider (`source: 'template'`) and is reported through `onError`.
 */
export function createClaudeCoachProvider(options: ClaudeCoachOptions): CoachTextProvider {
  assertProxyEndpoint(options.endpoint);
  const catalog = options.catalog ?? EXERCISE_CATALOG;
  const fallback = options.fallback ?? new TemplateCoachProvider(catalog);
  const timeoutMs = options.timeoutMs ?? COACH_TIMEOUT_MS;
  const timer = options.timer ?? defaultTimer;

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
      const extra = options.headers ? await options.headers() : {};
      const response = await options.fetch(options.endpoint, {
        method: 'POST',
        headers: { ...extra, 'content-type': 'application/json' },
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
    let cancelTimer: () => void = () => undefined;
    const timeout = new Promise<string | undefined>((resolve) => {
      cancelTimer = timer(() => {
        if (!settled) {
          controller?.abort();
          resolve(fail(new Error(`Coach proxy timed out after ${timeoutMs} ms`)));
        }
      }, timeoutMs);
    });
    try {
      return await Promise.race([call, timeout]);
    } finally {
      settled = true;
      cancelTimer();
    }
  };

  const ai = (text: string): CoachText => ({ text: withDisclaimer(text), source: 'ai' });

  return {
    async explainPlan(plan, profile) {
      const text = await request(buildExplainPlanRequest(plan, profile, catalog));
      return text === undefined ? fallback.explainPlan(plan, profile) : ai(text);
    },
    async weeklyReflection(stats, weekIndex, profile) {
      const text = await request(buildWeeklyReflectionRequest(stats, weekIndex, profile));
      return text === undefined ? fallback.weeklyReflection(stats, weekIndex, profile) : ai(text);
    },
  };
}
