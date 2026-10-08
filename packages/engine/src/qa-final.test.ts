/**
 * QA final (T11): spot checks of features A-D through the public API, focused on regressions after
 * the fix rounds (D9 duration, D10 consecutive days, D11 skip neutrality and required inputs,
 * beginner RIR hold, low-stimulus never key). Scenario: the QA persona (beginner, dumbbells, knee
 * limitation, 3 x 45 min).
 */
import { describe, expect, it } from 'vitest';
import { makeGoal, makeProfile, must, NOW, TODAY } from './__fixtures__/engine.js';
import { uuid } from './__fixtures__/samples.js';
import {
  addDays,
  adherenceStats,
  applyScheduleChanges,
  createCatalogLookup,
  createSeededIdGenerator,
  EXERCISE_CATALOG,
  generatePlan,
  MINIMUM_DOSE_MINUTES,
  minimumDoseSession,
  nextTargets,
  personalRecords,
  proposeReschedules,
  validatePlanRules,
  weeklyStreak,
  type Plan,
  type PlannedExercise,
  type Profile,
  type SetLog,
  type WorkoutLog,
} from './index.js';

const lookup = createCatalogLookup(EXERCISE_CATALOG);
const TZ = 'Europe/Bratislava';

const persona: Profile = makeProfile({
  experience_level: 'beginner',
  equipment: ['dumbbells'],
  limitations: ['knee'],
  days_per_week: 3,
  session_minutes: 45,
  available_days: ['mon', 'wed', 'fri'],
  training_slots: [],
});

function plan(profile: Profile = persona, seed = 7): Plan {
  const result = generatePlan(profile, makeGoal('general'), {
    today: TODAY,
    now: NOW,
    newId: createSeededIdGenerator(seed),
  });
  if (!result.ok) {
    throw new Error(`blocked: ${result.reason}`);
  }
  return result.plan;
}

const sessionsOf = (p: Plan) => p.weeks.flatMap((w) => w.sessions);

