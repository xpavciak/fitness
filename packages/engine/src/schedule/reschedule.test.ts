import { describe, expect, it } from 'vitest';
import {
  lookup,
  makeProfile,
  must,
  NOW,
  pick,
  planFor,
  seededRandom,
  subset,
} from '../__fixtures__/engine.js';
import { EXERCISE_CATALOG } from '../catalog/index.js';
import { addDays, daysBetween, isWithinWeek } from '../dates.js';
import { isExerciseAvailable } from '../equipment.js';
import { createSeededIdGenerator } from '../ids.js';
import { consecutiveMuscleConflicts } from '../plan/rules.js';
import {
  BODY_REGIONS,
  ScheduleChangeSchema,
  createCatalogValidators,
  type Plan,
  type PlannedSession,
  type PlanWeek,
  type Profile,
  type Weekday,
  WEEKDAYS,
} from '../schemas/index.js';
import { applyScheduleChanges, replacePlannedSession } from './apply.js';
import {
  proposeReschedules,
  rescheduleWeek,
  type RescheduleConstraints,
  type RescheduleEvent,
} from './reschedule.js';
import { minimumDoseSession, shortenSession } from './session-variants.js';

const validators = createCatalogValidators(EXERCISE_CATALOG);

function constraints(
  plan: Plan,
  profile: Profile,
  today: string,
  extra: Partial<RescheduleConstraints> = {},
): RescheduleConstraints {
  return {
    plan_id: plan.id,
    today,
    now: NOW,
    newId: createSeededIdGenerator(99),
    profile,
    ...extra,
  };
}

const sessionByTitle = (week: PlanWeek, title: string): PlannedSession =>
  must(
    week.sessions.find((s) => s.title === title),
    title,
  );

const applyOpts = (profile: Profile) => ({ newId: createSeededIdGenerator(77), profile });

/** Full Body 3x on Mon/Wed/Fri (week 0 starts Monday 2026-10-12), every day available. */
const fbProfile = makeProfile();
const fbPlan = planFor(fbProfile);
const fbWeek = must(fbPlan.weeks[0]);

/** Upper/Lower on Mon/Tue/Thu/Fri; only those days available. */
const ulProfile = makeProfile({
  days_per_week: 4,
  available_days: ['mon', 'tue', 'thu', 'fri'],
  training_slots: [],
  equipment: ['dumbbells', 'bench', 'pullup_bar'],
});
const ulPlan = planFor(ulProfile);
const ulWeek = must(ulPlan.weeks[0]);

