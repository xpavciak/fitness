/**
 * QA batch 2 (T4): realistic onboarding profiles through `generatePlan`.
 * `it.fails` marks a confirmed BUG; flip it to `it` once fixed.
 */
import { describe, expect, it } from 'vitest';
import { makeGoal as goalFor, lookup, makeProfile, NOW, TODAY } from '../__fixtures__/engine.js';
import { EXERCISE_CATALOG } from '../catalog/index.js';
import { isExerciseAvailable } from '../equipment.js';
import { createSeededIdGenerator } from '../ids.js';
import {
  PARQ_QUESTIONS,
  createCatalogValidators,
  type Equipment,
  type ExperienceLevel,
  type Plan,
  type Profile,
} from '../schemas/index.js';
import { generatePlan } from './generate.js';
import { consecutiveMuscleConflicts, validatePlanRules } from './rules.js';

const validators = createCatalogValidators(EXERCISE_CATALOG);
const GYM: Equipment[] = [
  'dumbbells',
  'kettlebell',
  'barbell',
  'bench',
  'rack',
  'pullup_bar',
  'cable',
  'machine',
  'bands',
];

function generate(profile: Profile, today = TODAY) {
  return generatePlan(profile, goalFor('general'), {
    today,
    now: NOW,
    newId: createSeededIdGenerator(1),
  });
}

function plan(profile: Profile): Plan {
  const result = generate(profile);
  if (!result.ok) {
    throw new Error(`blocked: ${result.reason}`);
  }
  return result.plan;
}

const PROFILES: [
  string,
  {
    equipment: Equipment[];
    experience_level: ExperienceLevel;
    limitations: Profile['limitations'];
  },
][] = [
  ['beginner, home, bodyweight', { equipment: [], experience_level: 'beginner', limitations: [] }],
  [
    'beginner, dumbbells + pull-up bar',
    { equipment: ['dumbbells', 'pullup_bar'], experience_level: 'beginner', limitations: [] },
  ],
  [
    'intermediate, full gym, knee + lower back',
    { equipment: GYM, experience_level: 'intermediate', limitations: ['knee', 'lower_back'] },
  ],
];

describe('QA batch 2: generatePlan over realistic profiles', () => {
  for (const [label, base] of PROFILES) {
    for (const days of [2, 3, 4, 5]) {
      it(`${label}, ${days} days, 30/45/60/90 min`, () => {
        for (const minutes of [30, 45, 60, 90]) {
          const profile = makeProfile({
            ...base,
            days_per_week: days,
            session_minutes: minutes,
            training_slots: [],
          });
          const p = plan(profile);
          expect(validators.Plan.safeParse(p).success).toBe(true);
          expect(validatePlanRules(p, profile, lookup)).toEqual([]);
          expect(p.weeks.map((w) => w.phase)[5]).toBe('deload');
          expect(p.weeks.slice(0, 5).every((w) => w.phase !== 'deload')).toBe(true);
          for (const week of p.weeks) {
            expect(consecutiveMuscleConflicts(week.sessions, lookup)).toEqual([]);
            for (const session of week.sessions) {
              // D9: never longer than +10%; shorter is allowed when caps bind and in the deload.
              expect(session.est_minutes).toBeLessThanOrEqual(minutes * 1.1);
              for (const pe of session.exercises) {
                const exercise = lookup(pe.exercise_id);
                expect(
                  exercise.contraindication_tags.some((t) => profile.limitations.includes(t)),
                ).toBe(false);
                expect(isExerciseAvailable(exercise, profile.equipment)).toBe(true);
              }
            }
          }
          expect(JSON.stringify(plan(profile))).toBe(JSON.stringify(p));
        }
      });
    }
  }

  it('blocks on every single PAR-Q+ "yes" and on a possibly-under-18 user', () => {
    for (const key of Object.keys(PARQ_QUESTIONS) as (keyof typeof PARQ_QUESTIONS)[]) {
      const base = makeProfile();
      const result = generate({ ...base, parq: { ...base.parq, [key]: true } });
      expect(result).toMatchObject({ ok: false, reason: 'parq_red_flag', redFlags: [key] });
    }
    expect(generate(makeProfile({ birth_year: 2010 }))).toMatchObject({
      ok: false,
      reason: 'under_18',
    });
    expect(generate(makeProfile({ birth_year: 2008 }))).toMatchObject({
      ok: false,
      reason: 'under_18',
    });
    expect(generate(makeProfile({ birth_year: 2007 })).ok).toBe(true);
    expect(generate(makeProfile({ birth_year: 2008 }), '2027-01-01').ok).toBe(true);
  });

  // Fixed (QA bug 9, D10): session orders are permuted on the chosen days, so a conflict-free
  // order is found when one exists.
  it('a conflict-free day order is chosen when one exists (Mon/Wed/Fri/Sat, bodyweight)', () => {
    const profile = makeProfile({
      equipment: [],
      days_per_week: 4,
      available_days: ['mon', 'wed', 'fri', 'sat'],
      training_slots: [],
    });
    const week = plan(profile).weeks[0];
    expect(consecutiveMuscleConflicts(week?.sessions ?? [], lookup)).toEqual([]);
  });
});
