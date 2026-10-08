import { describe, expect, it } from 'vitest';
import {
  lookup,
  makeGoal,
  makeProfile,
  must,
  NOW,
  pick,
  planFor,
  seededRandom,
  subset,
  TODAY,
} from '../__fixtures__/engine.js';
import { EXERCISE_CATALOG } from '../catalog/index.js';
import { isExerciseAvailable } from '../equipment.js';
import { createSeededIdGenerator } from '../ids.js';
import { daysBetween, weekdayIndex } from '../dates.js';
import {
  BODY_REGIONS,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  GOAL_TYPES,
  WEEKDAYS,
  createCatalogValidators,
  type Equipment,
  type MuscleGroup,
  type Plan,
  type PlannedSession,
  type Profile,
  type Weekday,
} from '../schemas/index.js';
import { generatePlan } from './generate.js';
import { countsTowardVolume, sessionMuscles, sharesMuscles, validatePlanRules } from './rules.js';
import { estimateSessionMinutes } from './session-time.js';
import { BEGINNER_STRENGTH_KEY, REP_SCHEMES, TIMED_SCHEME, WEEKLY_SET_CAPS } from './templates.js';

const validators = createCatalogValidators(EXERCISE_CATALOG);

const allExercises = (plan: Plan) =>
  plan.weeks.flatMap((week) => week.sessions.flatMap((session) => session.exercises));

/** Independent re-count of hard sets per muscle (primary muscles; no cardio or low stimulus). */
function setsPerMuscle(sessions: readonly PlannedSession[]): Map<MuscleGroup, number> {
  const totals = new Map<MuscleGroup, number>();
  for (const pe of sessions.flatMap((session) => session.exercises)) {
    const exercise = lookup(pe.exercise_id);
    if (exercise.pattern === 'cardio' || exercise.low_stimulus) {
      continue;
    }
    for (const muscle of exercise.primary_muscles) {
      totals.set(muscle, (totals.get(muscle) ?? 0) + pe.sets);
    }
  }
  return totals;
}

/** Same-muscle sessions on consecutive days in one week, plus the wrap into the next week. */
function adjacencyViolations(
  days: readonly number[],
  muscles: readonly Set<MuscleGroup>[],
): number {
  let count = 0;
  for (let i = 0; i + 1 < days.length; i += 1) {
    if (
      (days[i + 1] ?? 0) - (days[i] ?? 0) === 1 &&
      sharesMuscles(must(muscles[i]), must(muscles[i + 1]))
    ) {
      count += 1;
    }
  }
  if (
    days.length > 1 &&
    days.at(-1) === 6 &&
    days[0] === 0 &&
    sharesMuscles(must(muscles.at(-1)), must(muscles[0]))
  ) {
    count += 1;
  }
  return count;
}

function combinations(items: readonly number[], size: number): number[][] {
  if (size === 0) {
    return [[]];
  }
  return items.flatMap((head, i) =>
    combinations(items.slice(i + 1), size - 1).map((tail) => [head, ...tail]),
  );
}

