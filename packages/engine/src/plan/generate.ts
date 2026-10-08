import { EXERCISE_CATALOG } from '../catalog/index.js';
import { createCatalogLookup } from '../catalog/lookup.js';
import { addDays, isMonday, nextMondayOnOrAfter, weekdayIndex } from '../dates.js';
import type { IdGenerator } from '../ids.js';
import {
  GoalSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  MUSCLE_GROUPS,
  ProfileRowSchema,
  WEEKDAYS,
  checkProfile,
  createCatalogValidators,
  type Exercise,
  type ExerciseMeasure,
  type ExperienceLevel,
  type Goal,
  type GoalType,
  type IsoDate,
  type IsoDateTime,
  type MuscleGroup,
  type Plan,
  type PlannedSession,
  type PlanWeek,
  type Profile,
} from '../schemas/index.js';
import { countsTowardVolume, sharesMuscles, validatePlanRules } from './rules.js';
import { screenProfile, type ScreeningResult } from './screening.js';
import { pickExercise, rankCandidates, type SelectionContext } from './select.js';
import { exerciseSeconds, secondsPerSet, secondsToEstMinutes, TIME_MODEL } from './session-time.js';
import {
  BASE_SETS,
  BEGINNER_STRENGTH_KEY,
  BLOCK_WEEKS,
  CONDITIONING_EXERCISES,
  DELOAD_SET_FACTOR,
  DELOAD_WEEK_INDEX,
  DURATION_TOLERANCE,
  MAX_SETS_PER_EXERCISE,
  PLAN_TEMPLATES,
  REP_SCHEMES,
  TARGET_RIR_BY_WEEK,
  TIMED_SCHEME,
  WEEK_FOCUS,
  WEEK_PHASES,
  WEEKLY_SET_CAPS,
  templateForDays,
  type SessionTemplate,
  type TemplateId,
} from './templates.js';

export interface GeneratePlanOptions {
  /** The user's local calendar date; used for the age gate and the default start date. */
  today: IsoDate;
  /** `created_at` of the plan. */
  now: IsoDateTime;
  newId: IdGenerator;
  /** Defaults to the seed catalog. */
  catalog?: readonly Exercise[];
  /** Monday of the first week. Defaults to the Monday on or after `today`. */
  startDate?: IsoDate;
}

export type BlockedPlanResult = Extract<ScreeningResult, { ok: false }>;
export type GeneratePlanResult =
  { ok: true; plan: Plan; templateId: TemplateId } | BlockedPlanResult;

/**
 * Generates a 6-week rule-based plan (feature A).
 *
 * - Screening first: on a PAR-Q+ red flag or a possibly-under-18 user it returns the blocked
 *   result (with the "consult a doctor" message) instead of a plan.
 * - Template by days per week (`templateForDays`); weeks 1-5 train, week 6 is a deload with
 *   ~40% fewer sets and RIR 4. Beginners train at RIR 3-4; nobody trains to failure.
 * - Exercises are filtered by the profile's actual equipment and limitations (see
 *   `rankCandidates`); key compound lifts are marked `is_key`. Target loads are left empty:
 *   the first logged session calibrates them (`nextTargets`).
 * - Sessions are fitted to `session_minutes` +/- 10% with the time model in `session-time.ts`,
 *   keeping weekly hard sets per muscle within `WEEKLY_SET_CAPS`. When the lifting volume cannot
 *   fill the time (short of the caps), the remainder becomes an easy conditioning finisher.
 * - Days: chosen from `available_days`, avoiding same-muscle sessions on consecutive days
 *   first, then preferring the user's `training_slots` days, then wider spacing.
 *
 * Invalid input (schema violations, goal of another user, start date not a Monday) throws.
 * The output is validated with the catalog validators and the rules validator before returning.
 */
