/**
 * QA batch 2 (T6): consumer-level checks of rescheduling found during the QA pass.
 * `it.fails` marks a confirmed BUG; flip it to `it` once fixed.
 */
import { describe, expect, it } from 'vitest';
import { lookup, makeProfile, must, NOW, planFor } from '../__fixtures__/engine.js';
import { EXERCISE_CATALOG } from '../catalog/index.js';
import { addDays } from '../dates.js';
import { createSeededIdGenerator } from '../ids.js';
import { consecutiveMuscleConflicts, occupiesDate, weeklySetsByMuscle } from '../plan/rules.js';
import { WEEKLY_SET_CAPS } from '../plan/templates.js';
import {
  createCatalogValidators,
  type Plan,
  type PlannedSession,
  type Profile,
} from '../schemas/index.js';
import { applyScheduleChanges } from './apply.js';
import { proposeReschedules, rescheduleWeek, type RescheduleEvent } from './reschedule.js';
import { minimumDoseSession } from './session-variants.js';

const validators = createCatalogValidators(EXERCISE_CATALOG);

function reschedule(
  plan: Plan,
  profile: Profile,
  weekIndex: number,
  session: PlannedSession,
  event: EventInput,
  today: string,
  withNeighbours = true,
) {
  const week = must(plan.weeks[weekIndex]);
  const neighborSessions = withNeighbours
    ? [
        ...(plan.weeks[weekIndex - 1]?.sessions ?? []),
        ...(plan.weeks[weekIndex + 1]?.sessions ?? []),
      ]
    : undefined;
  const constraints = {
    plan_id: plan.id,
    today,
    now: NOW,
    newId: createSeededIdGenerator(4242),
    profile,
    ...(neighborSessions ? { neighborSessions } : {}),
  };
  const fullEvent: RescheduleEvent = { ...event, session_id: session.id };
  const changes = rescheduleWeek(week, fullEvent, constraints);
  const next = applyScheduleChanges(plan, changes, {
    newId: createSeededIdGenerator(4343),
    profile,
  });
  return { changes, next, proposals: proposeReschedules(week, fullEvent, constraints) };
}

type EventInput =
  { type: 'missed' } | { type: 'skip' } | { type: 'shorten'; available_minutes: number };

const allSessions = (plan: Plan) => plan.weeks.flatMap((w) => w.sessions);

