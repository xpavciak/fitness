import { EXERCISE_CATALOG } from '../catalog/index.js';
import { createCatalogLookup } from '../catalog/lookup.js';
import { addDays, daysBetween, isValidTimeZone, localDateOf } from '../dates.js';
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
/** RIR this far below the target means the set was harder than planned: hold (B1). */
export const RIR_TOO_HARD_MARGIN = 2;
/** RIR this far below the target means much too hard: the load drops 5% (B1). */
export const RIR_MUCH_TOO_HARD_MARGIN = 3;
/** Timed exercises progress in steps of this many seconds (reps-based ones by 1 rep). */
export const DURATION_STEP_SEC = 5;

export interface NextTargetsOptions {
  /** The user's local date (when the next session happens). */
  today: IsoDate;
  /** The profile's IANA zone, used to turn `performed_at` into a local date (required, S2). */
  timezone: string;
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
 * 4. Harder than planned (any reported RIR <= target - 2): same load, aim for the weakest set's
 *    reps again (`hold`); at 3 or more below the target the load drops 5% (`decrease_load`).
 *    Load and reps never go up in this case.
 * 5. Every planned set completed at the top of the range: double progression adds the load
 *    increment for the equipment and restarts at `rep_min` (`increase_load`). When the sets also
 *    felt too easy (every reported RIR >= target + 2) the jump is at least +5%. Without load
 *    (bodyweight), the rep range moves up by two steps instead (`raise_rep_range`).
 * 6. Too easy (every reported RIR >= target + 2) but not yet at the top: load +5%
 *    (`increase_load`); without load, two extra reps/steps (`add_reps`).
 * 7. Every set completed within the range: same load, one more rep (or +5 s) (`add_reps`).
 * 8. Otherwise (sets below `rep_min`): same load, aim for `rep_min` again (`hold`).
 *
 * Inputs: warm-up sets are ignored, and so are sets with 0 reps that were not completed (not
 * attempted). Only `reps > 0 && !completed` is a failed set. Set logs whose local date is after
 * `today` + 1 day are ignored (clock skew); later logs up to that count as 0 days ago.
 * Missing RIR: sets without RIR are ignored by the RIR rules; when no set has RIR, only reps and
 * completion are used.
 * Loads are rounded to the equipment grid (`loads.ts`). A decrease moves to the nearest grid step
 * below an off-grid load when that is smaller than the nominal cut, and never below the minimum
 * (empty bar, lightest dumbbell); reasons state the actual change in kg.
 * "Last session" is the workout log with the latest working set for this exercise. The base load
 * is the heaviest working set of that session.
 */
export function nextTargets(
  plannedInput: PlannedExercise,
  setLogsInput: readonly SetLog[],
  opts: NextTargetsOptions,
): NextTargets {
  const planned = PlannedExerciseSchema.parse(plannedInput);
  const today = IsoDateSchema.parse(opts.today);
  if (!isValidTimeZone(opts.timezone)) {
    throw new RangeError(`Unknown IANA time zone "${opts.timezone}"`);
  }
  const exercise = createCatalogLookup(opts.catalog ?? EXERCISE_CATALOG)(planned.exercise_id);
  const step = planned.measure === 'seconds' ? DURATION_STEP_SEC : 1;
  const amount = (value: number) =>
    planned.measure === 'seconds' ? `${value}s` : `${value} rep${value === 1 ? '' : 's'}`;
  const base = {
    exercise_id: planned.exercise_id,
    measure: planned.measure,
    sets: planned.sets,
    rep_min: planned.rep_min,
    rep_max: planned.rep_max,
    target_rir: planned.target_rir,
  };

  const last = lastSession(planned, setLogsInput, today, opts.timezone);
  if (!last) {
    const effort =
      planned.measure === 'seconds'
        ? 'stopping while your form is still solid'
        : `stopping with about ${planned.target_rir} reps in reserve`;
    return {
      ...base,
      target_reps: planned.rep_min,
      ...loadField(exercise, planned.target_load_kg),
      decision: 'start',
      reason: exercise.loadable
        ? `First time: pick a weight you can manage for ${amount(planned.rep_min)} per set, ${effort}.`
        : `First time: aim for ${amount(planned.rep_min)} per set, ${effort}.`,
    };
  }

  const sets = last.sets;
  const loadKg = Math.max(...sets.map((set) => set.load_kg));
  const usesLoad = exercise.loadable && loadKg > 0;
  const steps = usesLoad ? loadStepsFor(exercise, opts.loadStepKg) : undefined;
  const minReps = Math.min(...sets.map((set) => set.reps));
  const allCompleted = sets.every((set) => set.completed);
  const reportedRir = sets.flatMap((set) => (set.rir === undefined ? [] : [set.rir]));
  const target = planned.target_rir;
  const failedOrMaxEffort = !allCompleted || (target > 0 && reportedRir.some((rir) => rir === 0));
  const tooHard = reportedRir.some((rir) => rir <= target - RIR_TOO_HARD_MARGIN);
  const muchTooHard = reportedRir.some((rir) => rir <= target - RIR_MUCH_TOO_HARD_MARGIN);
  const tooEasy =
    allCompleted &&
    reportedRir.length > 0 &&
    reportedRir.every((rir) => rir >= target + RIR_TOO_EASY_MARGIN);
  const hitTop =
    allCompleted && sets.length >= planned.sets && sets.every((set) => set.reps >= planned.rep_max);
  const meetsMin = allCompleted && minReps >= planned.rep_min;
  const clampReps = (reps: number) => Math.min(planned.rep_max, Math.max(planned.rep_min, reps));
  const withLast = { last_session_date: last.date };
  const result = (
    decision: ProgressionDecision,
    targetReps: number,
    reason: string,
    load?: number,
  ): NextTargets => ({
    ...base,
    ...withLast,
    target_reps: targetReps,
    ...(steps && load !== undefined ? { target_load_kg: load } : {}),
    decision,
    reason,
  });

  if (last.daysSince > BREAK_DAYS) {
    const reduction = last.daysSince > LONG_BREAK_DAYS ? LONG_BREAK_REDUCTION : BREAK_REDUCTION;
    const load = steps ? breakLoad(loadKg, steps, reduction) : undefined;
    return result(
      'break_reset',
      planned.rep_min,
      `Welcome back! It has been ${last.daysSince} days, so ${load === undefined ? '' : `${describeChange(loadKg, load, reduction)} and `}you restart at ${amount(planned.rep_min)}.`,
      load,
    );
  }

  if (failedOrMaxEffort) {
    const cause = allCompleted
      ? 'You went to failure (0 reps in reserve)'
      : 'A set was not completed';
    const load = steps ? lowerLoad(loadKg, steps, RIR_ADJUSTMENT) : undefined;
    return result(
      steps ? 'decrease_load' : 'hold',
      planned.rep_min,
      `${cause}, so ${load === undefined ? '' : `${describeChange(loadKg, load, RIR_ADJUSTMENT)} and `}you aim for ${amount(planned.rep_min)} next time.`,
      load,
    );
  }

  if (tooHard) {
    const hardest = Math.min(...reportedRir);
    const feel = `That was harder than planned (${hardest} reps in reserve, ${target} planned)`;
    const targetReps = clampReps(minReps);
    if (muchTooHard && steps) {
      const load = lowerLoad(loadKg, steps, RIR_ADJUSTMENT);
      return result(
        'decrease_load',
        targetReps,
        `${feel}, so ${describeChange(loadKg, load, RIR_ADJUSTMENT)} and you aim for ${amount(targetReps)} per set.`,
        load,
      );
    }
    return result(
      'hold',
      targetReps,
      `${feel}, so ${steps ? `keep ${formatKg(loadKg)} kg and ` : ''}aim for ${amount(targetReps)} per set again.`,
      loadKg,
    );
  }

  if (hitTop) {
    if (steps) {
      const load = increasedLoad(loadKg, steps, tooEasy);
      return result(
        'increase_load',
        planned.rep_min,
        `You hit ${amount(planned.rep_max)} on every set, so ${describeChange(loadKg, load)} and you restart at ${amount(planned.rep_min)}.`,
        load,
      );
    }
    const max = maxPerSet(planned.measure);
    const raise = 2 * step;
    const repMin = Math.min(planned.rep_min + raise, max);
    const repMax = Math.min(planned.rep_max + raise, max);
    return {
      ...result(
        'raise_rep_range',
        repMin,
        `You hit ${amount(planned.rep_max)} on every set, so the range moves up to ${repMin}-${amount(repMax)}.`,
      ),
      rep_min: repMin,
      rep_max: repMax,
    };
  }

  if (tooEasy) {
    const easy = `That felt easy (${target + RIR_TOO_EASY_MARGIN}+ reps in reserve)`;
    if (steps) {
      const load = roundLoad(loadKg * (1 + RIR_ADJUSTMENT), steps, 'up');
      return result(
        'increase_load',
        clampReps(minReps),
        `${easy}, so ${describeChange(loadKg, load)}.`,
        load,
      );
    }
    const targetReps = clampReps(minReps + 2 * step);
    return result('add_reps', targetReps, `${easy}, so aim for ${amount(targetReps)} per set.`);
  }

  const keep = steps ? `Keep ${formatKg(loadKg)} kg and aim` : 'Aim';
  if (meetsMin) {
    const targetReps = clampReps(minReps + step);
    return result(
      'add_reps',
      targetReps,
      `Good work. ${keep} for ${amount(targetReps)} per set.`,
      loadKg,
    );
  }
  return result(
    'hold',
    planned.rep_min,
    `${keep} for ${amount(planned.rep_min)} on every set.`,
    loadKg,
  );
}

function loadField(exercise: Exercise, loadKg: number | undefined): { target_load_kg?: number } {
  return exercise.loadable && loadKg !== undefined ? { target_load_kg: loadKg } : {};
}

function formatKg(kg: number): string {
  return String(Math.round(kg * 100) / 100);
}

/**
 * Plain-English description of a load change with the actual numbers. When equipment steps make
 * a drop clearly bigger than the intended `reduction`, it says so.
 */
function describeChange(fromKg: number, toKg: number, reduction = 0): string {
  if (toKg > fromKg) {
    return `the weight goes up from ${formatKg(fromKg)} to ${formatKg(toKg)} kg`;
  }
  if (toKg < fromKg) {
    const percent = Math.round((100 * (fromKg - toKg)) / fromKg);
    const note =
      percent > Math.round(reduction * 100) + 1
        ? `${percent}% lighter, because that is the next lighter weight available`
        : `${percent}% lighter`;
    return `the weight drops from ${formatKg(fromKg)} to ${formatKg(toKg)} kg (${note})`;
  }
  return `the weight stays at ${formatKg(fromKg)} kg because that is the lightest option`;
}

/**
 * A lower load: the nominal cut rounded down to the grid, except that an off-grid load only drops
 * to the grid step just below it when that is a smaller cut (S5). Never below the equipment
 * minimum and never above the current load.
 */
function lowerLoad(loadKg: number, steps: LoadSteps, reduction: number): number {
  const nominal = roundLoad(loadKg * (1 - reduction), steps, 'down');
  const gridBelow = roundLoad(loadKg, steps, 'down');
  const lowered = gridBelow < loadKg ? Math.max(nominal, gridBelow) : nominal;
  return Math.min(lowered, loadKg);
}

/**
 * Load after a break: the nominal reduction rounded to the nearest grid step (so a coarse grid
 * does not turn -20% into -33%), but always at least one step lighter when possible.
 */
function breakLoad(loadKg: number, steps: LoadSteps, reduction: number): number {
  const nearest = roundLoad(loadKg * (1 - reduction), steps, 'nearest');
  if (nearest < loadKg) {
    return nearest;
  }
  return lowerLoad(loadKg, steps, reduction);
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
  const latestAllowed = addDays(today, 1);
  const working = setLogs
    .map((set) => SetLogSchema.parse(set))
    .filter(
      (set) =>
        set.exercise_id === planned.exercise_id &&
        !set.is_warmup &&
        !(set.reps === 0 && !set.completed) &&
        daysBetween(localDateOf(set.performed_at, timezone), latestAllowed) >= 0,
    );
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