describe('generatePlan', () => {
  it('is deterministic: the same input gives the same plan', () => {
    const profile = makeProfile();
    expect(planFor(profile)).toEqual(planFor(profile));
  });

  it('matches the snapshot for the sample beginner (3x/week, dumbbells + bench, knee)', () => {
    const plan = planFor(makeProfile({ limitations: ['knee'] }));
    const summary = plan.weeks.map((week) => ({
      week: `${week.index} ${week.start_date} ${week.phase}`,
      sessions: week.sessions.map(
        (s) =>
          `${s.scheduled_date} ${s.title} [${s.priority}] ${s.est_minutes}min: ` +
          s.exercises
            .map(
              (e) =>
                `${e.exercise_id}${e.is_key ? '*' : ''} ${e.sets}x${e.rep_min}-${e.rep_max} RIR${e.target_rir} rest${e.rest_sec}`,
            )
            .join(', '),
      ),
    }));
    expect(summary).toMatchSnapshot();
    expect(plan.rationale_text).toMatchSnapshot();
  });

  it('validates against the plan schema plus the catalog validators', () => {
    const result = validators.Plan.safeParse(planFor(makeProfile()));
    expect(result.error?.issues).toBeUndefined();
  });

  it.each([
    [1, 'full_body_2x', 1],
    [2, 'full_body_2x', 2],
    [3, 'full_body_3x', 3],
    [4, 'upper_lower_4x', 4],
    [5, 'upper_lower_4x', 4],
    [7, 'upper_lower_4x', 4],
  ] as const)('%i day(s)/week -> %s with %i session(s) per week', (days, templateId, perWeek) => {
    const result = generatePlan(
      makeProfile({ days_per_week: days, training_slots: [] }),
      makeGoal(),
      {
        today: TODAY,
        now: NOW,
        newId: createSeededIdGenerator(1),
      },
    );
    expect(result.ok && result.templateId).toBe(templateId);
    const plan = result.ok ? result.plan : undefined;
    expect(plan?.template_id).toBe(templateId);
    plan?.weeks.forEach((week) => {
      expect(week.sessions).toHaveLength(perWeek);
    });
  });

  it('alternates Full Body A and B week by week with one day per week', () => {
    const plan = planFor(makeProfile({ days_per_week: 1, training_slots: [] }));
    expect(plan.weeks.map((week) => week.sessions[0]?.title)).toEqual([
      'Full Body A',
      'Full Body B',
      'Full Body A',
      'Full Body B',
      'Full Body A',
      'Full Body B',
    ]);
  });

  it('builds a 6-week block of Monday-aligned weeks with a deload in week 6', () => {
    const plan = planFor(makeProfile());
    expect(plan.start_date).toBe('2026-10-12'); // the Monday after Thursday 2026-10-08
    expect(plan.weeks.map((week) => week.phase)).toEqual([
      'accumulation',
      'accumulation',
      'accumulation',
      'intensification',
      'intensification',
      'deload',
    ]);
    const hardSets = (sessions: readonly PlannedSession[]) =>
      sessions
        .flatMap((session) => session.exercises)
        .filter((pe) => countsTowardVolume(lookup(pe.exercise_id)))
        .reduce((sum, pe) => sum + pe.sets, 0);
    const [first, , , , , deload] = plan.weeks;
    expect(hardSets(must(deload).sessions)).toBeLessThan(hardSets(must(first).sessions) * 0.75);
    const deloadRir = must(deload).sessions.flatMap((s) => s.exercises.map((e) => e.target_rir));
    expect(new Set(deloadRir)).toEqual(new Set([4]));
  });

  it('starts today when today is a Monday, and honours an explicit Monday start date', () => {
    const opts = { now: NOW, newId: createSeededIdGenerator(1) };
    const monday = generatePlan(makeProfile(), makeGoal(), { ...opts, today: '2026-10-12' });
    expect(monday.ok && monday.plan.start_date).toBe('2026-10-12');
    const explicit = generatePlan(makeProfile(), makeGoal(), {
      ...opts,
      today: TODAY,
      startDate: '2026-10-19',
    });
    expect(explicit.ok && explicit.plan.start_date).toBe('2026-10-19');
    expect(() =>
      generatePlan(makeProfile(), makeGoal(), { ...opts, today: TODAY, startDate: '2026-10-20' }),
    ).toThrow(/must be a Monday/);
  });

  it('rejects invalid input', () => {
    const opts = { today: TODAY, now: NOW, newId: createSeededIdGenerator(1) };
    expect(() => generatePlan(makeProfile({ days_per_week: 0 }), makeGoal(), opts)).toThrow();
    expect(() =>
      generatePlan(
        makeProfile(),
        { ...makeGoal(), user_id: '00000000-0000-4000-8000-0000000000ff' },
        opts,
      ),
    ).toThrow(/different user/);
    expect(() =>
      generatePlan(makeProfile({ available_days: ['mon'], days_per_week: 3 }), makeGoal(), opts),
    ).toThrow();
  });

  it('beginners train at RIR 3-4 and nobody trains to failure', () => {
    const beginner = planFor(makeProfile({ experience_level: 'beginner' }));
    for (const pe of allExercises(beginner)) {
      expect(pe.target_rir).toBeGreaterThanOrEqual(3);
      expect(pe.target_rir).toBeLessThanOrEqual(4);
    }
    const advanced = planFor(makeProfile({ experience_level: 'advanced' }));
    expect(Math.min(...allExercises(advanced).map((pe) => pe.target_rir))).toBeGreaterThanOrEqual(
      1,
    );
  });

  it.each(GOAL_TYPES)('uses the double-progression rep ranges for goal "%s"', (goal) => {
    for (const level of ['beginner', 'intermediate'] as const) {
      const plan = planFor(makeProfile({ experience_level: level }), makeGoal(goal));
      for (const pe of allExercises(plan)) {
        const exercise = lookup(pe.exercise_id);
        if (exercise.pattern === 'cardio') {
          expect(pe.rep_min).toBe(pe.rep_max); // conditioning finisher: one fixed duration
          continue;
        }
        const expected =
          pe.measure === 'seconds'
            ? TIMED_SCHEME
            : pe.is_key && goal === 'strength' && level === 'beginner'
              ? BEGINNER_STRENGTH_KEY
              : REP_SCHEMES[goal][pe.is_key ? 'key' : 'accessory'];
        expect([pe.rep_min, pe.rep_max, pe.rest_sec]).toEqual([
          expected.rep_min,
          expected.rep_max,
          expected.rest_sec,
        ]);
      }
    }
  });

  it('marks key compound lifts and gives every session at least one', () => {
    const plan = planFor(makeProfile({ equipment: ['barbell', 'rack', 'bench', 'dumbbells'] }));
    for (const session of must(plan.weeks[0]).sessions) {
      const keys = session.exercises.filter((pe) => pe.is_key);
      expect(keys.length).toBeGreaterThan(0);
      for (const pe of keys) {
        expect(lookup(pe.exercise_id).pattern).not.toBe('isolation');
      }
    }
  });

  describe('exercise selection by actual equipment (not by tier)', () => {
    it('gives pull-ups to a home user with dumbbells and a pull-up bar', () => {
      const plan = planFor(
        makeProfile({ equipment: ['dumbbells', 'pullup_bar'], experience_level: 'intermediate' }),
      );
      expect(allExercises(plan).map((pe) => pe.exercise_id)).toContain('pull_up');
    });

    it('gives a beginner with a pull-up bar the beginner pull-up progression', () => {
      const ids = allExercises(
        planFor(makeProfile({ equipment: ['dumbbells', 'pullup_bar'] })),
      ).map((pe) => pe.exercise_id);
      expect(ids).toContain('negative_pull_up');
      expect(ids).not.toContain('towel_lat_pulldown'); // low stimulus avoided
    });

    it('never uses equipment the user does not have', () => {
      const plan = planFor(makeProfile({ equipment: ['dumbbells'] }));
      for (const pe of allExercises(plan)) {
        expect(isExerciseAvailable(lookup(pe.exercise_id), ['dumbbells'])).toBe(true);
      }
    });

    it('prefers non-low-stimulus options and uses them only as a last resort', () => {
      const plan = planFor(makeProfile({ equipment: [], days_per_week: 3 }));
      const lowStimulus = allExercises(plan).filter((pe) => lookup(pe.exercise_id).low_stimulus);
      // Bodyweight only: vertical pulls have only low-stimulus options; rows have doorframe_row.
      expect(new Set(lowStimulus.map((pe) => lookup(pe.exercise_id).pattern))).toEqual(
        new Set(['pull_v']),
      );
    });
  });

  it('schedules on the preferred training-slot days', () => {
    const plan = planFor(makeProfile()); // slots: mon 07:00, wed 18:30, fri 07:00
    for (const week of plan.weeks) {
      expect(week.sessions.map((s) => weekdayIndex(s.scheduled_date))).toEqual([0, 2, 4]);
      for (const session of week.sessions) {
        expect(session.day_index).toBe(weekdayIndex(session.scheduled_date));
      }
    }
  });

  it('avoids consecutive full-body days when the available days allow it', () => {
    const plan = planFor(
      makeProfile({
        days_per_week: 3,
        available_days: ['mon', 'tue', 'wed', 'thu'],
        training_slots: [{ day: 'mon', start_time: '07:00', location: 'gym' }],
      }),
    );
    // Only Mon/Tue/Wed/Thu: 3 full-body sessions cannot avoid one consecutive pair, so the
    // planner picks Mon + Wed + Thu or Mon + Tue + Thu (one pair), never Mon/Tue/Wed (two).
    const days = must(plan.weeks[0]).sessions.map((s) => weekdayIndex(s.scheduled_date));
    expect(
      adjacencyViolations(
        days,
        must(plan.weeks[0]).sessions.map((s) => sessionMuscles(s, lookup)),
      ),
    ).toBe(1);
  });

  it('alternates upper and lower days so 4 consecutive days have no same-muscle pairs', () => {
    const plan = planFor(
      makeProfile({
        days_per_week: 4,
        available_days: ['mon', 'tue', 'wed', 'thu'],
        training_slots: [],
      }),
    );
    const sessions = must(plan.weeks[0]).sessions;
    expect(sessions.map((s) => s.title)).toEqual(['Upper A', 'Lower A', 'Upper B', 'Lower B']);
    expect(
      adjacencyViolations(
        sessions.map((s) => weekdayIndex(s.scheduled_date)),
        sessions.map((s) => sessionMuscles(s, lookup)),
      ),
    ).toBe(0);
  });
});

