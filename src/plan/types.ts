/**
 * Core domain types for the training plan.
 * This module (and everything in src/plan) is framework-free so it can be
 * reused by a future mobile app.
 */

export type MuscleGroup =
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'core'
  | 'mobility'
  | 'cardio';

/** Identifies a keyframed hologram clip. See src/hologram/clips.ts. */
export type AnimationId =
  | 'squat'
  | 'squat-hold'
  | 'hinge'
  | 'bench-press'
  | 'overhead-press'
  | 'row'
  | 'pulldown'
  | 'lunge'
  | 'split-squat-bench'
  | 'lunge-rotation'
  | 'incline-press'
  | 'one-arm-row'
  | 'plank'
  | 'push-up'
  | 'curl'
  | 'triceps-extension'
  | 'calf-raise'
  | 'rear-delt-fly'
  | 'lateral-raise'
  | 'carry'
  | 'run'
  | 'bike'
  | 'mobility'
  | 'cat-cow';

export interface Exercise {
  id: string;
  /** Slovak display name. */
  name: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: string;
  /** 3-5 technique steps. */
  steps: string[];
  mistakes: string[];
  /** Safety setup and how to bail out of a failed rep (heavy barbell lifts). */
  safety?: string[];
  easier: string;
  harder: string;
  animation: AnimationId;
  /** Performed one side at a time (doubles work time per set). */
  unilateral?: boolean;
}

export type DayType = 'gym' | 'cardio' | 'rest';
export type WeekNumber = 1 | 2 | 3 | 4;

/** A strength exercise with a concrete prescription for one day. */
export interface StrengthItem {
  kind: 'strength';
  exerciseId: string;
  sets: number;
  /** Display label, e.g. "6–8", "40 s" or "30 m". */
  reps: string;
  /** What `reps` measures: repetitions, a timed hold or a carried distance. */
  measure: 'reps' | 'hold' | 'distance';
  /** Work seconds per set (per side for unilateral exercises), used for timing. */
  workSecondsPerSet: number;
  restSeconds: number;
  /** Reps in reserve, e.g. "2" or "1–2". */
  rir: string;
  /** Tempo, eccentric-pause-concentric in seconds, e.g. "3-1-1". */
  tempo: string;
  cue: string;
}

/** A block of time (warm-up drill, cardio segment, mobility drill). */
export interface TimedItem {
  kind: 'timed';
  name: string;
  minutes: number;
  detail: string;
  exerciseId?: string;
  /** Intensity guidance, e.g. "RPE 3–4, 60–70 % HRmax". */
  intensity?: string;
  /** Equivalent alternative (e.g. stationary bike instead of running). */
  alternativeExerciseId?: string;
}

export type WorkoutItem = StrengthItem | TimedItem;

export type SectionKind = 'warmup' | 'main' | 'mobility' | 'cooldown';

export interface WorkoutSection {
  kind: SectionKind;
  title: string;
  items: WorkoutItem[];
}

export interface DayPlan {
  /** ISO date YYYY-MM-DD. */
  date: string;
  week: WeekNumber;
  /** 0 = Monday ... 6 = Sunday. */
  weekday: number;
  type: DayType;
  /** Split session for gym days. */
  gymSession?: 'legs' | 'push' | 'pull';
  /** Full Slovak title, e.g. "Nohy – drep, mŕtvy ťah, výpady". */
  title: string;
  /** Short label for the calendar cell. */
  shortLabel: string;
  sections: WorkoutSection[];
  estimatedMinutes: number;
  /** Extra coaching notes (alternatives, intensity guidance). */
  notes: string[];
}

export interface WeekInfo {
  week: WeekNumber;
  name: string;
  focus: string;
  rir: string;
}

export interface TrainingPlan {
  startDate: string;
  endDate: string;
  weeks: WeekInfo[];
  days: DayPlan[];
}
