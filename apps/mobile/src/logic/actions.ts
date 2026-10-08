import {
  localDateOf,
  type Goal,
  type IdGenerator,
  type Plan,
  type Profile,
  type RescheduleEvent,
  type ScheduleChange,
  type ScheduleProposal,
  type WorkoutLog,
} from '@fitness/engine';
import {
  applyChanges,
  createPlan,
  proposalsFor,
  replaceSession,
  type PlanResult,
} from '../engine/engine-service';
import { buildGoal, buildProfile, type OnboardingDraft } from './onboarding';
import { findSession, neighborSessions } from './plan-view';

/** Clock, ids and zone: everything impure the actions need, injected for tests. */
export interface ActionContext {
  /** ISO instant. */
  now: string;
  newId: IdGenerator;
}

/** The user's local calendar date for an instant in their IANA zone. */
export function localToday(now: string, timezone: string): string {
  return localDateOf(now, timezone);
}

export interface OnboardingOutcome {
  profile: Profile;
  goal: Goal;
  /** The plan, or the engine's blocked result with the "consult a doctor" message. */
  result: PlanResult;
}

/**
 * Onboarding -> profile + goal -> plan. Keeps the existing user id (editing answers) and reuses
 * the goal id when the goal type is unchanged.
 */
export function completeOnboarding(
  draft: OnboardingDraft,
  existing: { profile: Profile | null; goal: Goal | null },
  ctx: ActionContext & { timezone: string },
): OnboardingOutcome {
  const userId = existing.profile?.user_id ?? ctx.newId();
  const profile = buildProfile(draft, { userId, now: ctx.now, timezone: ctx.timezone });
  const keepGoal = existing.goal?.user_id === userId && existing.goal.type === draft.goalType;
  const goal = buildGoal(draft, {
    id: keepGoal && existing.goal ? existing.goal.id : ctx.newId(),
    userId,
    now: keepGoal && existing.goal ? existing.goal.created_at : ctx.now,
  });
  return { profile, goal, result: regeneratePlan(profile, goal, ctx) };
}

/** A fresh plan for the saved profile and goal (Settings -> Regenerate plan). */
export function regeneratePlan(profile: Profile, goal: Goal, ctx: ActionContext): PlanResult {
  return createPlan(profile, goal, {
    today: localToday(ctx.now, profile.timezone),
    now: ctx.now,
    newId: ctx.newId,
  });
}

/** Marks the logged session as done (when it is still open) and returns the new plan. */
export function markSessionDone(plan: Plan, log: WorkoutLog): Plan {
  if (log.planned_session_id === undefined) {
    return plan;
  }
  const found = findSession(plan, log.planned_session_id);
  if (!found) {
    return plan;
  }
  const { session } = found;
  if (session.status !== 'planned' && session.status !== 'moved') {
    return plan;
  }
  return replaceSession(plan, { ...session, status: 'done' });
}

/** Rescheduling proposals from the engine for one session, best first. */
export function rescheduleProposals(
  plan: Plan,
  profile: Profile,
  event: RescheduleEvent,
  ctx: ActionContext,
): ScheduleProposal[] {
  const found = findSession(plan, event.session_id);
  if (!found) {
    throw new Error(`Session ${event.session_id} is not in the plan`);
  }
  return proposalsFor(found.week, event, {
    planId: plan.id,
    today: localToday(ctx.now, profile.timezone),
    now: ctx.now,
    newId: ctx.newId,
    profile,
    neighborSessions: neighborSessions(plan, found.week),
  });
}

/** Applies an accepted proposal; returns the new plan and the changes to store. */
export function acceptProposal(
  plan: Plan,
  profile: Profile,
  proposal: ScheduleProposal,
  ctx: Pick<ActionContext, 'newId'>,
): { plan: Plan; changes: ScheduleChange[] } {
  return {
    plan: applyChanges(plan, proposal.changes, { newId: ctx.newId, profile }),
    changes: proposal.changes,
  };
}

export const MINIMUM_DOSE_AVAILABLE_MINUTES = 15;

/**
 * The engine's minimum-dose (10-15 min) proposal for a session, or null when the session is
 * already that short.
 */
export function minimumDoseProposal(
  plan: Plan,
  profile: Profile,
  sessionId: string,
  ctx: ActionContext,
): ScheduleProposal | null {
  const proposals = rescheduleProposals(
    plan,
    profile,
    { type: 'shorten', session_id: sessionId, available_minutes: MINIMUM_DOSE_AVAILABLE_MINUTES },
    ctx,
  );
  return (
    proposals.find(
      (proposal) =>
        proposal.kind === 'shorten' &&
        proposal.changes.every(
          (change) => (change.new_est_minutes ?? Infinity) <= MINIMUM_DOSE_AVAILABLE_MINUTES,
        ),
    ) ?? null
  );
}
