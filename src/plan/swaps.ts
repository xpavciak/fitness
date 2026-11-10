import { getExercise } from './exercises';
import type { Exercise, StrengthItem, TrainingPlan } from './types';

/**
 * Exercises the user replaced: original exercise id -> chosen alternative.
 * A swap applies to every day of the plan.
 */
export type ExerciseSwaps = Readonly<Record<string, string>>;

/**
 * Curated alternatives for every strength exercise of the plan. Each
 * alternative trains the same muscles with the same kind of prescription
 * (reps, timed hold or carried distance), so sets, reps and rest still fit.
 */
export const SWAP_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  // Legs
  'back-squat': ['dumbbell-squat', 'bulgarian-split-squat', 'walking-lunge'],
  'romanian-deadlift': ['dumbbell-rdl'],
  'bulgarian-split-squat': ['walking-lunge', 'dumbbell-squat'],
  'walking-lunge': ['bulgarian-split-squat', 'dumbbell-squat'],
  'standing-calf-raise': ['single-leg-calf-raise'],
  plank: ['high-plank'],
  // Push
  'bench-press': ['dumbbell-bench-press', 'push-up', 'incline-dumbbell-press'],
  'overhead-press': ['dumbbell-shoulder-press'],
  'incline-dumbbell-press': ['dumbbell-bench-press', 'push-up'],
  'push-up': ['dumbbell-bench-press', 'incline-dumbbell-press'],
  'lateral-raise': ['dumbbell-shoulder-press', 'reverse-fly'],
  'overhead-triceps-extension': ['close-grip-push-up', 'push-up'],
  // Pull
  'lat-pulldown': ['close-grip-pulldown', 'dumbbell-row'],
  'barbell-row': ['dumbbell-row', 'one-arm-dumbbell-row'],
  'one-arm-dumbbell-row': ['dumbbell-row', 'barbell-row'],
  'reverse-fly': ['lateral-raise'],
  'dumbbell-curl': ['hammer-curl'],
  'farmers-carry': ['suitcase-carry'],
};

/** True when `replacement` is an allowed alternative for `original`. */
export function isValidSwap(original: string, replacement: string): boolean {
  return Object.hasOwn(SWAP_OPTIONS, original) && SWAP_OPTIONS[original]!.includes(replacement);
}

/** Keeps only valid entries (e.g. from storage written by an older version). */
export function sanitizeSwaps(value: unknown): ExerciseSwaps {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const swaps: Record<string, string> = {};
  for (const [original, replacement] of Object.entries(value)) {
    if (typeof replacement === 'string' && isValidSwap(original, replacement)) {
      swaps[original] = replacement;
    }
  }
  return swaps;
}

/** Tempo "3-1-1" as a short Slovak cue, used when the original cue no longer fits. */
export function tempoCue(item: Pick<StrengthItem, 'tempo' | 'measure'>): string {
  if (item.measure === 'hold') return 'Výdrž – spevnený stred tela, pokojný dych.';
  if (item.measure === 'distance') return 'Vzpriamene, krátke kontrolované kroky.';
  const [down = 0, pause = 0, up = 0] = item.tempo.split('-').map(Number);
  const parts = [`${down} s dole`];
  if (pause > 0) parts.push(`${pause} s pauza`);
  parts.push(up > 1 ? `${up} s hore` : 'plynulo hore');
  return `Tempo: ${parts.join(', ')}.`;
}

/** Exercise ids of every strength item in the given gym session, across all weeks. */
export function sessionExerciseIds(plan: TrainingPlan, session: string | undefined): Set<string> {
  const ids = new Set<string>();
  for (const day of plan.days) {
    if (!session || day.gymSession !== session) continue;
    for (const item of day.sections.flatMap((s) => s.items)) {
      if (item.kind === 'strength') ids.add(item.exerciseId);
    }
  }
  return ids;
}

/**
 * Alternatives the user can pick for a planned strength item. Exercises already
 * used elsewhere in the same session are left out so a workout never repeats one.
 */
export function swapChoices(
  item: StrengthItem,
  plan: TrainingPlan,
  session: string | undefined,
): Exercise[] {
  const original = item.replaces ?? item.exerciseId;
  const used = sessionExerciseIds(plan, session);
  return (SWAP_OPTIONS[original] ?? [])
    .filter((id) => id !== item.exerciseId && !used.has(id))
    .map((id) => getExercise(id))
    .filter((e): e is Exercise => e !== undefined);
}
