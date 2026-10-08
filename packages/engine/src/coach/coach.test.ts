import { describe, expect, it, vi } from 'vitest';
import { makeProfile, must, planFor } from '../__fixtures__/engine.js';
import { adherenceStats, type AdherenceStats } from '../adherence/adherence.js';
import type { Plan, Profile } from '../schemas/index.js';
import {
  CLAUDE_COACH_MODEL,
  buildExplainPlanPrompt,
  buildWeeklyReflectionPrompt,
  createClaudeCoachProvider,
  type CoachFetch,
  type CoachRequest,
} from './claude-provider.js';
import { NOT_MEDICAL_ADVICE, TemplateCoachProvider } from './template-provider.js';

const TZ = 'Europe/Bratislava';
const SECRET_NOTE = 'Had ACL surgery in 2024, still swollen';
const SECRET_PLACE = 'Gym at 12 Baker Street';

const profile: Profile = makeProfile({
  limitations: ['knee'],
  limitation_notes: SECRET_NOTE,
  training_slots: [
    { day: 'mon', start_time: '07:00', location: SECRET_PLACE },
    { day: 'wed', start_time: '07:00', location: SECRET_PLACE },
    { day: 'fri', start_time: '07:00', location: SECRET_PLACE },
  ],
});
const plan: Plan = planFor(profile);

/** Week 0 all done, week 1 one done + one missed + one skipped, today = Monday of week 2. */
function statsFor(): AdherenceStats {
  const p = structuredClone(plan);
  for (const s of must(p.weeks[0]).sessions) {
    s.status = 'done';
  }
  const [a, , c] = must(p.weeks[1]).sessions; // the middle session stays planned: missed
  must(a).status = 'done';
  must(c).status = 'skipped';
  return adherenceStats(p, [], { today: '2026-10-26', timezone: TZ, changes: [] });
}
const stats = statsFor();

function okFetch(body: unknown, status = 200) {
  return vi.fn<CoachFetch>(() =>
    Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) }),
  );
}

const neverResolves = () => new Promise<never>(() => undefined);

describe('TemplateCoachProvider', () => {
  const coach = new TemplateCoachProvider();

  it('explains the plan from its structure and rationale, with one disclaimer', async () => {
    const text = await coach.explainPlan(plan, profile);
    expect(text).toMatch(
      /^Here is your 6-week plan: 3 sessions a week on Monday, Wednesday and Friday, about 45 minutes each\./,
    );
    expect(text).toContain('The main lifts are');
    expect(text).toContain('Weeks 1-5 build up gradually');
    expect(text.split(NOT_MEDICAL_ADVICE)).toHaveLength(2);
    expect(text).not.toContain('This plan is general fitness guidance');
    expect(text).not.toContain(SECRET_NOTE);
    expect(text).not.toContain(SECRET_PLACE);
    expect(await coach.explainPlan(plan, profile)).toBe(text); // deterministic
  });

  it('celebrates a complete week and mentions the streak', async () => {
    const text = await coach.weeklyReflection(stats, 0, profile);
    expect(text).toContain('You completed all 3 planned sessions in week 1.');
  });

  it('is encouraging and guilt-free for a partial week (skips are neutral)', async () => {
    const text = await coach.weeklyReflection(stats, 1, profile);
    expect(text).toContain('You completed 1 of 2 sessions in week 2. Every session counts.');
    expect(text).toMatch(/minimum dose/);
    expect(text).not.toMatch(/fail|lazy|should have|disappoint/i);
  });

  it('handles an empty week, an all-skipped week, the current week and a future week', async () => {
    const p = structuredClone(plan);
    for (const s of must(p.weeks[0]).sessions) {
      s.status = 'skipped';
    }
    const midWeek = adherenceStats(p, [], { today: '2026-10-21', timezone: TZ, changes: [] });
    expect(await coach.weeklyReflection(midWeek, 0, profile)).toMatch(
      /^You chose to skip week 1\. Rest is part of training/,
    );
    expect(await coach.weeklyReflection(midWeek, 1, profile)).toMatch(
      /^So far in week 2: 0 of 3 sessions done, 2 still to go\. One session slipped/,
    );
    expect(await coach.weeklyReflection(midWeek, 3, profile)).toBe(
      'Week 4 has not started yet. 3 sessions are planned; pick the times that suit you and you are set.',
    );
    const nothingDone = adherenceStats(plan, [], {
      today: '2026-10-19',
      timezone: TZ,
      changes: [],
    });
    expect(await coach.weeklyReflection(nothingDone, 0, profile)).toMatch(
      /^Week 1 did not go to plan, and that is okay/,
    );
  });

  it('rejects an unknown week', async () => {
    await expect(coach.weeklyReflection(stats, 42, profile)).rejects.toThrow(RangeError);
  });
});

