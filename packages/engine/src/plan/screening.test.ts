import { describe, expect, it } from 'vitest';
import { makeGoal, makeProfile, NOW, TODAY } from '../__fixtures__/engine.js';
import { createSeededIdGenerator } from '../ids.js';
import { PARQ_QUESTIONS, type ParqQuestionKey } from '../schemas/index.js';
import { generatePlan } from './generate.js';
import { PARQ_BLOCK_MESSAGE, screenProfile, UNDER_18_MESSAGE } from './screening.js';

const parqKeys = Object.keys(PARQ_QUESTIONS) as ParqQuestionKey[];

describe('screenProfile', () => {
  it('passes an adult with no PAR-Q+ red flags', () => {
    expect(screenProfile(makeProfile(), TODAY)).toEqual({ ok: true });
  });

  it.each(parqKeys)('blocks when "%s" is answered yes', (key) => {
    const profile = makeProfile();
    profile.parq[key] = true;
    const result = screenProfile(profile, TODAY);
    expect(result).toEqual({
      ok: false,
      reason: 'parq_red_flag',
      message: PARQ_BLOCK_MESSAGE,
      redFlags: [key],
    });
  });

  it('lists every red flag', () => {
    const profile = makeProfile();
    profile.parq.chest_pain = true;
    profile.parq.other_chronic_condition = true;
    const result = screenProfile(profile, TODAY);
    expect(result.ok ? [] : result.redFlags).toEqual(['chest_pain', 'other_chronic_condition']);
  });

  it('uses a plain-English "consult a doctor or qualified professional" message', () => {
    for (const message of [PARQ_BLOCK_MESSAGE, UNDER_18_MESSAGE]) {
      expect(message).toMatch(/consult a doctor or a qualified/);
      expect(message).toMatch(/before starting/);
    }
  });

  it.each([
    // [birth_year, today, ok] — ageOn is an upper bound, so the gate needs ageOn - 1 >= 18.
    [2010, '2026-10-08', false],
    [2008, '2026-12-31', false], // may still be 17 on Dec 31 (birthday unknown)
    [2008, '2027-01-01', true],
    [2007, '2026-01-01', true],
    [1950, '2026-10-08', true],
  ] as const)('age gate: born %i, today %s -> ok %s', (birthYear, today, ok) => {
    const result = screenProfile(makeProfile({ birth_year: birthYear }), today);
    expect(result.ok).toBe(ok);
    if (!result.ok) {
      expect(result.reason).toBe('under_18');
      expect(result.message).toBe(UNDER_18_MESSAGE);
    }
  });

  it('checks PAR-Q+ before age', () => {
    const profile = makeProfile({ birth_year: 2015 });
    profile.parq.chest_pain = true;
    const result = screenProfile(profile, TODAY);
    expect(result.ok ? undefined : result.reason).toBe('parq_red_flag');
  });
});

describe('generatePlan screening gate', () => {
  it('returns the blocked result instead of a plan on a red flag', () => {
    const profile = makeProfile();
    profile.parq.dizziness_or_loss_of_consciousness = true;
    const result = generatePlan(profile, makeGoal(), {
      today: TODAY,
      now: NOW,
      newId: createSeededIdGenerator(1),
    });
    expect(result).toEqual({
      ok: false,
      reason: 'parq_red_flag',
      message: PARQ_BLOCK_MESSAGE,
      redFlags: ['dizziness_or_loss_of_consciousness'],
    });
    expect('plan' in result).toBe(false);
  });

  it('refuses a minor', () => {
    const result = generatePlan(makeProfile({ birth_year: 2012 }), makeGoal(), {
      today: TODAY,
      now: NOW,
      newId: createSeededIdGenerator(1),
    });
    expect(result.ok ? undefined : result.reason).toBe('under_18');
  });

  it('does not consume ids when blocked', () => {
    const profile = makeProfile();
    profile.parq.chest_pain = true;
    let calls = 0;
    generatePlan(profile, makeGoal(), {
      today: TODAY,
      now: NOW,
      newId: () => {
        calls += 1;
        return '00000000-0000-4000-8000-000000000001';
      },
    });
    expect(calls).toBe(0);
  });
});