describe('generatePlan properties over many profiles', () => {
  const equipmentSets: Equipment[][] = [
    [],
    ['dumbbells'],
    ['dumbbells', 'bench'],
    ['dumbbells', 'pullup_bar'],
    ['kettlebell', 'bands'],
    ['dumbbells', 'bench', 'pullup_bar', 'bands'],
    ['barbell', 'rack', 'bench'],
    [...EQUIPMENT],
  ];
  const minutes = [10, 15, 20, 30, 45, 60, 75, 90, 120, 180];

  const random = seededRandom(20261008);
  const profiles: Profile[] = Array.from({ length: 300 }, () => {
    const days = 1 + Math.floor(random() * 7);
    let available: Weekday[] = subset(random, WEEKDAYS);
    for (const day of WEEKDAYS) {
      if (available.length >= days) {
        break;
      }
      if (!available.includes(day)) {
        available = [...available, day];
      }
    }
    const slotDays = subset(random, available);
    return makeProfile({
      equipment: pick(random, equipmentSets),
      limitations: subset(random, BODY_REGIONS),
      experience_level: pick(random, EXPERIENCE_LEVELS),
      days_per_week: days,
      available_days: available,
      session_minutes: pick(random, minutes),
      training_slots: slotDays.map((day) => ({ day, start_time: '07:00', location: 'home' })),
    });
  });
  const goals = profiles.map(() => pick(random, GOAL_TYPES));
  const cases = profiles.map((profile, i) => ({
    profile,
    goal: makeGoal(goals[i]),
    plan: planFor(profile, makeGoal(goals[i]), i + 1),
  }));

  it('every plan validates against the schema and the catalog validators', () => {
    for (const { plan } of cases) {
      expect(validators.Plan.safeParse(plan).error?.issues).toBeUndefined();
    }
  });

  it('every plan passes the rules validator', () => {
    for (const { plan, profile } of cases) {
      expect(validatePlanRules(plan, profile, lookup)).toEqual([]);
    }
  });

  it('respects the weekly set cap per muscle group', () => {
    for (const { plan, profile } of cases) {
      const cap = WEEKLY_SET_CAPS[profile.experience_level];
      for (const week of plan.weeks) {
        for (const sets of setsPerMuscle(week.sessions).values()) {
          expect(sets).toBeLessThanOrEqual(cap);
        }
      }
    }
  });

  it('never includes a contraindicated or unavailable exercise', () => {
    for (const { plan, profile } of cases) {
      for (const pe of allExercises(plan)) {
        const exercise = lookup(pe.exercise_id);
        expect(
          exercise.contraindication_tags.filter((tag) => profile.limitations.includes(tag)),
        ).toEqual([]);
        expect(isExerciseAvailable(exercise, profile.equipment)).toBe(true);
      }
    }
  });

  it('keeps every session within session_minutes +/- 10% under the time model', () => {
    for (const { plan, profile } of cases) {
      for (const session of plan.weeks.flatMap((week) => week.sessions)) {
        expect(session.est_minutes).toBe(estimateSessionMinutes(session.exercises, 'full', lookup));
        expect(Math.abs(session.est_minutes - profile.session_minutes)).toBeLessThanOrEqual(
          profile.session_minutes * 0.1,
        );
      }
    }
  });

  it('schedules only on available days, one session per day, inside each week', () => {
    for (const { plan, profile } of cases) {
      for (const week of plan.weeks) {
        const dates = week.sessions.map((s) => s.scheduled_date);
        expect(new Set(dates).size).toBe(dates.length);
        for (const date of dates) {
          expect(profile.available_days).toContain(WEEKDAYS[weekdayIndex(date)]);
          expect(daysBetween(week.start_date, date)).toBeGreaterThanOrEqual(0);
          expect(daysBetween(week.start_date, date)).toBeLessThanOrEqual(6);
        }
      }
    }
  });

  it('has no same-muscle sessions on consecutive days unless unavoidable', () => {
    for (const { plan, profile } of cases) {
      const week = must(plan.weeks[0]);
      const muscles = week.sessions.map((s) => sessionMuscles(s, lookup));
      const actual = adjacencyViolations(
        week.sessions.map((s) => weekdayIndex(s.scheduled_date)),
        muscles,
      );
      const available = profile.available_days
        .map((d) => WEEKDAYS.indexOf(d))
        .sort((a, b) => a - b);
      const best = Math.min(
        ...combinations(available, week.sessions.length).map((days) =>
          adjacencyViolations(days, muscles),
        ),
      );
      expect(actual).toBe(best);
    }
  });

  it('marks at least one key exercise per session', () => {
    for (const { plan } of cases) {
      for (const session of plan.weeks.flatMap((week) => week.sessions)) {
        expect(session.exercises.some((pe) => pe.is_key)).toBe(true);
      }
    }
  });

  it('is deterministic across the sample', () => {
    for (const { plan, profile, goal } of cases.slice(0, 30)) {
      const again = generatePlan(profile, goal, {
        today: TODAY,
        now: NOW,
        newId: createSeededIdGenerator(cases.findIndex((c) => c.plan === plan) + 1),
      });
      expect(again.ok && again.plan).toEqual(plan);
    }
  });
});
