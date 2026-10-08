import { EXERCISE_CATALOG } from '../catalog/index.js';
import { createCatalogLookup } from '../catalog/lookup.js';
import { daysBetween, localDateOf } from '../dates.js';
import { loadStepsFor, roundLoad, type LoadSteps } from '../loads.js';
import {
  IsoDateSchema,
  PlannedExerciseSchema,
  SetLogSchema,
  maxPerSet,
  type Exercise,
  type ExerciseMeasure,
  type IsoDate,
  type PlannedExercise,
  type SetLog,
} from '../schemas/index.js';

/** Breaks longer than this many days reduce the load (research 2.5). */
export const BREAK_DAYS = 14;
/** Breaks longer than this many days reduce the load more. */
export const LONG_BREAK_DAYS = 28;
export const BREAK_REDUCTION = 0.1;
export const LONG_BREAK_REDUCTION = 0.2;
/** RIR autoregulation step (research 2.2): +5% when too easy, -5% on RIR 0 or a failed set. */
export const RIR_ADJUSTMENT = 0.05;
/** RIR this far above the target means the load was too light. */
export const RIR_TOO_EASY_MARGIN = 2;
/** Timed exercises progress in steps of this many seconds (reps-based ones by 1 rep). */
export const DURATION_STEP_SEC = 5;

export interface NextTargetsOptions {
  /** The user's local date (when the next session happens). */
  today: IsoDate;
  /** IANA zone used to turn `performed_at` into a local date. Default `UTC`. */
  timezone?: string;
  catalog?: readonly Exercise[];
  /** Overrides the load increment and rounding grid (e.g. 2.5 kg dumbbell steps). */
  loadStepKg?: number;
}

export const PROGRESSION_DECISIONS = [
  'start',
  'break_reset',
  'decrease_load',
  'increase_load',
  'add_reps',
  'raise_rep_range',
  'hold',
] as const;
export type ProgressionDecision = (typeof PROGRESSION_DECISIONS)[number];

export interface NextTargets {
  exercise_id: string;
  measure: ExerciseMeasure;
  sets: number;
  /** Double-progression range (reps or seconds). */
  rep_min: number;
  rep_max: number;
  /** Reps (or seconds) to aim for on every working set next time. */
  target_reps: number;
  /** Per implement (see `loads.ts`); absent when unknown or not loadable. */
  target_load_kg?: number;
  target_rir: number;
  decision: ProgressionDecision;
  /** Plain-English explanation for the user. */
  reason: string;
  /** Local date of the last session for this exercise, if any. */
  last_session_date?: IsoDate;
}

interface LastSession {
  sets: SetLog[];
  date: IsoDate;
  daysSince: number;
}

/**
 * Targets for the next session of a planned exercise (feature B). Rules, in order:
 *
 * 1. No previous working sets: the plan's prescription (`start`).
 * 2. Break of more than 14 days since the last session: load -10% (-20% after more than 28
 *    days), reps back to the bottom of the range (`break_reset`).
 * 3. A failed set, or RIR 0 when the target is above 0: load -5%, reps back to `rep_min`
 *    (`decrease_load`).
 * 4. Every planned set completed at the top of the range: double progression adds the load
 *    increment for the equipment and restarts at `rep_min` (`increase_load`). When the sets also
 *    felt too easy (every reported RIR >= target + 2) the jump is at least +5%. Without load
 *    (bodyweight), the rep range moves up by two steps instead (`raise_rep_range`).
 * 5. Too easy (every reported RIR >= target + 2) but not yet at the top: load +5%
 *    (`increase_load`); without load, two extra reps/steps (`add_reps`).
 * 6. Every set completed within the range: same load, one more rep (or +5 s) (`add_reps`).
 * 7. Otherwise (sets below `rep_min`): same load, aim for `rep_min` again (`hold`).
 *
 * Missing RIR: sets without RIR are ignored by the RIR rules; when no set has RIR, only reps
 * and completion are used. Load changes are rounded to the equipment grid (`loads.ts`); a change
 * always moves at least one step unless the minimum (e.g. the empty bar) is reached.
 * "Last session" is the workout log with the latest working set for this exercise. The base load
 * is the heaviest working set of that session. Logs dated after `today` count as 0 days ago.
 */