describe('prompt builders (redaction)', () => {
  const forbidden = [
    SECRET_NOTE,
    SECRET_PLACE,
    profile.user_id,
    plan.id,
    String(profile.birth_year),
    TZ,
  ];

  it.each([
    ['explain', () => buildExplainPlanPrompt(plan, profile)],
    ['reflection', () => buildWeeklyReflectionPrompt(stats, 1, profile)],
  ] as const)('%s prompt carries no free text or identifiers', (_name, build) => {
    const request: CoachRequest = build();
    const serialized = JSON.stringify(request);
    for (const value of forbidden) {
      expect(serialized).not.toContain(value);
    }
    expect(request.model).toBe(CLAUDE_COACH_MODEL);
    expect(request.system).toMatch(/Do not give medical advice/);
    expect(serialized).not.toMatch(/api[_-]?key|x-api-key/i);
  });

  it('keeps the structured data the text needs', () => {
    const content = must(buildExplainPlanPrompt(plan, profile).messages[0]).content;
    expect(content).toContain('"protected_body_areas":["knee"]');
    expect(content).toContain('"phase":"deload"');
    const reflection = must(buildWeeklyReflectionPrompt(stats, 1, profile).messages[0]).content;
    expect(reflection).toContain('"completed":1');
    expect(reflection).toContain('"skipped":1');
  });
});

describe('createClaudeCoachProvider', () => {
  const endpoint = 'https://example.supabase.co/functions/v1/coach';

  it('posts the redacted request to the proxy and returns its text', async () => {
    const fetch = okFetch({ text: '  Great plan for you.  ' });
    const coach = createClaudeCoachProvider({ fetch, endpoint });
    expect(await coach.explainPlan(plan, profile)).toBe('Great plan for you.');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = must(fetch.mock.calls[0]);
    expect(url).toBe(endpoint);
    expect(init.method).toBe('POST');
    expect(Object.keys(init.headers).map((h) => h.toLowerCase())).toEqual(['content-type']);
    const body = JSON.parse(init.body) as CoachRequest;
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', task: 'explain_plan' });
    expect(init.body).not.toContain(SECRET_NOTE);
  });

  it('accepts an Anthropic Messages API response forwarded as-is', async () => {
    const fetch = okFetch({ content: [{ type: 'text', text: 'Nice week!' }] });
    const coach = createClaudeCoachProvider({ fetch, endpoint });
    expect(await coach.weeklyReflection(stats, 1, profile)).toBe('Nice week!');
  });

  const template = new TemplateCoachProvider();

  it.each([
    ['an HTTP error', () => okFetch({ text: 'x' }, 500), /HTTP 500/],
    ['an invalid body', () => okFetch({ message: 'hi' }), /invalid or empty/],
    ['an empty text', () => okFetch({ text: '   ' }), /invalid or empty/],
    ['an overlong text', () => okFetch({ text: 'x'.repeat(2001) }), /invalid or empty/],
    [
      'a network error',
      () => vi.fn<CoachFetch>(() => Promise.reject(new TypeError('Network request failed'))),
      /Network request failed/,
    ],
    [
      'a JSON parse error',
      () =>
        vi.fn<CoachFetch>(() =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.reject(new SyntaxError('bad json')),
          }),
        ),
      /bad json/,
    ],
  ])('falls back to the template on %s and reports it', async (_name, makeFetch, reason) => {
    const onError = vi.fn<(error: Error) => void>();
    const coach = createClaudeCoachProvider({ fetch: makeFetch(), endpoint, onError });
    expect(await coach.explainPlan(plan, profile)).toBe(await template.explainPlan(plan, profile));
    expect(await coach.weeklyReflection(stats, 1, profile)).toBe(
      await template.weeklyReflection(stats, 1, profile),
    );
    expect(onError).toHaveBeenCalledTimes(2);
    expect(must(onError.mock.calls[0])[0].message).toMatch(reason);
  });

  it('falls back on timeout', async () => {
    const onError = vi.fn<(error: Error) => void>();
    const coach = createClaudeCoachProvider({
      fetch: vi.fn<CoachFetch>(neverResolves),
      endpoint,
      timeoutMs: 50,
      sleep: () => Promise.resolve(),
      onError,
    });
    expect(await coach.explainPlan(plan, profile)).toBe(await template.explainPlan(plan, profile));
    expect(must(onError.mock.calls[0])[0].message).toBe('Coach proxy timed out after 50 ms');
  });

  it('uses a custom fallback provider', async () => {
    const fallback = {
      explainPlan: () => Promise.resolve('fallback plan'),
      weeklyReflection: () => Promise.resolve('fallback week'),
    };
    const coach = createClaudeCoachProvider({ fetch: okFetch({}, 503), endpoint, fallback });
    expect(await coach.explainPlan(plan, profile)).toBe('fallback plan');
    expect(await coach.weeklyReflection(stats, 0, profile)).toBe('fallback week');
  });

  it.each([
    'https://api.anthropic.com/v1/messages',
    'https://API.Anthropic.com/v1/messages',
    'http://example.com/coach',
    '//evil.example/coach',
    'ftp://example.com',
  ])('rejects endpoint %s (proxy only, https, no client-side key)', (bad) => {
    expect(() => createClaudeCoachProvider({ fetch: okFetch({}), endpoint: bad })).toThrow();
  });

  it('accepts a same-origin path', () => {
    expect(() =>
      createClaudeCoachProvider({ fetch: okFetch({}), endpoint: '/api/coach' }),
    ).not.toThrow();
  });
});
