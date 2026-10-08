import { createSeededIdGenerator, ScheduleChangeSchema } from '@fitness/engine';
import { describe, expect, it } from 'vitest';
import {
  acceptProposal,
  completeOnboarding,
  localToday,
  minimumDoseProposal,
  regeneratePlan,
  rescheduleProposals,
} from './actions';
import { at, completedDraft, NOW, onboardedPlan, TIMEZONE, must } from '../test/fixtures';
import { findSession, sessionsByDate } from './plan-view';

const { plan, outcome } = onboardedPlan();
const profile = outcome.profile;
const [first, second] = sessionsByDate(must(plan.weeks[0]));

describe('localToday', () => {
  it('uses the profile time zone', () => {
    expect(localToday('2026-10-11T22:30:00.000Z', 'Europe/Bratislava')).toBe('2026-10-12');
    expect(localToday('2026-10-11T22:30:00.000Z', 'UTC')).toBe('2026-10-11');
  });
});

describe('rescheduling a missed session', () => {
  const dayAfter = must(second).scheduled_date; // the first session was missed
  const ctx = { now: at(dayAfter, '08:00:00'), newId: createSeededIdGenerator(5) };

  it('returns engine proposals with plain-English reasons, ending with skip', () => {
    const proposals = rescheduleProposals(
      plan,
      profile,
      { type: 'missed', session_id: must(first).id },
      ctx,
    );
    expect(proposals.length).toBeGreaterThan(1);
    expect(proposals[proposals.length - 1]?.kind).toBe('skip');
    for (const proposal of proposals) {
      for (const change of proposal.changes) {
        expect(ScheduleChangeSchema.parse(change)).toEqual(change);
        expect(change.reason).toMatch(/[A-Za-z]/);
        expect(change.created_by).toBe('user');
      }
    }
    // A proposal can hold several changes (e.g. a key session taking another session's slot).
    expect(proposals[0]?.changes.map((change) => change.reason).join(' ')).toContain('You missed');
  });

  it('applies the accepted proposal with applyScheduleChanges', () => {
    const proposals = rescheduleProposals(
      plan,
      profile,
      { type: 'missed', session_id: must(first).id },
      ctx,
    );
    const skip = must(proposals.find((proposal) => proposal.kind === 'skip'));
    const result = acceptProposal(plan, profile, skip, ctx);
    expect(findSession(result.plan, must(first).id)?.session.status).toBe('skipped');
    expect(result.changes).toEqual(skip.changes);
    // The input plan is not modified.
    expect(findSession(plan, must(first).id)?.session.status).toBe('planned');
  });

  it('throws for an unknown session', () => {
    expect(() =>
      rescheduleProposals(
        plan,
        profile,
        { type: 'missed', session_id: '00000000-0000-4000-8000-000000000000' },
        ctx,
      ),
    ).toThrow(/not in the plan/);
  });
});

describe('minimum dose', () => {
  it('turns a session into a 10-15 minute circuit', () => {
    const ctx = {
      now: at(must(first).scheduled_date, '07:00:00'),
      newId: createSeededIdGenerator(6),
    };
    const proposal = minimumDoseProposal(plan, profile, must(first).id, ctx);
    expect(proposal?.kind).toBe('shorten');
    expect(proposal?.changes[0]?.reason).toMatch(/minimum-dose/);
    const { plan: updated } = acceptProposal(plan, profile, must(proposal), ctx);
    const session = must(findSession(updated, must(first).id)).session;
    expect(session.variant).toBe('minimum_dose');
    expect(session.est_minutes).toBeGreaterThanOrEqual(10);
    expect(session.est_minutes).toBeLessThanOrEqual(15);
  });

  it('returns null when the session already fits in 15 minutes', () => {
    const short = onboardedPlan({ sessionMinutes: 15 });
    const session = must(sessionsByDate(must(short.plan.weeks[0]))[0]);
    const ctx = { now: at(session.scheduled_date, '07:00:00'), newId: createSeededIdGenerator(8) };
    expect(session.est_minutes).toBeLessThanOrEqual(15);
    expect(minimumDoseProposal(short.plan, short.outcome.profile, session.id, ctx)).toBeNull();
  });
});

describe('editing answers and regenerating', () => {
  it('keeps the user id and the goal id when the goal type is unchanged', () => {
    const newId = createSeededIdGenerator(11);
    const edited = completeOnboarding(
      completedDraft({ daysPerWeek: 2, goalTarget: 'Run for the bus' }),
      { profile, goal: outcome.goal },
      { now: NOW, timezone: TIMEZONE, newId },
    );
    expect(edited.profile.user_id).toBe(profile.user_id);
    expect(edited.goal.id).toBe(outcome.goal.id);
    expect(edited.goal.target).toBe('Run for the bus');
    expect(edited.result.ok && edited.result.plan.weeks[0]?.sessions).toHaveLength(2);
  });

  it('creates a new goal when the type changes', () => {
    const edited = completeOnboarding(
      completedDraft({ goalType: 'strength' }),
      { profile, goal: outcome.goal },
      { now: NOW, timezone: TIMEZONE, newId: createSeededIdGenerator(12) },
    );
    expect(edited.goal.id).not.toBe(outcome.goal.id);
  });

  it('regenerates a plan with new ids', () => {
    const result = regeneratePlan(profile, outcome.goal, {
      now: NOW,
      newId: createSeededIdGenerator(13),
    });
    expect(result.ok && result.plan.id).not.toBe(plan.id);
  });
});