describe('rescheduleWeek: missed sessions', () => {
  it('moves a missed session to the nearest safe free day in the week', () => {
    const fullBodyA = sessionByTitle(fbWeek, 'Full Body A'); // Monday 2026-10-12
    const changes = rescheduleWeek(
      fbWeek,
      { type: 'missed', session_id: fullBodyA.id },
      constraints(fbPlan, fbProfile, '2026-10-13'),
    );
    // Tue/Thu/Sat sit next to Wed/Fri full-body sessions, so Sunday is the first safe day.
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'move',
      from_date: '2026-10-12',
      to_date: '2026-10-18',
    });
    expect(changes[0]?.reason).toMatch(/You missed Full Body A on Monday\. It moves to Sunday/);
  });

  it('respects next week (neighbour sessions): a key session takes a non-key slot instead', () => {
    const fullBodyA = sessionByTitle(fbWeek, 'Full Body A');
    const fullBodyC = sessionByTitle(fbWeek, 'Full Body C'); // Friday, priority normal
    const proposals = proposeReschedules(
      fbWeek,
      { type: 'missed', session_id: fullBodyA.id },
      constraints(fbPlan, fbProfile, '2026-10-13', {
        neighborSessions: must(fbPlan.weeks[1]).sessions,
      }),
    );
    expect(proposals.map((p) => p.kind)).toEqual(['move', 'merge', 'skip']);
    const [displace] = proposals;
    expect(displace?.changes).toMatchObject([
      { kind: 'skip', planned_session_id: fullBodyC.id },
      { kind: 'move', planned_session_id: fullBodyA.id, to_date: fullBodyC.scheduled_date },
    ]);
    expect(displace?.changes[1]?.reason).toMatch(/key session, so it takes the Friday slot/);
  });

  it('offers move, merge and skip in key-first order and keeps legs apart', () => {
    const lowerA = sessionByTitle(ulWeek, 'Lower A'); // Tuesday
    const lowerB = sessionByTitle(ulWeek, 'Lower B'); // Friday
    const proposals = proposeReschedules(
      ulWeek,
      { type: 'missed', session_id: lowerA.id },
      constraints(ulPlan, ulProfile, '2026-10-14'),
    );
    // Wed/Sat/Sun are not available; Upper B on Thursday sits next to Lower B on Friday.
    expect(proposals.map((p) => p.kind)).toEqual(['move', 'merge', 'skip']);
    expect(proposals[0]?.changes.map((c) => c.kind)).toEqual(['skip', 'move']);
    expect(proposals[1]?.changes[0]).toMatchObject({
      kind: 'merge',
      merged_into_session_id: lowerB.id,
    });
    expect(proposals[1]?.changes[0]?.reason).toMatch(/key exercises \(.+\) are added to Lower B/);
  });

  it('prefers skipping an optional session', () => {
    const week = structuredClone(fbWeek);
    const session = must(week.sessions[2]);
    session.priority = 'optional';
    const proposals = proposeReschedules(
      week,
      { type: 'missed', session_id: session.id },
      constraints(fbPlan, fbProfile, '2026-10-16'),
    );
    expect(proposals[0]?.kind).toBe('skip');
    expect(proposals.length).toBeGreaterThan(1);
  });

  it('never crosses the week boundary: a missed last-day session is skipped with a clear reason', () => {
    const profile = makeProfile({ days_per_week: 1, available_days: ['sun'], training_slots: [] });
    const plan = planFor(profile);
    const week = must(plan.weeks[0]);
    const sunday = must(week.sessions[0]);
    expect(sunday.scheduled_date).toBe('2026-10-18');
    for (const today of ['2026-10-18', '2026-10-19', '2026-10-25']) {
      const proposals = proposeReschedules(
        week,
        { type: 'missed', session_id: sunday.id },
        constraints(plan, profile, today),
      );
      expect(proposals.map((p) => p.kind)).toEqual(['skip']);
      expect(proposals[0]?.changes[0]?.reason).toMatch(
        /last day of this training week and sessions do not carry over into next week/,
      );
    }
  });

  it('merges a missed session into the next one when no safe free day is left', () => {
    // Full Body 2x on Wed + Sat. Wednesday is missed; Thursday is today, Friday and Sunday sit
    // next to Saturday, and both sessions are key, so the key work merges into Saturday.
    const profile = makeProfile({
      days_per_week: 2,
      available_days: ['wed', 'fri', 'sat', 'sun'],
      training_slots: [
        { day: 'wed', start_time: '18:00', location: 'gym' },
        { day: 'sat', start_time: '09:00', location: 'gym' },
      ],
    });
    const plan = planFor(profile);
    const week = must(plan.weeks[0]);
    const [wednesday, saturday] = week.sessions;
    expect(week.sessions.map((s) => s.scheduled_date)).toEqual(['2026-10-14', '2026-10-17']);
    const proposals = proposeReschedules(
      week,
      { type: 'missed', session_id: must(wednesday).id },
      constraints(plan, profile, '2026-10-15'),
    );
    expect(proposals.map((p) => p.kind)).toEqual(['merge', 'skip']);
    expect(proposals[0]?.changes[0]?.merged_into_session_id).toBe(must(saturday).id);
  });

  it('rejects sessions that are done, merged or not in the week', () => {
    const week = structuredClone(fbWeek);
    must(week.sessions[0]).status = 'done';
    const opts = constraints(fbPlan, fbProfile, '2026-10-13');
    expect(() =>
      rescheduleWeek(week, { type: 'missed', session_id: must(week.sessions[0]).id }, opts),
    ).toThrow(/done/);
    expect(() =>
      rescheduleWeek(
        week,
        { type: 'missed', session_id: '00000000-0000-4000-8000-0000000000ee' },
        opts,
      ),
    ).toThrow(/not in week/);
    expect(() =>
      rescheduleWeek(
        week,
        { type: 'teleport', session_id: must(week.sessions[1]).id } as unknown as RescheduleEvent,
        opts,
      ),
    ).toThrow();
  });
});

