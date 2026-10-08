import { z } from 'zod';
import { EXERCISE_CATALOG } from '../catalog/index.js';
import { createCatalogLookup } from '../catalog/lookup.js';
import { addDays, daysBetween, weekdayIndex } from '../dates.js';
import type { IdGenerator } from '../ids.js';
import { occupiesDate, sessionMuscles, sharesMuscles } from '../plan/rules.js';
import {
  ChangeAuthorSchema,
  IdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  ScheduleChangeSchema,
  WEEKDAYS,
  createCatalogValidators,
  type ChangeAuthor,
  type Exercise,
  type IsoDate,
  type IsoDateTime,
  type MuscleGroup,
  type PlannedSession,
  type PlanWeek,
  type Profile,
  type ScheduleChange,
  type ScheduleChangeKind,
} from '../schemas/index.js';
import {
  SHORT_SESSION_MAX_MINUTES,
  SHORT_SESSION_MIN_MINUTES,
  minimumDoseSession,
  shortenSession,
} from './session-variants.js';

export const RescheduleEventSchema = z.discriminatedUnion('type', [
  /** The session was missed (or the user knows they cannot make it on its date). */
  z.object({ type: z.literal('missed'), session_id: IdSchema }),
  /** The user wants to skip the session this week. */
  z.object({ type: z.literal('skip'), session_id: IdSchema }),
  /** The user only has `available_minutes` for the session. */
  z.object({
    type: z.literal('shorten'),
    session_id: IdSchema,
    available_minutes: z.int().min(1).max(240),
  }),
]);
export type RescheduleEvent = z.infer<typeof RescheduleEventSchema>;

export interface RescheduleConstraints {
  plan_id: string;
  /** The user's local date; sessions are never moved to an earlier date. */
  today: IsoDate;
  /** `created_at` of the changes. */
  now: IsoDateTime;
  newId: IdGenerator;
  /** Moves only use available days; the minimum dose respects equipment and limitations. */
  profile: Pick<Profile, 'available_days' | 'equipment' | 'limitations'>;
  catalog?: readonly Exercise[];
  /**
   * Sessions of the previous and next weeks. They never receive changes, but they count as
   * neighbours, so a move to Sunday respects next Monday's session (and Monday last Sunday's).
   */
  neighborSessions?: readonly PlannedSession[];
  /** Default `system`. */
  created_by?: ChangeAuthor;
}