export function nextTargets(
  plannedInput: PlannedExercise,
  setLogsInput: readonly SetLog[],
  opts: NextTargetsOptions,
): NextTargets {
  const planned = PlannedExerciseSchema.parse(plannedInput);
  const today = IsoDateSchema.parse(opts.today);
  const exercise = createCatalogLookup(opts.catalog ?? EXERCISE_CATALOG)(planned.exercise_id);
  const step = planned.measure === 'seconds' ? DURATION_STEP_SEC : 1;
  const unit = planned.measure === 'seconds' ? 's' : ' reps';
  const base = {
    exercise_id: planned.exercise_id,
    measure: planned.measure,
    sets: planned.sets,
    rep_min: planned.rep_min,
    rep_max: planned.rep_max,
    target_rir: planned.target_rir,
  };

  const last = lastSession(planned, setLogsInput, today, opts.timezone ?? 'UTC');
  if (!last) {
    return {
      ...base,
      target_reps: planned.rep_min,
      ...loadField(exercise, planned.target_load_kg),
      decision: 'start',
      reason: `First time: aim for ${planned.rep_min}${unit} per set and pick a weight that leaves about ${planned.target_rir} reps in reserve.`,
    };
  }

  const sets = last.sets;
  const loadKg = Math.max(...sets.map((set) => set.load_kg));
  const usesLoad = exercise.loadable && loadKg > 0;
  const steps = usesLoad ? loadStepsFor(exercise, opts.loadStepKg) : undefined;
  const minReps = Math.min(...sets.map((set) => set.reps));
  const allCompleted = sets.every((set) => set.completed);
  const reportedRir = sets.flatMap((set) => (set.rir === undefined ? [] : [set.rir]));
  const failedOrMaxEffort =
    !allCompleted || (planned.target_rir > 0 && reportedRir.some((rir) => rir === 0));
  const tooEasy =
    allCompleted &&
    reportedRir.length > 0 &&
    reportedRir.every((rir) => rir >= planned.target_rir + RIR_TOO_EASY_MARGIN);
  const hitTop =
    allCompleted && sets.length >= planned.sets && sets.every((set) => set.reps >= planned.rep_max);
  const meetsMin = allCompleted && minReps >= planned.rep_min;
  const clampReps = (reps: number) => Math.min(planned.rep_max, Math.max(planned.rep_min, reps));
  const withLast = { last_session_date: last.date };

  if (last.daysSince > BREAK_DAYS) {
    const reduction = last.daysSince > LONG_BREAK_DAYS ? LONG_BREAK_REDUCTION : BREAK_REDUCTION;
    return {
      ...base,
      ...withLast,
      target_reps: planned.rep_min,
      ...(steps ? { target_load_kg: roundLoad(loadKg * (1 - reduction), steps, 'down') } : {}),
      decision: 'break_reset',
      reason: `Welcome back! It has been ${last.daysSince} days, so ${steps ? `the weight drops by about ${reduction * 100}% and ` : ''}you restart at ${planned.rep_min}${unit}.`,
    };
  }

  if (failedOrMaxEffort) {
    return {
      ...base,
      ...withLast,
      target_reps: planned.rep_min,
      ...(steps ? { target_load_kg: roundLoad(loadKg * (1 - RIR_ADJUSTMENT), steps, 'down') } : {}),
      decision: steps ? 'decrease_load' : 'hold',
      reason: `${allCompleted ? 'You went to failure (0 reps in reserve)' : 'A set was not completed'}, so ${steps ? 'the weight drops by about 5% and ' : ''}you aim for ${planned.rep_min}${unit} next time.`,
    };
  }

  if (hitTop) {
    if (steps) {
      return {
        ...base,
        ...withLast,
        target_reps: planned.rep_min,
        target_load_kg: increasedLoad(loadKg, steps, tooEasy),
        decision: 'increase_load',
        reason: `You hit ${planned.rep_max}${unit} on every set, so the weight goes up and you restart at ${planned.rep_min}${unit}.`,
      };
    }
    const max = maxPerSet(planned.measure);
    const raise = 2 * step;
    const repMin = Math.min(planned.rep_min + raise, max);
    const repMax = Math.min(planned.rep_max + raise, max);
    return {
      ...base,
      ...withLast,
      rep_min: repMin,
      rep_max: repMax,
      target_reps: repMin,
      decision: 'raise_rep_range',
      reason: `You hit ${planned.rep_max}${unit} on every set, so the range moves up to ${repMin}-${repMax}${unit}.`,
    };
  }

  if (tooEasy) {
    if (steps) {
      return {
        ...base,
        ...withLast,
        target_reps: clampReps(minReps),
        target_load_kg: roundLoad(loadKg * (1 + RIR_ADJUSTMENT), steps, 'up'),
        decision: 'increase_load',
        reason: `That felt easy (${planned.target_rir + RIR_TOO_EASY_MARGIN}+ reps in reserve), so the weight goes up by about 5%.`,
      };
    }
    return {
      ...base,
      ...withLast,
      target_reps: clampReps(minReps + 2 * step),
      decision: 'add_reps',
      reason: `That felt easy, so aim for ${clampReps(minReps + 2 * step)}${unit} per set.`,
    };
  }

  const load = steps ? { target_load_kg: loadKg } : {};
  if (meetsMin) {
    return {
      ...base,
      ...withLast,
      target_reps: clampReps(minReps + step),
      ...load,
      decision: 'add_reps',
      reason: `Good work. Same weight, aim for ${clampReps(minReps + step)}${unit} per set.`,
    };
  }
  return {
    ...base,
    ...withLast,
    target_reps: planned.rep_min,
    ...load,
    decision: 'hold',
    reason: `Same weight; aim for ${planned.rep_min}${unit} on every set.`,
  };
}