describe('rescheduleWeek: shorten and skip', () => {
  it('shortens to at most 30 minutes with every key exercise', () => {
    const session = sessionByTitle(fbWeek, 'Full Body A');
    const changes = rescheduleWeek(
      fbWeek,
      { type: 'shorten', session_id: session.id, available_minutes: 35 },
      constraints(fbPlan, fbProfile, '2026-10-12'),
    );
    expect(changes).toHaveLength(1);
    const change = must(changes[0]);
    expect(change.kind).toBe('shorten');
    expect(change.new_est_minutes).toBeLessThanOrEqual(30);
    expect(change.reason).toMatch(/keeps the key exercises \(/);
    const applied = applyScheduleChanges(fbPlan, changes, applyOpts(fbProfile));
    const short = sessionByTitle(must(applied.weeks[0]), 'Full Body A');
    expect(short.variant).toBe('short');
    expect(short.est_minutes).toBe(change.new_est_minutes);
    expect(short.exercises.filter((pe) => pe.is_key).map((pe) => pe.id)).toEqual(
      session.exercises.filter((pe) => pe.is_key).map((pe) => pe.id),
    );
  });

  it('offers the minimum dose first when less than 16 minutes are available', () => {
    const session = sessionByTitle(fbWeek, 'Full Body B');
    const proposals = proposeReschedules(
      fbWeek,
      { type: 'shorten', session_id: session.id, available_minutes: 12 },
      constraints(fbPlan, fbProfile, '2026-10-14'),
    );
    expect(proposals.map((p) => p.kind)).toEqual(['shorten', 'skip']);
    const change = must(proposals[0]?.changes[0]);
    expect(change.new_est_minutes).toBeGreaterThanOrEqual(10);
    expect(change.new_est_minutes).toBeLessThanOrEqual(15);
    expect(change.reason).toMatch(/minimum-dose circuit keeps your streak alive/);
    const applied = applyScheduleChanges(fbPlan, [change], applyOpts(fbProfile));
    const dose = sessionByTitle(must(applied.weeks[0]), 'Full Body B');
    expect(dose.variant).toBe('minimum_dose');
    expect(dose.est_minutes).toBe(change.new_est_minutes);
  });

  it('changes nothing when the full session fits the available time', () => {
    const session = sessionByTitle(fbWeek, 'Full Body A');
    expect(
      rescheduleWeek(
        fbWeek,
        { type: 'shorten', session_id: session.id, available_minutes: session.est_minutes },
        constraints(fbPlan, fbProfile, '2026-10-12'),
      ),
    ).toEqual([]);
  });

  it('skips on request and offers the minimum dose as an alternative', () => {
    const session = sessionByTitle(fbWeek, 'Full Body C');
    const proposals = proposeReschedules(
      fbWeek,
      { type: 'skip', session_id: session.id },
      constraints(fbPlan, fbProfile, '2026-10-16'),
    );
    expect(proposals.map((p) => p.kind)).toEqual(['skip', 'shorten']);
    expect(proposals[0]?.changes[0]?.reason).toMatch(/skipped this week\. No guilt/);
  });
});

describe('rescheduling properties over many plans and events', () => {
  const random = seededRandom(42);
  const scenarios = Array.from({ length: 120 }, (_, i) => {
    const days = 1 + Math.floor(random() * 5);
    const available: Weekday[] = subset(random, WEEKDAYS);
    for (const day of WEEKDAYS) {
      if (available.length < days && !available.includes(day)) {
        available.push(day);
      }
    }
    const profile = makeProfile({
      days_per_week: days,
      available_days: available,
      training_slots: [],
      equipment: pick(random, [
        [],
        ['dumbbells'],
        ['dumbbells', 'bench', 'pullup_bar'],
      ] as const).slice(),
      limitations: subset(random, BODY_REGIONS),
      session_minutes: pick(random, [20, 30, 45, 60]),
    });
    const plan = planFor(profile, undefined, i + 1);
    const weekIndex = Math.floor(random() * plan.weeks.length);
    const week = must(plan.weeks[weekIndex]);
    const session = pick(random, week.sessions);
    const today = addDays(week.start_date, Math.floor(random() * 8));
    const event: RescheduleEvent = pick(random, [
      { type: 'missed', session_id: session.id },
      { type: 'skip', session_id: session.id },
      { type: 'shorten', session_id: session.id, available_minutes: 5 + Math.floor(random() * 40) },
    ] as const);
    const neighbors = [plan.weeks[weekIndex - 1], plan.weeks[weekIndex + 1]].flatMap(
      (w) => w?.sessions ?? [],
    );
    return { profile, plan, week, event, today, neighbors };
  });

  it('every proposal is valid, stays in the week and adds no same-muscle back-to-back days', () => {
    for (const { profile, plan, week, event, today, neighbors } of scenarios) {
      const proposals = proposeReschedules(
        week,
        event,
        constraints(plan, profile, today, { neighborSessions: neighbors }),
      );
      for (const proposal of proposals) {
        for (const change of proposal.changes) {
          expect(ScheduleChangeSchema.safeParse(change).success).toBe(true);
          expect(change.reason.length).toBeGreaterThan(20);
          if (change.to_date !== undefined) {
            expect(isWithinWeek(change.to_date, week.start_date)).toBe(true);
            expect(daysBetween(today, change.to_date)).toBeGreaterThanOrEqual(0);
          }
        }
        const applied = applyScheduleChanges(plan, proposal.changes, applyOpts(profile));
        expect(validators.Plan.safeParse(applied).success).toBe(true);
        const before = new Set(
          consecutiveMuscleConflicts([...week.sessions, ...neighbors], lookup).map(
            (c) => `${c.firstSessionId}>${c.secondSessionId}`,
          ),
        );
        const appliedWeek = must(applied.weeks.find((w) => w.id === week.id));
        for (const conflict of consecutiveMuscleConflicts(
          [...appliedWeek.sessions, ...neighbors],
          lookup,
        )) {
          expect(before.has(`${conflict.firstSessionId}>${conflict.secondSessionId}`)).toBe(true);
        }
      }
    }
  });

  it('shortened sessions are at most 30 minutes and contain every key exercise', () => {
    for (const { plan } of scenarios.slice(0, 40)) {
      for (const session of plan.weeks.flatMap((w) => w.sessions)) {
        for (const limit of [16, 20, 25, 30]) {
          const short = shortenSession(session, limit);
          if (!short) {
            continue;
          }
          expect(short.est_minutes).toBeLessThanOrEqual(limit);
          const keyIds = session.exercises.filter((pe) => pe.is_key).map((pe) => pe.exercise_id);
          expect(short.exercises.map((pe) => pe.exercise_id)).toEqual(
            expect.arrayContaining(keyIds),
          );
          expect(validators.PlannedSession.safeParse(short).success).toBe(true);
        }
      }
    }
  });

  it('the minimum dose is 10-15 minutes and respects equipment and limitations', () => {
    for (const { plan, profile } of scenarios) {
      for (const session of must(plan.weeks[0]).sessions) {
        const dose = minimumDoseSession(session, { profile, newId: createSeededIdGenerator(5) });
        expect(dose.est_minutes).toBeGreaterThanOrEqual(10);
        expect(dose.est_minutes).toBeLessThanOrEqual(15);
        expect(dose.variant).toBe('minimum_dose');
        expect(validators.PlannedSession.safeParse(dose).success).toBe(true);
        for (const pe of dose.exercises) {
          const exercise = lookup(pe.exercise_id);
          expect(isExerciseAvailable(exercise, profile.equipment)).toBe(true);
          expect(exercise.contraindication_tags.some((t) => profile.limitations.includes(t))).toBe(
            false,
          );
        }
      }
    }
  });
});

describe('minimumDoseSession', () => {
  it('builds from the key exercises when possible, as a circuit', () => {
    const session = sessionByTitle(fbWeek, 'Full Body A');
    const dose = minimumDoseSession(session, {
      profile: fbProfile,
      newId: createSeededIdGenerator(5),
    });
    const keyIds = session.exercises.filter((pe) => pe.is_key).map((pe) => pe.id);
    expect(dose.exercises.map((pe) => pe.id)).toEqual(keyIds);
    expect(new Set(dose.exercises.map((pe) => pe.superset_group))).toEqual(new Set(['MD']));
    expect(dose.id).toBe(session.id);
  });

  it('falls back to catalog bodyweight exercises when the key lifts are no longer possible', () => {
    const session = sessionByTitle(fbWeek, 'Full Body A');
    const profile = { equipment: [], limitations: ['knee', 'wrist'] } as const;
    const dose = minimumDoseSession(session, {
      profile: { equipment: [...profile.equipment], limitations: [...profile.limitations] },
      newId: createSeededIdGenerator(5),
    });
    for (const pe of dose.exercises) {
      const exercise = lookup(pe.exercise_id);
      expect(exercise.equipment).toEqual(['bodyweight']);
      expect(exercise.contraindication_tags).not.toContain('knee');
      expect(exercise.contraindication_tags).not.toContain('wrist');
      expect(exercise.low_stimulus).toBe(false);
    }
    expect(dose.est_minutes).toBeGreaterThanOrEqual(10);
  });
});

describe('applyScheduleChanges', () => {
  const session = sessionByTitle(fbWeek, 'Full Body A');
  const move = must(
    rescheduleWeek(
      fbWeek,
      { type: 'missed', session_id: session.id },
      constraints(fbPlan, fbProfile, '2026-10-13'),
    )[0],
  );

  it('returns a new valid plan and leaves the input untouched', () => {
    const snapshot = structuredClone(fbPlan);
    const applied = applyScheduleChanges(fbPlan, [move], applyOpts(fbProfile));
    expect(fbPlan).toEqual(snapshot);
    const moved = sessionByTitle(must(applied.weeks[0]), 'Full Body A');
    expect(moved).toMatchObject({ status: 'moved', scheduled_date: '2026-10-18', day_index: 0 });
  });

  it('merges key exercises into the absorbing session with new ids', () => {
    const lowerA = sessionByTitle(ulWeek, 'Lower A');
    const proposals = proposeReschedules(
      ulWeek,
      { type: 'missed', session_id: lowerA.id },
      constraints(ulPlan, ulProfile, '2026-10-14'),
    );
    const merge = must(proposals.find((p) => p.kind === 'merge'));
    const applied = applyScheduleChanges(ulPlan, merge.changes, applyOpts(ulProfile));
    const week = must(applied.weeks[0]);
    expect(sessionByTitle(week, 'Lower A').status).toBe('merged');
    const absorbing = sessionByTitle(week, 'Lower B');
    const borrowed = lowerA.exercises.filter(
      (pe) =>
        pe.is_key &&
        !sessionByTitle(ulWeek, 'Lower B').exercises.some((o) => o.exercise_id === pe.exercise_id),
    );
    for (const pe of borrowed) {
      const copy = must(absorbing.exercises.find((o) => o.exercise_id === pe.exercise_id));
      expect(copy.id).not.toBe(pe.id);
      expect(copy.is_key).toBe(true);
    }
    expect(absorbing.exercises.filter((pe) => !pe.is_key).length).toBeLessThanOrEqual(
      sessionByTitle(ulWeek, 'Lower B').exercises.filter((pe) => !pe.is_key).length,
    );
  });

  it('rejects stale, foreign and invalid changes', () => {
    const opts = applyOpts(fbProfile);
    expect(() =>
      applyScheduleChanges(fbPlan, [{ ...move, from_date: '2026-10-13' }], opts),
    ).toThrow(/expects/);
    expect(() =>
      applyScheduleChanges(
        fbPlan,
        [{ ...move, plan_id: '00000000-0000-4000-8000-0000000000aa' }],
        opts,
      ),
    ).toThrow(/belongs to plan/);
    expect(() => applyScheduleChanges(fbPlan, [{ ...move, to_date: '2026-10-19' }], opts)).toThrow(
      /outside the week/,
    );
    expect(() => applyScheduleChanges(fbPlan, [{ ...move, to_date: '2026-10-14' }], opts)).toThrow(
      /another session/,
    );
    const skip = {
      ...must(
        rescheduleWeek(
          fbWeek,
          { type: 'skip', session_id: session.id },
          constraints(fbPlan, fbProfile, '2026-10-12'),
        )[0],
      ),
    };
    const skipped = applyScheduleChanges(fbPlan, [skip], opts);
    expect(() => applyScheduleChanges(skipped, [move], opts)).toThrow(/skipped/);
  });

  it('replacePlannedSession stores a directly built session', () => {
    const dose = minimumDoseSession(session, {
      profile: fbProfile,
      newId: createSeededIdGenerator(5),
    });
    const replaced = replacePlannedSession(fbPlan, dose);
    expect(sessionByTitle(must(replaced.weeks[0]), 'Full Body A').variant).toBe('minimum_dose');
  });
});