/** One way to resolve the event. All changes of a proposal are applied together. */
export interface ScheduleProposal {
  kind: ScheduleChangeKind;
  changes: ScheduleChange[];
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayName = (date: IsoDate) => DAY_NAMES[weekdayIndex(date)] ?? date;

/**
 * Proposals for a missed, skipped or time-limited session (feature C), best first. Rules:
 * - Changes never cross the week boundary (`to_date` stays in the session's week, never before
 *   `today`, only on `available_days` and never on a day that already has a session).
 * - A move or merge never puts two sessions that share a primary muscle group on consecutive
 *   days (sessions that are planned, moved or done count; skipped and merged ones do not).
 * - Key sessions get priority: a missed key session may take the slot of a later non-key
 *   session (that one is skipped), and merges keep only key exercises.
 * - A shortened session is at most 30 minutes and keeps every `is_key` exercise; with less than
 *   16 minutes the 10-15 minute minimum dose is offered instead.
 * - Skip is always the last option; when nothing else fits in the week (e.g. a missed last-day
 *   session) the reason says so.
 * Returns proposals best first; empty only for a `shorten` event when the full session fits.
 * Order for `missed`: key sessions move > take a non-key slot > merge > skip; normal sessions
 * move > merge > skip; optional sessions skip > move > merge.
 */
export function proposeReschedules(
  weekInput: PlanWeek,
  eventInput: RescheduleEvent,
  constraints: RescheduleConstraints,
): ScheduleProposal[] {
  const catalog = constraints.catalog ?? EXERCISE_CATALOG;
  const validators = createCatalogValidators(catalog);
  const week = validators.PlanWeek.parse(weekInput);
  const event = RescheduleEventSchema.parse(eventInput);
  const neighborSessions = (constraints.neighborSessions ?? []).map((session) =>
    validators.PlannedSession.parse(session),
  );
  const ctx = buildContext(week, event.session_id, { ...constraints, neighborSessions }, catalog);

  switch (event.type) {
    case 'missed':
      return missedProposals(ctx);
    case 'skip':
      return [
        ctx.proposal('skip', [
          ctx.change(ctx.session, 'skip', {
            reason: `${ctx.session.title} is skipped this week. No guilt: your progression picks up at your next session.`,
          }),
        ]),
        ...minimumDoseProposals(ctx, undefined),
      ];
    case 'shorten':
      return shortenProposals(ctx, event.available_minutes);
  }
}

/**
 * The recommended changes for the event: the first proposal of `proposeReschedules`. Empty when
 * nothing needs to change (a `shorten` event with enough time for the full session).
 */
export function rescheduleWeek(
  week: PlanWeek,
  event: RescheduleEvent,
  constraints: RescheduleConstraints,
): ScheduleChange[] {
  const [best] = proposeReschedules(week, event, constraints);
  return best ? best.changes : [];
}

interface Context {
  week: PlanWeek;
  session: PlannedSession;
  constraints: RescheduleConstraints;
  catalog: readonly Exercise[];
  muscles: (session: Pick<PlannedSession, 'exercises'>) => Set<MuscleGroup>;
  exerciseName: (id: string) => string;
  change: (
    session: PlannedSession,
    kind: ScheduleChangeKind,
    fields: Partial<
      Pick<ScheduleChange, 'to_date' | 'merged_into_session_id' | 'new_est_minutes'>
    > & {
      reason: string;
    },
  ) => ScheduleChange;
  proposal: (kind: ScheduleChangeKind, changes: ScheduleChange[]) => ScheduleProposal;
}

function buildContext(
  week: PlanWeek,
  sessionId: string,
  constraints: RescheduleConstraints,
  catalog: readonly Exercise[],
): Context {
  IdSchema.parse(constraints.plan_id);
  IsoDateSchema.parse(constraints.today);
  const createdAt = IsoDateTimeSchema.parse(constraints.now);
  const createdBy = ChangeAuthorSchema.parse(constraints.created_by ?? 'system');
  const session = week.sessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} is not in week ${week.id}`);
  }
  if (session.status !== 'planned' && session.status !== 'moved') {
    throw new Error(`Session ${sessionId} is ${session.status} and cannot be rescheduled`);
  }
  const lookup = createCatalogLookup(catalog);
  return {
    week,
    session,
    constraints,
    catalog,
    muscles: (s) => sessionMuscles(s, lookup),
    exerciseName: (id) => lookup(id).name,
    change: (target, kind, fields) =>
      ScheduleChangeSchema.parse({
        id: constraints.newId(),
        plan_id: constraints.plan_id,
        planned_session_id: target.id,
        kind,
        from_date: target.scheduled_date,
        created_by: createdBy,
        created_at: createdAt,
        ...fields,
      }),
    proposal: (kind, changes) => ({ kind, changes }),
  };
}

/** Days of the session's week from `today` on (both inclusive of the week bounds). */
function remainingDates(ctx: Context): IsoDate[] {
  const dates: IsoDate[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(ctx.week.start_date, offset);
    if (daysBetween(ctx.constraints.today, date) >= 0) {
      dates.push(date);
    }
  }
  return dates;
}

/**
 * True when a session training `muscles` can sit on `date`: no other occupying session that
 * day, and none on the neighbouring days sharing a muscle. `ignore` lists sessions that will be
 * moved away or are the session itself.
 */
function dateIsSafe(
  ctx: Context,
  date: IsoDate,
  muscles: ReadonlySet<MuscleGroup>,
  ignore: readonly string[],
): boolean {
  const others = ctx.week.sessions.filter((s) => occupiesDate(s) && !ignore.includes(s.id));
  if (others.some((s) => s.scheduled_date === date)) {
    return false;
  }
  const neighbours = [...others, ...(ctx.constraints.neighborSessions ?? []).filter(occupiesDate)];
  return neighbours.every(
    (s) =>
      Math.abs(daysBetween(date, s.scheduled_date)) !== 1 ||
      !sharesMuscles(ctx.muscles(s), muscles),
  );
}

function missedProposals(ctx: Context): ScheduleProposal[] {
  const { session } = ctx;
  const muscles = ctx.muscles(session);
  const available = new Set(ctx.constraints.profile.available_days);
  const remaining = remainingDates(ctx);
  const candidates = remaining
    .filter(
      (date) =>
        date !== session.scheduled_date && available.has(WEEKDAYS[weekdayIndex(date)] ?? 'mon'),
    )
    .sort((a, b) => moveOrder(session.scheduled_date, a) - moveOrder(session.scheduled_date, b));
  const missedText = `You missed ${session.title} on ${dayName(session.scheduled_date)}.`;

  const moves: ScheduleProposal[] = [];
  const freeDate = candidates.find((date) => dateIsSafe(ctx, date, muscles, [session.id]));
  if (freeDate) {
    moves.push(
      ctx.proposal('move', [
        ctx.change(session, 'move', {
          to_date: freeDate,
          reason: `${missedText} It moves to ${dayName(freeDate)} (${freeDate}), which keeps it away from other sessions for the same muscles on the days next to it.`,
        }),
      ]),
    );
  }

  const displacements: ScheduleProposal[] = [];
  if (!freeDate && session.priority === 'key') {
    const displaceable = ctx.week.sessions.filter(
      (s) =>
        s.id !== session.id &&
        s.priority !== 'key' &&
        (s.status === 'planned' || s.status === 'moved') &&
        remaining.includes(s.scheduled_date) &&
        available.has(WEEKDAYS[weekdayIndex(s.scheduled_date)] ?? 'mon'),
    );
    const target = displaceable
      .sort((a, b) => daysBetween(b.scheduled_date, a.scheduled_date))
      .find((s) => dateIsSafe(ctx, s.scheduled_date, muscles, [session.id, s.id]));
    if (target) {
      displacements.push(
        // The skip comes first so the slot is free when the move is applied.
        ctx.proposal('move', [
          ctx.change(target, 'skip', {
            reason: `${target.title} is skipped this week to make room for the key session ${session.title}.`,
          }),
          ctx.change(session, 'move', {
            to_date: target.scheduled_date,
            reason: `${missedText} It is a key session, so it takes the ${dayName(target.scheduled_date)} slot of ${target.title}.`,
          }),
        ]),
      );
    }
  }

  const merges: ScheduleProposal[] = [];
  const keyExercises = session.exercises.filter((pe) => pe.is_key);
  if (keyExercises.length > 0) {
    const keyMuscles = ctx.muscles({ exercises: keyExercises });
    const absorber = ctx.week.sessions
      .filter(
        (s) =>
          s.id !== session.id &&
          (s.status === 'planned' || s.status === 'moved') &&
          remaining.includes(s.scheduled_date),
      )
      .sort((a, b) => daysBetween(b.scheduled_date, a.scheduled_date))
      .find((s) =>
        dateIsSafe(ctx, s.scheduled_date, new Set([...ctx.muscles(s), ...keyMuscles]), [
          session.id,
          s.id,
        ]),
      );
    if (absorber) {
      const names = keyExercises.map((pe) => ctx.exerciseName(pe.exercise_id)).join(', ');
      merges.push(
        ctx.proposal('merge', [
          ctx.change(session, 'merge', {
            merged_into_session_id: absorber.id,
            reason: `${missedText} Its key exercises (${names}) are added to ${absorber.title} on ${dayName(absorber.scheduled_date)}, which keeps only the key work from both sessions.`,
          }),
        ]),
      );
    }
  }

  const laterDays = remaining.filter((date) => daysBetween(session.scheduled_date, date) > 0);
  const skipReason =
    laterDays.length === 0
      ? `${missedText} That was the last day of this training week and sessions do not carry over into next week, so it is skipped. No guilt: your progression continues next week.`
      : moves.length + displacements.length + merges.length === 0
        ? `${missedText} There is no free day left this week that would not put two sessions for the same muscles back to back, so it is skipped. Your progression continues at your next session.`
        : `${missedText} You can also skip it guilt-free; your progression continues at your next session.`;
  const skip = ctx.proposal('skip', [ctx.change(session, 'skip', { reason: skipReason })]);

  switch (session.priority) {
    case 'key':
      return [...moves, ...displacements, ...merges, skip];
    case 'normal':
      return [...moves, ...merges, skip];
    case 'optional':
      return [skip, ...moves, ...merges];
  }
}

/** Later dates first (nearest first), then earlier dates (nearest first). */
function moveOrder(from: IsoDate, date: IsoDate): number {
  const offset = daysBetween(from, date);
  return offset > 0 ? offset : 7 - offset;
}

function shortenProposals(ctx: Context, availableMinutes: number): ScheduleProposal[] {
  const { session } = ctx;
  if (availableMinutes >= session.est_minutes) {
    return []; // the session already fits: nothing to change
  }
  const proposals: ScheduleProposal[] = [];
  if (availableMinutes >= SHORT_SESSION_MIN_MINUTES) {
    const limit = Math.min(SHORT_SESSION_MAX_MINUTES, availableMinutes);
    const short = shortenSession(session, limit, ctx.catalog);
    // A result under 16 minutes would be stored as a minimum dose, which that proposal covers.
    if (short && short.est_minutes >= SHORT_SESSION_MIN_MINUTES) {
      const keys = short.exercises
        .filter((pe) => pe.is_key)
        .map((pe) => ctx.exerciseName(pe.exercise_id));
      proposals.push(
        ctx.proposal('shorten', [
          ctx.change(session, 'shorten', {
            new_est_minutes: short.est_minutes,
            reason: `Short on time: a ${short.est_minutes}-minute version of ${session.title} keeps the key exercises${keys.length > 0 ? ` (${keys.join(', ')})` : ''} with fewer sets and shorter rests.`,
          }),
        ]),
      );
    }
  }
  proposals.push(...minimumDoseProposals(ctx, availableMinutes));
  proposals.push(
    ctx.proposal('skip', [
      ctx.change(session, 'skip', {
        reason: `${session.title} is skipped this week. No guilt: your progression picks up at your next session.`,
      }),
    ]),
  );
  return proposals;
}

function minimumDoseProposals(
  ctx: Context,
  availableMinutes: number | undefined,
): ScheduleProposal[] {
  const dose = minimumDoseSession(ctx.session, {
    profile: ctx.constraints.profile,
    newId: ctx.constraints.newId,
    catalog: ctx.catalog,
  });
  const lead =
    availableMinutes === undefined
      ? 'If you can find a few minutes'
      : `With ${availableMinutes} minutes`;
  return [
    ctx.proposal('shorten', [
      ctx.change(ctx.session, 'shorten', {
        new_est_minutes: dose.est_minutes,
        reason: `${lead}, a ${dose.est_minutes}-minute minimum-dose circuit keeps your streak alive. The key habit is to never miss twice in a row.`,
      }),
    ]),
  ];
}