export function generatePlan(
  profileInput: Profile,
  goalInput: Goal,
  opts: GeneratePlanOptions,
): GeneratePlanResult {
  const today = IsoDateSchema.parse(opts.today);
  const now = IsoDateTimeSchema.parse(opts.now);
  const profile = parseProfile(profileInput, today);
  const goal = GoalSchema.parse(goalInput);
  if (goal.user_id !== profile.user_id) {
    throw new Error('The goal belongs to a different user than the profile');
  }

  const screening = screenProfile(profile, today);
  if (!screening.ok) {
    return screening;
  }

  const catalog = opts.catalog ?? EXERCISE_CATALOG;
  const lookup = createCatalogLookup(catalog);
  const startDate = resolveStartDate(opts.startDate, today);
  const templateId = templateForDays(profile.days_per_week);
  const template = PLAN_TEMPLATES[templateId];
  const level = profile.experience_level;
  const ctx: SelectionContext = {
    catalog,
    equipment: profile.equipment,
    limitations: profile.limitations,
    level,
  };
  const budget = timeBudget(profile.session_minutes);
  const sessionsPerWeek = Math.min(profile.days_per_week, template.sessions.length);

  const drafts = template.sessions.map((st) => draftSession(st, goal.type, ctx));
  drafts.forEach((draft) => {
    fitToUpperBound(draft, budget);
  });
  enforceWeeklyCaps(drafts, WEEKLY_SET_CAPS[level]);
  fillSets(drafts, budget, MAX_SETS_PER_EXERCISE[level], WEEKLY_SET_CAPS[level]);
  drafts.forEach((draft) => {
    addFinisherIfShort(draft, budget, ctx);
  });
  const deloadDrafts = drafts.map((draft) => deloadOf(draft, budget, ctx));

  const days = chooseTrainingDays(
    profile,
    drafts.slice(0, sessionsPerWeek).map((draft) => draftMuscles(draft)),
  );

  const planId = opts.newId();
  const weeks: PlanWeek[] = [];
  for (let w = 0; w < BLOCK_WEEKS; w += 1) {
    const weekId = opts.newId();
    const weekStart = addDays(startDate, 7 * w);
    const source = w === DELOAD_WEEK_INDEX ? deloadDrafts : drafts;
    // With one training day the two Full Body sessions alternate week by week.
    const weekDrafts =
      sessionsPerWeek === 1 ? [source[w % source.length]] : source.slice(0, sessionsPerWeek);
    const sessions = weekDrafts.map((draft, i) => {
      if (!draft) {
        throw new Error('Template session missing');
      }
      const day = days[i] ?? 0;
      return buildSession(draft, {
        id: opts.newId(),
        weekId,
        day,
        date: addDays(weekStart, day),
        targetRir: rirFor(level, w),
        newId: opts.newId,
      });
    });
    weeks.push({
      id: weekId,
      plan_id: planId,
      index: w,
      start_date: weekStart,
      phase: WEEK_PHASES[w] ?? 'accumulation',
      focus: WEEK_FOCUS[w],
      sessions,
    });
  }

  const plan: Plan = {
    id: planId,
    user_id: profile.user_id,
    goal_id: goal.id,
    template_id: templateId,
    version: 1,
    status: 'active',
    start_date: startDate,
    generated_by: 'rules',
    rationale_text: rationale(profile, goal.type, templateId, sessionsPerWeek),
    created_at: now,
    weeks,
  };

  const validated = createCatalogValidators(catalog).Plan.parse(plan);
  const issues = validatePlanRules(validated, profile, lookup);
  if (issues.length > 0) {
    throw new Error(
      `Generated plan breaks rules: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
    );
  }
  return { ok: true, plan: validated, templateId };
}

/**
 * Validates the profile without reading the clock: `checkProfile` compares `birth_year` with
 * the current year, so the year is clamped here and compared with `today` instead.
 */
function parseProfile(input: Profile, today: IsoDate): Profile {
  const todayYear = Number(today.slice(0, 4));
  return ProfileRowSchema.superRefine((profile, ctx) => {
    checkProfile({ ...profile, birth_year: Math.min(profile.birth_year, todayYear) }, ctx);
    if (profile.birth_year > todayYear) {
      ctx.addIssue({
        code: 'custom',
        path: ['birth_year'],
        message: 'birth_year is in the future',
      });
    }
  }).parse(input);
}

function resolveStartDate(startDate: IsoDate | undefined, today: IsoDate): IsoDate {
  if (startDate === undefined) {
    return nextMondayOnOrAfter(today);
  }
  const parsed = IsoDateSchema.parse(startDate);
  if (!isMonday(parsed)) {
    throw new Error(`startDate ${parsed} must be a Monday`);
  }
  return parsed;
}

function rirFor(level: ExperienceLevel, weekIndex: number): number {
  const rir = TARGET_RIR_BY_WEEK[level][weekIndex];
  if (rir === undefined) {
    throw new Error(`No target RIR for week ${weekIndex}`);
  }
  return rir;
}

// ---------------------------------------------------------------------------
// Drafts: template sessions before ids, dates and weekly RIR are assigned
// ---------------------------------------------------------------------------

interface DraftExercise {
  exercise: Exercise;
  is_key: boolean;
  /** Conditioning finisher used to fill time (not a hard set). */
  conditioning: boolean;
  sets: number;
  measure: ExerciseMeasure;
  rep_min: number;
  rep_max: number;
  rest_sec: number;
}

interface DraftSession {
  template: SessionTemplate;
  exercises: DraftExercise[];
}

interface TimeBudget {
  targetSec: number;
  /** Bounds in seconds, 30 s inside the +/- 10% band so rounding to minutes stays inside. */
  lowerSec: number;
  upperSec: number;
}

function timeBudget(sessionMinutes: number): TimeBudget {
  const targetSec = sessionMinutes * 60;
  return {
    targetSec,
    lowerSec: Math.ceil(targetSec * (1 - DURATION_TOLERANCE) + 30),
    upperSec: Math.floor(targetSec * (1 + DURATION_TOLERANCE) - 30),
  };
}

function draftSeconds(draft: DraftSession): number {
  return draft.exercises.reduce(
    (total, de) => total + exerciseSeconds(de, de.exercise),
    TIME_MODEL.warmupSec.full,
  );
}

function prescribe(exercise: Exercise, isKey: boolean, goal: GoalType, level: ExperienceLevel) {
  const scheme =
    exercise.measure === 'seconds'
      ? TIMED_SCHEME
      : isKey && goal === 'strength' && level === 'beginner'
        ? BEGINNER_STRENGTH_KEY
        : REP_SCHEMES[goal][isKey ? 'key' : 'accessory'];
  return {
    exercise,
    is_key: isKey,
    conditioning: false,
    sets: isKey ? BASE_SETS.key : BASE_SETS.accessory,
    measure: exercise.measure,
    rep_min: scheme.rep_min,
    rep_max: scheme.rep_max,
    rest_sec: scheme.rest_sec,
  } satisfies DraftExercise;
}

function draftSession(
  template: SessionTemplate,
  goal: GoalType,
  ctx: SelectionContext,
): DraftSession {
  const used = new Set<string>();
  const exercises: DraftExercise[] = [];
  for (const slot of template.slots) {
    const exercise = pickExercise(slot, ctx, used);
    if (!exercise) {
      continue; // e.g. no biceps isolation without equipment, or every option contraindicated
    }
    used.add(exercise.id);
    exercises.push(prescribe(exercise, slot.key === true, goal, ctx.level));
  }
  const first = exercises[0];
  if (!first) {
    throw new Error(`No exercise fits "${template.title}" for this equipment and limitations`);
  }
  if (!exercises.some((de) => de.is_key)) {
    // Every key slot was filtered out: promote the first exercise so the session keeps a priority.
    exercises[0] = prescribe(first.exercise, true, goal, ctx.level);
  }
  return { template, exercises };
}

/** Drops trailing non-key exercises, then trims sets from the end, until the session fits. */
function fitToUpperBound(draft: DraftSession, budget: TimeBudget): void {
  while (draftSeconds(draft) > budget.upperSec && draft.exercises.length > 1) {
    const lastNonKey = findLastIndex(draft.exercises, (de) => !de.is_key);
    draft.exercises.splice(lastNonKey === -1 ? draft.exercises.length - 1 : lastNonKey, 1);
  }
  while (draftSeconds(draft) > budget.upperSec) {
    const trimmable = findLastIndex(draft.exercises, (de) => de.sets > 1);
    const target = draft.exercises[trimmable];
    if (!target) {
      throw new Error(`Cannot fit "${draft.template.title}" into the session time`);
    }
    target.sets -= 1;
  }
}

function weeklyTotals(drafts: readonly DraftSession[]): Map<MuscleGroup, number> {
  const totals = new Map<MuscleGroup, number>();
  for (const draft of drafts) {
    for (const de of draft.exercises) {
      if (!countsTowardVolume(de.exercise)) {
        continue;
      }
      for (const muscle of de.exercise.primary_muscles) {
        totals.set(muscle, (totals.get(muscle) ?? 0) + de.sets);
      }
    }
  }
  return totals;
}

/**
 * Reduces volume until every muscle is within the weekly cap: first sets of non-key exercises
 * (removing them at one set), then sets of key exercises. Deterministic: the muscle is chosen
 * in `MUSCLE_GROUPS` order and the exercise with the most sets (latest on ties).
 */
function enforceWeeklyCaps(drafts: DraftSession[], cap: number): void {
  for (;;) {
    const totals = weeklyTotals(drafts);
    const over = MUSCLE_GROUPS.find((muscle) => (totals.get(muscle) ?? 0) > cap);
    if (over === undefined) {
      return;
    }
    const contributors = drafts.flatMap((draft) =>
      draft.exercises
        .filter(
          (de) => countsTowardVolume(de.exercise) && de.exercise.primary_muscles.includes(over),
        )
        .map((de) => ({ draft, de })),
    );
    const pickMax = (list: typeof contributors) =>
      list.reduce<(typeof contributors)[number] | undefined>(
        (best, item) => (best === undefined || item.de.sets >= best.de.sets ? item : best),
        undefined,
      );
    const nonKey = pickMax(contributors.filter(({ de }) => !de.is_key));
    if (nonKey) {
      if (nonKey.de.sets > 1) {
        nonKey.de.sets -= 1;
      } else {
        nonKey.draft.exercises.splice(nonKey.draft.exercises.indexOf(nonKey.de), 1);
      }
      continue;
    }
    const key = pickMax(contributors.filter(({ de }) => de.sets > 1));
    if (!key) {
      throw new Error(`Cannot keep ${over} within the weekly cap of ${cap} sets`);
    }
    key.de.sets -= 1;
  }
}

/**
 * Adds sets towards the target duration, one set per session per pass (key exercises first),
 * without exceeding the upper time bound, the per-exercise maximum or the weekly caps.
 */
function fillSets(drafts: DraftSession[], budget: TimeBudget, maxSets: number, cap: number): void {
  const cursors = drafts.map(() => 0);
  let changed = true;
  while (changed) {
    changed = false;
    drafts.forEach((draft, d) => {
      const seconds = draftSeconds(draft);
      if (seconds >= budget.targetSec) {
        return;
      }
      const ordered = [
        ...draft.exercises.filter((de) => de.is_key),
        ...draft.exercises.filter((de) => !de.is_key),
      ];
      for (let attempt = 0; attempt < ordered.length; attempt += 1) {
        const index = ((cursors[d] ?? 0) + attempt) % ordered.length;
        const de = ordered[index];
        if (!de || de.conditioning || de.sets >= maxSets) {
          continue;
        }
        const extra = secondsPerSet(de, de.exercise);
        if (seconds + extra > budget.upperSec || !capAllows(drafts, de, cap)) {
          continue;
        }
        de.sets += 1;
        cursors[d] = index + 1;
        changed = true;
        return;
      }
    });
  }
}

function capAllows(drafts: readonly DraftSession[], de: DraftExercise, cap: number): boolean {
  if (!countsTowardVolume(de.exercise)) {
    return true;
  }
  const totals = weeklyTotals(drafts);
  return de.exercise.primary_muscles.every((muscle) => (totals.get(muscle) ?? 0) + 1 <= cap);
}

const MIN_FINISHER_SEC = 30;
const MAX_SECONDS_PER_FINISHER_SET = 3600;

/**
 * Fills the remaining time with an easy conditioning block (rest 0) when the lifting volume
 * cannot reach the lower bound. The block is sized to land on the target duration.
 */
function addFinisherIfShort(draft: DraftSession, budget: TimeBudget, ctx: SelectionContext): void {
  const seconds = draftSeconds(draft);
  if (seconds >= budget.lowerSec) {
    return;
  }
  const exercise = rankCandidates({ pattern: 'cardio' }, ctx).find((candidate) =>
    CONDITIONING_EXERCISES.includes(candidate.id),
  );
  if (!exercise) {
    throw new Error(`No conditioning exercise available to fill "${draft.template.title}"`);
  }
  const floor5 = (value: number) => Math.floor(value / 5) * 5;
  const total = Math.max(
    MIN_FINISHER_SEC,
    floor5(budget.targetSec - seconds - TIME_MODEL.transitionSec),
  );
  const sets = Math.ceil(total / MAX_SECONDS_PER_FINISHER_SET);
  const perSet = floor5(total / sets);
  draft.exercises.push({
    exercise,
    is_key: false,
    conditioning: true,
    sets,
    measure: exercise.measure,
    rep_min: perSet,
    rep_max: perSet,
    rest_sec: 0,
  });
}

/**
 * Deload: ~40% fewer working sets (at least 1 per exercise); if that changes nothing, the last
 * non-key exercise is dropped. Freed time becomes easy conditioning. Target RIR is 4.
 */
function deloadOf(draft: DraftSession, budget: TimeBudget, ctx: SelectionContext): DraftSession {
  const deload: DraftSession = {
    template: draft.template,
    exercises: draft.exercises
      .filter((de) => !de.conditioning)
      .map((de) => ({ ...de, sets: Math.max(1, Math.round(de.sets * DELOAD_SET_FACTOR)) })),
  };
  const sets = (d: DraftSession) =>
    d.exercises.reduce((sum, de) => sum + (de.conditioning ? 0 : de.sets), 0);
  if (sets(deload) === sets(draft)) {
    // Every exercise was already at one set: drop the last non-key exercise instead.
    const lastNonKey = findLastIndex(deload.exercises, (de) => !de.is_key);
    if (lastNonKey !== -1) {
      deload.exercises.splice(lastNonKey, 1);
    }
  }
  addFinisherIfShort(deload, budget, ctx);
  return deload;
}

function draftMuscles(draft: DraftSession): Set<MuscleGroup> {
  const muscles = new Set<MuscleGroup>();
  draft.exercises
    .filter((de) => !de.conditioning)
    .forEach((de) => {
      de.exercise.primary_muscles.forEach((muscle) => muscles.add(muscle));
    });
  return muscles;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/**
 * Picks one weekday (0 = Monday) per session from `available_days`, assigning sessions in
 * template order. Score, lowest first:
 * 1. same-muscle sessions on consecutive days (including Sunday -> next Monday);
 * 2. fewer chosen days among the user's `training_slots` days;
 * 3. a smaller minimum gap between sessions (wider spacing is better);
 * 4. lexicographically earliest days.
 */
export function chooseTrainingDays(
  profile: Pick<Profile, 'available_days' | 'training_slots'>,
  sessionMuscles: readonly ReadonlySet<MuscleGroup>[],
): number[] {
  const available = profile.available_days
    .map((day) => WEEKDAYS.indexOf(day))
    .sort((a, b) => a - b);
  const slotDays = new Set(profile.training_slots.map((slot) => WEEKDAYS.indexOf(slot.day)));
  const n = sessionMuscles.length;
  let best: { days: number[]; score: number[] } | undefined;
  for (const days of combinations(available, n)) {
    const score = [
      adjacencyViolations(days, sessionMuscles),
      -days.filter((day) => slotDays.has(day)).length,
      -minimumGap(days),
    ];
    if (!best || compareScores(score, best.score) < 0) {
      best = { days, score };
    }
  }
  if (!best) {
    throw new Error(`Cannot schedule ${n} sessions on ${available.length} available days`);
  }
  return best.days;
}

function adjacencyViolations(
  days: readonly number[],
  muscles: readonly ReadonlySet<MuscleGroup>[],
): number {
  let violations = 0;
  for (let i = 0; i + 1 < days.length; i += 1) {
    const a = muscles[i];
    const b = muscles[i + 1];
    if (a && b && (days[i + 1] ?? 0) - (days[i] ?? 0) === 1 && sharesMuscles(a, b)) {
      violations += 1;
    }
  }
  // Week wrap: the last session on Sunday and the first session next Monday.
  const last = muscles[muscles.length - 1];
  const first = muscles[0];
  if (
    days.length > 1 &&
    days[days.length - 1] === 6 &&
    days[0] === 0 &&
    last &&
    first &&
    sharesMuscles(last, first)
  ) {
    violations += 1;
  }
  return violations;
}

function minimumGap(days: readonly number[]): number {
  if (days.length < 2) {
    return 7;
  }
  let gap = 7 - ((days[days.length - 1] ?? 0) - (days[0] ?? 0)); // wrap-around gap
  for (let i = 0; i + 1 < days.length; i += 1) {
    gap = Math.min(gap, (days[i + 1] ?? 0) - (days[i] ?? 0));
  }
  return gap;
}

function compareScores(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0; // equal scores keep the earlier (lexicographically smaller) combination
}

function* combinations(items: readonly number[], size: number, start = 0): Generator<number[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let i = start; i <= items.length - size; i += 1) {
    const head = items[i];
    if (head === undefined) {
      continue;
    }
    for (const tail of combinations(items, size - 1, i + 1)) {
      yield [head, ...tail];
    }
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function buildSession(
  draft: DraftSession,
  at: {
    id: string;
    weekId: string;
    day: number;
    date: IsoDate;
    targetRir: number;
    newId: IdGenerator;
  },
): PlannedSession {
  const exercises = draft.exercises.map((de, order) => ({
    id: at.newId(),
    planned_session_id: at.id,
    exercise_id: de.exercise.id,
    order,
    sets: de.sets,
    measure: de.measure,
    rep_min: de.rep_min,
    rep_max: de.rep_max,
    target_rir: at.targetRir,
    rest_sec: de.rest_sec,
    is_key: de.is_key,
  }));
  if (weekdayIndex(at.date) !== at.day) {
    throw new Error('Session date does not match its day index');
  }
  return {
    id: at.id,
    plan_week_id: at.weekId,
    day_index: at.day,
    scheduled_date: at.date,
    title: draft.template.title,
    est_minutes: secondsToEstMinutes(draftSeconds(draft)),
    priority: draft.template.priority,
    status: 'planned',
    variant: 'full',
    exercises,
  };
}

const GOAL_LABELS: Readonly<Record<GoalType, string>> = {
  strength: 'strength',
  hypertrophy: 'muscle growth',
  fat_loss: 'fat loss',
  general: 'general fitness',
};

function rationale(
  profile: Profile,
  goal: GoalType,
  templateId: TemplateId,
  sessionsPerWeek: number,
): string {
  const template = PLAN_TEMPLATES[templateId];
  const parts = [
    `${template.name} for ${GOAL_LABELS[goal]}: ${sessionsPerWeek} session(s) per week of about ${profile.session_minutes} minutes.`,
    'Weeks 1-5 build up gradually; week 6 is a deload with fewer sets so you recover.',
    'Work up to the top of each rep range on every set, then add weight and start again at the bottom of the range.',
  ];
  if (profile.days_per_week === 1) {
    parts.push('With one training day per week, sessions A and B alternate week by week.');
  }
  if (profile.days_per_week > sessionsPerWeek && sessionsPerWeek === template.sessions.length) {
    parts.push(`Your other available days are for rest or light activity such as walking.`);
  }
  if (profile.experience_level === 'beginner') {
    parts.push(
      'As a beginner you stop each set with 3-4 reps in reserve and never train to failure.',
    );
  }
  if (profile.limitations.length > 0) {
    parts.push(
      `Exercises that load your ${profile.limitations.join(', ').replaceAll('_', ' ')} are left out.`,
    );
  }
  parts.push('This plan is general fitness guidance, not medical advice.');
  return parts.join(' ');
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item !== undefined && predicate(item)) {
      return i;
    }
  }
  return -1;
}
