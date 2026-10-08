import { isExerciseAvailable } from '../equipment.js';
import {
  EXPERIENCE_LEVELS,
  type BodyRegion,
  type Equipment,
  type Exercise,
  type ExperienceLevel,
} from '../schemas/index.js';
import { EXERCISE_PREFERENCES, type ExerciseSlot } from './templates.js';

export interface SelectionContext {
  catalog: readonly Exercise[];
  /** The profile's actual equipment (not a tier). Bodyweight is always available. */
  equipment: readonly Equipment[];
  limitations: readonly BodyRegion[];
  level: ExperienceLevel;
}

/** True when any contraindication tag of the exercise is one of the user's limitations. */
export function isContraindicated(
  exercise: Pick<Exercise, 'contraindication_tags'>,
  limitations: readonly BodyRegion[],
): boolean {
  return exercise.contraindication_tags.some((tag) => limitations.includes(tag));
}

/** Exercises the user can do safely with their equipment (before level and slot filters). */
export function isEligible(
  exercise: Exercise,
  ctx: Pick<SelectionContext, 'equipment' | 'limitations'>,
): boolean {
  return (
    isExerciseAvailable(exercise, ctx.equipment) && !isContraindicated(exercise, ctx.limitations)
  );
}

const levelRank = (level: ExperienceLevel): number => EXPERIENCE_LEVELS.indexOf(level);

function matchesSlot(exercise: Exercise, slot: Pick<ExerciseSlot, 'pattern' | 'muscle'>): boolean {
  if (exercise.pattern !== slot.pattern) {
    return false;
  }
  return slot.muscle === undefined || exercise.primary_muscles.includes(slot.muscle);
}

/**
 * Candidates for a slot, best first. Filters: equipment (via `isExerciseAvailable`), limitations
 * (contraindication tags) and level (at most one level above the user's). Ranking:
 * 1. non-low-stimulus before low-stimulus;
 * 2. at or below the user's level before one level above;
 * 3. the pattern's preference list (`EXERCISE_PREFERENCES`), then catalog order.
 */
export function rankCandidates(
  slot: Pick<ExerciseSlot, 'pattern' | 'muscle'>,
  ctx: SelectionContext,
): Exercise[] {
  const preferences = EXERCISE_PREFERENCES[slot.pattern] ?? [];
  const userLevel = levelRank(ctx.level);
  const scored = ctx.catalog
    .map((exercise, catalogIndex) => ({ exercise, catalogIndex }))
    .filter(
      ({ exercise }) =>
        matchesSlot(exercise, slot) &&
        isEligible(exercise, ctx) &&
        levelRank(exercise.level) <= userLevel + 1,
    )
    .map(({ exercise, catalogIndex }) => {
      const preferenceIndex = preferences.indexOf(exercise.id);
      return {
        exercise,
        key: [
          exercise.low_stimulus ? 1 : 0,
          levelRank(exercise.level) > userLevel ? 1 : 0,
          preferenceIndex === -1 ? preferences.length : preferenceIndex,
          catalogIndex,
        ],
      };
    });
  scored.sort((a, b) => compareKeys(a.key, b.key));
  return scored.map(({ exercise }) => exercise);
}

function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * Picks the exercise for a slot: the `variant`-th best candidate when it is in the same tier
 * as the best one (low-stimulus, above the user's level) and not already used in the session, otherwise
 * the best unused candidate. Returns undefined when nothing fits.
 */
export function pickExercise(
  slot: ExerciseSlot,
  ctx: SelectionContext,
  usedIds: ReadonlySet<string>,
): Exercise | undefined {
  const candidates = rankCandidates(slot, ctx);
  const best = candidates[0];
  const variantPick = candidates[slot.variant ?? 0];
  // Rotation never trades down a tier (to low-stimulus or above-level options).
  const aboveLevel = (exercise: Exercise) => levelRank(exercise.level) > levelRank(ctx.level);
  const sameTier =
    best !== undefined &&
    variantPick !== undefined &&
    variantPick.low_stimulus === best.low_stimulus &&
    aboveLevel(variantPick) === aboveLevel(best);
  if (variantPick && sameTier && !usedIds.has(variantPick.id)) {
    return variantPick;
  }
  return candidates.find((exercise) => !usedIds.has(exercise.id));
}