function loadField(exercise: Exercise, loadKg: number | undefined): { target_load_kg?: number } {
  return exercise.loadable && loadKg !== undefined ? { target_load_kg: loadKg } : {};
}

function increasedLoad(loadKg: number, steps: LoadSteps, tooEasy: boolean): number {
  const byIncrement = roundLoad(loadKg + steps.incrementKg, steps, 'nearest');
  const atLeastOneStep = Math.max(
    byIncrement,
    roundLoad(loadKg, steps, 'down') + steps.roundingStepKg,
  );
  if (!tooEasy) {
    return atLeastOneStep;
  }
  return Math.max(atLeastOneStep, roundLoad(loadKg * (1 + RIR_ADJUSTMENT), steps, 'up'));
}

function lastSession(
  planned: PlannedExercise,
  setLogs: readonly SetLog[],
  today: IsoDate,
  timezone: string,
): LastSession | undefined {
  const working = setLogs
    .map((set) => SetLogSchema.parse(set))
    .filter((set) => set.exercise_id === planned.exercise_id && !set.is_warmup);
  if (working.length === 0) {
    return undefined;
  }
  const latest = working.reduce((best, set) => {
    const diff = Date.parse(set.performed_at) - Date.parse(best.performed_at);
    return diff > 0 || (diff === 0 && set.workout_log_id > best.workout_log_id) ? set : best;
  });
  const sets = working
    .filter((set) => set.workout_log_id === latest.workout_log_id)
    .sort((a, b) => a.set_index - b.set_index);
  const date = localDateOf(latest.performed_at, timezone);
  return { sets, date, daysSince: Math.max(0, daysBetween(date, today)) };
}
