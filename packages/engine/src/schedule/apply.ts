import { EXERCISE_CATALOG } from '../catalog/index.js';
import { isWithinWeek } from '../dates.js';
import type { IdGenerator } from '../ids.js';
import { occupiesDate } from '../plan/rules.js';
import { DURATION_TOLERANCE } from '../plan/templates.js';
import {
  ScheduleChangeSchema,
  createCatalogValidators,
  type Exercise,
  type Plan,
  type PlannedSession,
  type PlanWeek,
  type Profile,
  type ScheduleChange,
} from '../schemas/index.js';
import {
  MINIMUM_DOSE_MINUTES,
  mergeSessionExercises,
  minimumDoseSession,
  shortenSession,
} from './session-variants.js';

export interface ApplyScheduleOptions {
  /** Ids for exercises copied by a merge or added by a minimum dose. */
  newId: IdGenerator;
  /** Equipment and limitations for minimum-dose sessions; session length caps merges. */
  profile: Pick<Profile, 'equipment' | 'limitations' | 'session_minutes'>;
  catalog?: readonly Exercise[];
}

/**
 * Applies schedule changes in order and returns a new plan (the input is not modified). The
 * result is validated with the catalog validators, so it always satisfies the plan schema.
 * - move: `scheduled_date` = `to_date` (same week, a free day), status `moved`.
 * - skip: status `skipped`.
 * - merge: status `merged`; the absorbing session (same week, planned or moved) gets the content
 *   from `mergeSessionExercises`, within `session_minutes` + 10%.
 * - shorten: `new_est_minutes` <= 15 builds the minimum dose (`minimumDoseSession`) within
 *   `new_est_minutes`, otherwise the short variant (`shortenSession`) within `new_est_minutes`.
 * Throws on a change for another plan, an unknown session, a session that is already done,
 * skipped or merged, a stale `from_date`, or a move outside the week or onto a taken day.
 */
export function applyScheduleChanges(
  plan: Plan,
  changes: readonly ScheduleChange[],
  opts: ApplyScheduleOptions,
): Plan {
  const catalog = opts.catalog ?? EXERCISE_CATALOG;
  const validators = createCatalogValidators(catalog);
  const next = clonePlain(validators.Plan.parse(plan));
  for (const input of changes) {
    const change = ScheduleChangeSchema.parse(input);
    if (change.plan_id !== next.id) {
      throw new Error(`Change ${change.id} belongs to plan ${change.plan_id}, not ${next.id}`);
    }
    const { week, index } = findSession(next, change.planned_session_id);
    const session = week.sessions[index];
    if (!session) {
      throw new Error(`Session ${change.planned_session_id} not found`);
    }
    assertReschedulable(session);
    if (session.scheduled_date !== change.from_date) {
      throw new Error(
        `Change ${change.id} expects ${session.title} on ${change.from_date}, but it is on ${session.scheduled_date}`,
      );
    }
    week.sessions[index] = applyOne(week, session, change, opts, catalog);
  }
  return validators.Plan.parse(next);
}

function applyOne(
  week: PlanWeek,
  session: PlannedSession,
  change: ScheduleChange,
  opts: ApplyScheduleOptions,
  catalog: readonly Exercise[],
): PlannedSession {
  switch (change.kind) {
    case 'move': {
      const to = required(change.to_date, 'to_date');
      if (!isWithinWeek(to, week.start_date)) {
        throw new Error(
          `Cannot move ${session.title} to ${to}: outside the week of ${week.start_date}`,
        );
      }
      const taken = week.sessions.some(
        (s) => s.id !== session.id && occupiesDate(s) && s.scheduled_date === to,
      );
      if (taken) {
        throw new Error(`Cannot move ${session.title} to ${to}: another session is on that day`);
      }
      return { ...session, scheduled_date: to, status: 'moved' };
    }
    case 'skip':
      return { ...session, status: 'skipped' };
    case 'merge': {
      const targetId = required(change.merged_into_session_id, 'merged_into_session_id');
      const targetIndex = week.sessions.findIndex((s) => s.id === targetId);
      const target = week.sessions[targetIndex];
      if (!target) {
        throw new Error(`Merge target ${targetId} is not in the same week as ${session.title}`);
      }
      assertReschedulable(target);
      week.sessions[targetIndex] = mergeSessionExercises(target, session, {
        newId: opts.newId,
        maxMinutes: Math.floor(opts.profile.session_minutes * (1 + DURATION_TOLERANCE)),
        catalog,
      }).session;
      return { ...session, status: 'merged' };
    }
    case 'shorten': {
      const minutes = required(change.new_est_minutes, 'new_est_minutes');
      if (minutes <= MINIMUM_DOSE_MINUTES.max) {
        return minimumDoseSession(session, {
          profile: opts.profile,
          newId: opts.newId,
          catalog,
          maxMinutes: Math.max(minutes, MINIMUM_DOSE_MINUTES.min),
        });
      }
      const short = shortenSession(session, minutes, catalog);
      if (!short) {
        throw new Error(`The key exercises of ${session.title} do not fit in ${minutes} minutes`);
      }
      return short;
    }
  }
}

/**
 * Replaces one session (matched by id) and returns a new, validated plan. Use it to store a
 * session built directly, e.g. by `minimumDoseSession`.
 */
export function replacePlannedSession(
  plan: Plan,
  session: PlannedSession,
  catalog: readonly Exercise[] = EXERCISE_CATALOG,
): Plan {
  const validators = createCatalogValidators(catalog);
  const next = clonePlain(validators.Plan.parse(plan));
  const { week, index } = findSession(next, session.id);
  week.sessions[index] = clonePlain(session);
  return validators.Plan.parse(next);
}

function findSession(plan: Plan, sessionId: string): { week: PlanWeek; index: number } {
  for (const week of plan.weeks) {
    const index = week.sessions.findIndex((s) => s.id === sessionId);
    if (index !== -1) {
      return { week, index };
    }
  }
  throw new Error(`Session ${sessionId} is not in plan ${plan.id}`);
}

function assertReschedulable(session: PlannedSession): void {
  if (session.status !== 'planned' && session.status !== 'moved') {
    throw new Error(`${session.title} (${session.id}) is ${session.status} and cannot change`);
  }
}

function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new Error(`${field} is required`);
  }
  return value;
}

/**
 * Deep copy of plain JSON data (plans and sessions contain only strings, numbers, booleans,
 * arrays and objects). `structuredClone` is not part of the ES2022 library this package targets.
 */
function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