/** Plain-English reason: sentence case, no ids, no snake_case, no leaked placeholders. */
function isPlainEnglish(reason: string): boolean {
  return (
    /^[A-Z]/.test(reason) &&
    !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(reason) &&
    !/_/.test(reason) &&
    !/undefined|null|NaN|\[object/.test(reason)
  );
}

/** Full Body 3x on Mon/Wed/Fri (bodyweight, every day available). Week 1 = 2026-10-19. */
const fbProfile = makeProfile({ equipment: [], limitations: [], session_minutes: 45 });
const fbPlan = planFor(fbProfile);
const fbWeek1 = must(fbPlan.weeks[1]);

/** Full gym intermediate, knee + lower back, Upper/Lower 4x, 60 min. */
const gymProfile = makeProfile({
  experience_level: 'intermediate',
  days_per_week: 4,
  session_minutes: 60,
  limitations: ['knee', 'lower_back'],
  training_slots: [],
  equipment: [
    'dumbbells',
    'kettlebell',
    'barbell',
    'bench',
    'rack',
    'pullup_bar',
    'cable',
    'machine',
    'bands',
  ],
});
const gymPlan = planFor(gymProfile);
const gymWeek1 = must(gymPlan.weeks[1]);

describe('QA batch 2: missed sessions on Monday, mid-week and Sunday', () => {
  it('Monday miss (reported Tuesday) resolves in-week with plain-English reasons and no adjacency', () => {
    const monday = must(fbWeek1.sessions[0]);
    const { changes, next, proposals } = reschedule(
      fbPlan,
      fbProfile,
      1,
      monday,
      { type: 'missed' },
      '2026-10-20',
    );
    expect(changes.length).toBeGreaterThan(0);
    expect(validators.Plan.safeParse(next).success).toBe(true);
    expect(consecutiveMuscleConflicts(allSessions(next), lookup)).toEqual([]);
    for (const proposal of proposals) {
      for (const change of proposal.changes) {
        expect(isPlainEnglish(change.reason), change.reason).toBe(true);
      }
    }
  });

  it('mid-week miss in Upper/Lower moves to a safe later day', () => {
    const wednesday = must(gymWeek1.sessions.find((s) => s.scheduled_date === '2026-10-21'));
    const { changes, next } = reschedule(
      gymPlan,
      gymProfile,
      1,
      wednesday,
      { type: 'missed' },
      '2026-10-22',
    );
    expect(changes.map((c) => c.kind)).toEqual(['move']);
    expect(must(changes[0]).to_date).toBe('2026-10-23');
    expect(consecutiveMuscleConflicts(allSessions(next), lookup)).toEqual([]);
  });

  it('Sunday miss is skipped with a week-boundary reason', () => {
    const profile = makeProfile({
      available_days: ['tue', 'thu', 'sun'],
      training_slots: [],
      equipment: ['dumbbells', 'pullup_bar'],
    });
    const plan = planFor(profile);
    const sunday = must(
      must(plan.weeks[1]).sessions.find((s) => s.scheduled_date === '2026-10-25'),
    );
    const { changes } = reschedule(plan, profile, 1, sunday, { type: 'missed' }, '2026-10-26');
    expect(changes.map((c) => c.kind)).toEqual(['skip']);
    expect(must(changes[0]).reason).toMatch(/last day of this training week/);
  });

  // BUG (minor): when the caller omits the optional `neighborSessions`, a missed Monday session
  // is moved to Sunday, back to back with next Monday's session for the same muscles. The
  // acceptance criterion says "never two sessions for the same muscle group on consecutive days";
  // the safe result depends on an optional argument. Expected: treat Sunday/Monday as unsafe (or
  // require neighbours) when they are not supplied.
  it.fails('BUG: without neighborSessions a move to Sunday collides with next Monday', () => {
    const monday = must(fbWeek1.sessions[0]);
    const { next } = reschedule(
      fbPlan,
      fbProfile,
      1,
      monday,
      { type: 'missed' },
      '2026-10-20',
      false,
    );
    expect(consecutiveMuscleConflicts(allSessions(next), lookup)).toEqual([]);
  });

  // BUG (minor): a Monday session reported missed after its week ended is skipped with the reason
  // "That was the last day of this training week", which is false for a Monday session.
  it.fails('BUG: a late-reported Monday miss says it was the last day of the week', () => {
    const monday = must(fbWeek1.sessions[0]);
    const { changes } = reschedule(fbPlan, fbProfile, 1, monday, { type: 'missed' }, '2026-10-28');
    expect(must(changes[0]).reason).not.toMatch(/last day of this training week/);
  });

  // BUG (minor): a merge always keeps every key exercise of both sessions at full sets, so the
  // absorbing session can far exceed the user's session length (30 min -> 46 min here) and the
  // plan then fails `validatePlanRules` ("est_minutes 46 is outside 30 +/- 10%").
  it.fails('BUG: merging a missed session makes a 30-minute session last 46 minutes', () => {
    const profile = makeProfile({
      equipment: [],
      days_per_week: 2,
      session_minutes: 30,
      available_days: ['mon', 'tue', 'thu', 'fri', 'sun'],
      training_slots: [],
    });
    const plan = planFor(profile);
    const monday = must(must(plan.weeks[0]).sessions[0]);
    const { changes, next } = reschedule(
      plan,
      profile,
      0,
      monday,
      { type: 'missed' },
      addDays(monday.scheduled_date, 2),
    );
    expect(changes.map((c) => c.kind)).toEqual(['merge']);
    const absorber = must(
      must(next.weeks[0]).sessions.find((s) => s.id === must(changes[0]).merged_into_session_id),
    );
    expect(absorber.est_minutes).toBeLessThanOrEqual(33);
  });
});

describe('QA batch 2: shorten and skip', () => {
  it('shorten to 20 minutes keeps every key exercise and stays within 20 minutes', () => {
    const upperA = must(gymWeek1.sessions[0]);
    const { next } = reschedule(
      gymPlan,
      gymProfile,
      1,
      upperA,
      { type: 'shorten', available_minutes: 20 },
      '2026-10-19',
    );
    const short = must(must(next.weeks[1]).sessions[0]);
    expect(short.variant).toBe('short');
    expect(short.est_minutes).toBeLessThanOrEqual(20);
    for (const key of upperA.exercises.filter((pe) => pe.is_key)) {
      expect(short.exercises.map((pe) => pe.exercise_id)).toContain(key.exercise_id);
    }
  });

  it('shorten to 12 minutes gives a 10-12 minute minimum dose', () => {
    const upperA = must(gymWeek1.sessions[0]);
    const { next } = reschedule(
      gymPlan,
      gymProfile,
      1,
      upperA,
      { type: 'shorten', available_minutes: 12 },
      '2026-10-19',
    );
    const dose = must(must(next.weeks[1]).sessions[0]);
    expect(dose.variant).toBe('minimum_dose');
    expect(dose.est_minutes).toBeGreaterThanOrEqual(10);
    expect(dose.est_minutes).toBeLessThanOrEqual(12);
  });

  it('skip marks the session skipped and leaves the rest of the week alone', () => {
    const lowerA = must(gymWeek1.sessions[1]);
    const { changes, next } = reschedule(
      gymPlan,
      gymProfile,
      1,
      lowerA,
      { type: 'skip' },
      '2026-10-19',
    );
    expect(changes.map((c) => c.kind)).toEqual(['skip']);
    const after = must(next.weeks[1]).sessions;
    expect(after.map((s) => s.status)).toEqual(['planned', 'skipped', 'planned', 'planned']);
  });

  // BUG (minor): with only 10 minutes available the proposal is an 11-minute minimum dose
  // ("With 10 minutes, a 11-minute minimum-dose circuit ..."): longer than the user has, and
  // "a 11-minute" should read "an 11-minute".
  it.fails('BUG: a 10-minute window gets an 11-minute minimum dose', () => {
    const fullBodyA = must(fbWeek1.sessions[0]);
    const { changes } = reschedule(
      fbPlan,
      fbProfile,
      1,
      fullBodyA,
      { type: 'shorten', available_minutes: 10 },
      '2026-10-19',
    );
    expect(must(changes[0]).new_est_minutes).toBeLessThanOrEqual(10);
  });

  it.fails('BUG: reasons use "a 11-minute" / "a 18-minute" instead of "an"', () => {
    const fullBodyA = must(fbWeek1.sessions[0]);
    const { changes } = reschedule(
      fbPlan,
      fbProfile,
      1,
      fullBodyA,
      { type: 'shorten', available_minutes: 10 },
      '2026-10-19',
    );
    expect(must(changes[0]).reason).not.toMatch(/\ba (8|11|18)-minute/);
  });

  // BUG (minor): the minimum dose adds sets round-robin up to 4 per exercise, so it can prescribe
  // MORE sets of an exercise than the full session did (push-up 3 -> 4 here) and push a
  // beginner's weekly volume above WEEKLY_SET_CAPS (glutes 14 > 12 after a 12-minute shorten).
  it.fails('BUG: the minimum dose prescribes more sets than the full session', () => {
    const profile = makeProfile({
      equipment: [],
      session_minutes: 30,
      days_per_week: 4,
      training_slots: [],
    });
    const plan = planFor(profile);
    for (const session of must(plan.weeks[0]).sessions) {
      const dose = minimumDoseSession(session, { profile, newId: createSeededIdGenerator(5) });
      for (const pe of dose.exercises) {
        const original = session.exercises.find((o) => o.exercise_id === pe.exercise_id);
        if (original) {
          expect(pe.sets, `${session.title} ${pe.exercise_id}`).toBeLessThanOrEqual(original.sets);
        }
      }
    }
  });

  it.fails('BUG: a 12-minute shorten can push weekly sets above the beginner cap', () => {
    const profile = makeProfile({
      equipment: [],
      session_minutes: 30,
      days_per_week: 4,
      available_days: ['mon', 'wed', 'fri', 'sun'],
      training_slots: [],
    });
    const plan = planFor(profile);
    const cap = WEEKLY_SET_CAPS.beginner;
    for (const session of must(plan.weeks[0]).sessions) {
      const { next } = reschedule(
        plan,
        profile,
        0,
        session,
        { type: 'shorten', available_minutes: 12 },
        session.scheduled_date,
      );
      const occupying = must(next.weeks[0]).sessions.filter(occupiesDate);
      for (const [muscle, sets] of weeklySetsByMuscle(occupying, lookup)) {
        expect(sets, `${session.title}: ${muscle}`).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('a minimum dose only uses exercises allowed by equipment and limitations', () => {
    const profile = makeProfile({ equipment: [], limitations: ['knee', 'lower_back', 'hip'] });
    for (const session of gymWeek1.sessions) {
      const dose = minimumDoseSession(session, { profile, newId: createSeededIdGenerator(6) });
      expect(dose.est_minutes).toBeGreaterThanOrEqual(10);
      expect(dose.est_minutes).toBeLessThanOrEqual(15);
      for (const pe of dose.exercises) {
        const exercise = lookup(pe.exercise_id);
        expect(exercise.equipment.every((e) => e === 'bodyweight')).toBe(true);
        expect(exercise.contraindication_tags.some((t) => profile.limitations.includes(t))).toBe(
          false,
        );
      }
    }
  });
});
