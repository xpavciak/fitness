import { describe, expect, it } from 'vitest';
import { lookup, makeProfile, must, planFor } from '../__fixtures__/engine.js';
import type { Plan } from '../schemas/index.js';
import { estimateSessionMinutes } from './session-time.js';
import { validatePlanRules, weeklySetsByMuscle } from './rules.js';

/** Full Body 3x on Mon/Wed/Fri, beginner, dumbbells + bench, 45 min. */
const profile = makeProfile();
const base = planFor(profile);
const messages = (plan: Plan, p = profile) =>
  validatePlanRules(plan, p, lookup).map((issue) => issue.message);

describe('validatePlanRules', () => {
  it('accepts the generated plan', () => {
    expect(messages(base)).toEqual([]);
  });

  it('flags an exercise more than one level above the user (S9)', () => {
    const plan = structuredClone(base);
    const pe = must(must(must(plan.weeks[0]).sessions[0]).exercises[1]);
    pe.exercise_id = 'renegade_row'; // advanced
    expect(messages(plan, { ...profile, limitations: [] })).toContain(
      'renegade_row (advanced) is too advanced for a beginner',
    );
  });

  it('flags same-muscle sessions on consecutive days, also across weeks (D10)', () => {
    const plan = structuredClone(base);
    const wednesday = must(must(plan.weeks[0]).sessions[1]);
    wednesday.scheduled_date = '2026-10-13'; // Tuesday, next to Monday's full-body session
    expect(messages(plan).some((m) => m.includes('on consecutive days'))).toBe(true);
    const crossWeek = structuredClone(base);
    must(must(crossWeek.weeks[0]).sessions[2]).scheduled_date = '2026-10-18'; // Sun -> Mon
    expect(messages(crossWeek).some((m) => m.includes('on consecutive days'))).toBe(true);
  });

  it('ignores skipped and merged sessions for the volume cap and conflicts (nit)', () => {
    const plan = structuredClone(base);
    const monday = must(must(plan.weeks[0]).sessions[0]);
    for (const pe of monday.exercises) {
      pe.sets = 10;
    }
    monday.est_minutes = estimateSessionMinutes(monday.exercises, 'full', lookup);
    expect(messages(plan).some((m) => m.includes('above the weekly cap'))).toBe(true);
    monday.status = 'skipped';
    expect(messages(plan).filter((m) => m.includes('above the weekly cap'))).toEqual([]);
    expect(weeklySetsByMuscle(must(plan.weeks[0]).sessions, lookup).get('chest')).toBeLessThan(10);
  });

  it('only bounds duration from above (D9)', () => {
    const shorter = { ...profile, session_minutes: 90 };
    expect(messages(base, shorter).filter((m) => m.includes('exceeds'))).toEqual([]);
    const longer = { ...profile, session_minutes: 30 };
    expect(messages(base, longer).some((m) => m.includes('exceeds 30 + 10%'))).toBe(true);
  });
});