describe('QA final - A plan generation and the screening gate', () => {
  it('builds a 3x45 dumbbell plan with no knee-contraindicated exercise (persona)', () => {
    const p = plan();
    expect(p.weeks).toHaveLength(6);
    for (const s of sessionsOf(p)) {
      for (const pe of s.exercises) {
        const ex = lookup(pe.exercise_id);
        expect(ex.contraindication_tags, pe.exercise_id).not.toContain('knee');
        expect(
          ex.equipment.every((e) => e === 'dumbbells' || e === 'bodyweight'),
          pe.exercise_id,
        ).toBe(true);
      }
      // D9: never above session_minutes + 10%.
      expect(s.est_minutes).toBeLessThanOrEqual(Math.floor(45 * 1.1));
    }
    expect(validatePlanRules(p, persona, lookup)).toEqual([]);
  });

  it('marks low-stimulus picks as non-key and the deload has no finisher (re-review)', () => {
    const p = plan();
    for (const s of sessionsOf(p)) {
      for (const pe of s.exercises) {
        if (lookup(pe.exercise_id).low_stimulus) {
          expect(pe.is_key, pe.exercise_id).toBe(false);
        }
      }
    }
    const deload = must(p.weeks.at(-1));
    expect(deload.phase).toBe('deload');
    for (const s of deload.sessions) {
      expect(s.exercises.some((pe) => lookup(pe.exercise_id).pattern === 'cardio')).toBe(false);
    }
  });

  it('D10: consecutive-only days never put same-muscle sessions back to back', () => {
    const result = generatePlan(
      { ...persona, available_days: ['mon', 'tue', 'wed'] },
      makeGoal('general'),
      { today: TODAY, now: NOW, newId: createSeededIdGenerator(3) },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dates = sessionsOf(result.plan).map((s) => s.scheduled_date);
    const sessions = sessionsOf(result.plan);
    for (let i = 1; i < sessions.length; i += 1) {
      const a = must(sessions[i - 1]);
      const b = must(sessions[i]);
      if (addDays(a.scheduled_date, 1) === b.scheduled_date) {
        const ma = new Set(a.exercises.flatMap((pe) => lookup(pe.exercise_id).primary_muscles));
        const shared = b.exercises
          .flatMap((pe) => lookup(pe.exercise_id).primary_muscles)
          .filter((m) => ma.has(m));
        expect(shared, `${a.scheduled_date}->${b.scheduled_date}`).toEqual([]);
      }
    }
    expect(dates.length).toBeGreaterThan(0);
    // Fewer sessions than requested must come with a warning.
    if (must(result.plan.weeks[0]).sessions.length < 3) {
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });

  it('blocks on any PAR-Q+ yes with the consult-a-doctor message', () => {
    const result = generatePlan(
      { ...persona, parq: { ...persona.parq, bone_joint_or_soft_tissue_problem: true } },
      makeGoal(),
      { today: TODAY, now: NOW, newId: createSeededIdGenerator(1) },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('parq_red_flag');
    expect(result.message).toMatch(/consult a doctor/i);
  });

  it('age gate is conservative: born 2008 blocked on 2026-10-08, born 2007 allowed', () => {
    const gen = (birth_year: number) =>
      generatePlan({ ...persona, birth_year }, makeGoal(), {
        today: TODAY,
        now: NOW,
        newId: createSeededIdGenerator(1),
      });
    const blocked = gen(2008);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe('under_18');
    expect(gen(2007).ok).toBe(true);
  });
});

const pe: PlannedExercise = {
  id: uuid(500),
  planned_session_id: uuid(501),
  exercise_id: 'dumbbell_bench_press',
  order: 0,
  sets: 3,
  measure: 'reps',
  rep_min: 8,
  rep_max: 12,
  target_rir: 3,
  rest_sec: 90,
  is_key: true,
};

function sets(reps: number[], rir: (number | undefined)[], load = 12, day = '2026-10-05') {
  return reps.map((r, i): SetLog => ({
    id: uuid(600 + i),
    workout_log_id: uuid(700),
    exercise_id: pe.exercise_id,
    planned_exercise_id: pe.id,
    set_index: i,
    measure: 'reps',
    reps: r,
    load_kg: load,
    ...(rir[i] === undefined ? {} : { rir: rir[i] }),
    is_warmup: false,
    completed: true,
    performed_at: `${day}T08:0${i}:00Z`,
  }));
}

describe('QA final - B progression and records', () => {
  it('beginner at the top of the range with RIR 2 holds; intermediate increases', () => {
    const logs = sets([12, 12, 12], [2, 2, 2]);
    const base = { today: TODAY, timezone: TZ };
    const beginner = nextTargets(pe, logs, { ...base, experienceLevel: 'beginner' });
    expect(beginner.decision).toBe('hold');
    expect(beginner.target_load_kg).toBe(12);
    const intermediate = nextTargets({ ...pe, target_rir: 2 }, logs, {
      ...base,
      experienceLevel: 'intermediate',
    });
    expect(intermediate.decision).toBe('increase_load');
    expect(must(intermediate.target_load_kg)).toBeGreaterThan(12);
  });

  it('missing RIR uses reps only; a break of > 14 days resets the load by ~10%', () => {
    const t = nextTargets(pe, sets([9, 9, 9], [undefined, undefined, undefined]), {
      today: TODAY,
      timezone: TZ,
      experienceLevel: 'beginner',
    });
    expect(t.decision).toBe('add_reps');
    expect(t.target_reps).toBe(10);
    const late = nextTargets(pe, sets([9, 9, 9], [3, 3, 3], 20, '2026-09-01'), {
      today: TODAY,
      timezone: TZ,
      experienceLevel: 'beginner',
    });
    expect(late.decision).toBe('break_reset');
    expect(must(late.target_load_kg)).toBeLessThan(20);
    expect(late.reason).toMatch(/kg/);
  });

  it('rejects a missing experienceLevel at runtime (stale call sites)', () => {
    expect(() =>
      nextTargets(pe, [], { today: TODAY, timezone: TZ } as unknown as Parameters<
        typeof nextTargets
      >[2]),
    ).toThrow();
  });

  it('personal records pick the best e1RM', () => {
    const records = personalRecords([
      ...sets([10, 8], [3, 2], 12),
      ...sets([5], [3], 16, '2026-10-07').map((s) => ({ ...s, id: uuid(650) })),
    ]);
    const best = must(records[pe.exercise_id]?.best_e1rm);
    // Epley: 12 kg x 10 = 16 kg; 16 kg x 5 = 18.7 kg wins.
    expect(best.load_kg).toBe(16);
    expect(best.e1rm_kg).toBeCloseTo(16 * (1 + 5 / 30), 1);
  });
});

describe('QA final - C rescheduling and the minimum dose', () => {
  const p = plan(persona, 11);
  const week = must(p.weeks[0]);
  const first = must(week.sessions[0]);
  const ctx = {
    today: first.scheduled_date,
    now: NOW,
    newId: createSeededIdGenerator(99),
    profile: persona,
    neighborSessions: [],
  };

  it('requires neighborSessions (D11)', () => {
    expect(() =>
      proposeReschedules(week, { type: 'missed', session_id: first.id }, {
        ...ctx,
        neighborSessions: undefined,
      } as unknown as Parameters<typeof proposeReschedules>[2]),
    ).toThrow(/neighborSessions/);
  });

  it('every missed proposal applies cleanly and keeps the week valid', () => {
    const proposals = proposeReschedules(week, { type: 'missed', session_id: first.id }, ctx);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.at(-1)?.kind).toBe('skip');
    for (const proposal of proposals) {
      const next = applyScheduleChanges(p, proposal.changes, {
        newId: createSeededIdGenerator(5),
        profile: persona,
      });
      expect(validatePlanRules(next, persona, lookup)).toEqual([]);
      for (const c of proposal.changes) {
        expect(c.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it('a 12-minute shorten gives a minimum dose of at most 12 min that respects the knee', () => {
    const proposals = proposeReschedules(
      week,
      { type: 'shorten', session_id: first.id, available_minutes: 12 },
      ctx,
    );
    const shorten = must(proposals.find((x) => x.kind === 'shorten'));
    const next = applyScheduleChanges(p, shorten.changes, {
      newId: createSeededIdGenerator(5),
      profile: persona,
    });
    const s = must(sessionsOf(next).find((x) => x.id === first.id));
    expect(s.variant).toBe('minimum_dose');
    expect(s.est_minutes).toBeGreaterThanOrEqual(MINIMUM_DOSE_MINUTES.min);
    expect(s.est_minutes).toBeLessThanOrEqual(12);
    for (const x of s.exercises) {
      expect(lookup(x.exercise_id).contraindication_tags).not.toContain('knee');
    }
  });

  it('minimumDoseSession stays within 10-15 minutes for every session of the plan', () => {
    for (const s of sessionsOf(p)) {
      const md = minimumDoseSession(s, { profile: persona, newId: createSeededIdGenerator(2) });
      expect(md.est_minutes, s.id).toBeGreaterThanOrEqual(10);
      expect(md.est_minutes, s.id).toBeLessThanOrEqual(15);
    }
  });
});

describe('QA final - D adherence and streaks (D11)', () => {
  it('a skipped session is neutral, a missed one counts; the streak follows', () => {
    const p = plan(persona, 13);
    const w0 = must(p.weeks[0]);
    const [s0, s1, s2] = w0.sessions;
    const skip = proposeReschedules(
      w0,
      { type: 'skip', session_id: must(s1).id },
      {
        today: must(s0).scheduled_date,
        now: NOW,
        newId: createSeededIdGenerator(1),
        profile: persona,
        neighborSessions: [],
      },
    );
    const changes = must(skip[0]).changes;
    const next = applyScheduleChanges(p, changes, {
      newId: createSeededIdGenerator(1),
      profile: persona,
    });
    const log: WorkoutLog = {
      id: uuid(900),
      user_id: persona.user_id,
      planned_session_id: must(s0).id,
      started_at: `${must(s0).scheduled_date}T07:00:00Z`,
      sets: [],
    };
    const nextMonday = must(p.weeks[1]).start_date;
    const stats = adherenceStats(next, [log], { today: nextMonday, timezone: TZ, changes });
    const wk = must(stats.weeks[0]);
    expect(wk.skipped).toBe(1);
    expect(wk.completed).toBe(1);
    expect(wk.missed).toBe(s2 ? 1 : 0);
    expect(wk.planned).toBe(w0.sessions.length - 1);
    expect(stats.overall.percentage).toBeCloseTo(s2 ? 50 : 100, 5);
    // 1/2 < 0.8: week 1 does not qualify.
    expect(weeklyStreak(stats).current).toBe(s2 ? 0 : 1);
    expect(() =>
      adherenceStats(next, [log], { today: nextMonday, timezone: TZ } as unknown as Parameters<
        typeof adherenceStats
      >[2]),
    ).toThrow(/changes/);
  });
});
