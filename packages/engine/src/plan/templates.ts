import type {
  ExperienceLevel,
  GoalType,
  MovementPattern,
  MuscleGroup,
  PlanPhase,
  SessionPriority,
} from '../schemas/index.js';

/**
 * Rule-based templates (research section 2.1) and the programming parameters used by
 * `generatePlan`. Everything here is data, so the plan generator stays small and testable.
 */

export const TEMPLATE_IDS = ['full_body_2x', 'full_body_3x', 'upper_lower_4x'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/**
 * One exercise slot. `pattern` picks a movement pattern; isolation slots also name the
 * target `muscle`. `variant` n picks the n-th best candidate so sessions of the same
 * template rotate exercises (falls back to the best unused candidate).
 */
export interface ExerciseSlot {
  pattern: MovementPattern;
  muscle?: MuscleGroup;
  key?: boolean;
  variant?: number;
}

export interface SessionTemplate {
  title: string;
  priority: SessionPriority;
  /** In priority order: earlier slots are kept when time is short. */
  slots: readonly ExerciseSlot[];
}

export interface PlanTemplate {
  id: TemplateId;
  name: string;
  sessions: readonly SessionTemplate[];
}

const k = (pattern: MovementPattern, variant = 0): ExerciseSlot => ({
  pattern,
  key: true,
  variant,
});
const s = (pattern: MovementPattern, variant = 0): ExerciseSlot => ({ pattern, variant });
const iso = (muscle: MuscleGroup): ExerciseSlot => ({ pattern: 'isolation', muscle });

export const PLAN_TEMPLATES: Readonly<Record<TemplateId, PlanTemplate>> = {
  full_body_2x: {
    id: 'full_body_2x',
    name: 'Full Body 2x/week',
    sessions: [
      {
        title: 'Full Body A',
        priority: 'key',
        slots: [k('squat'), k('push_h'), k('pull_v'), s('hinge'), s('push_v'), s('core')],
      },
      {
        title: 'Full Body B',
        priority: 'key',
        slots: [k('hinge'), k('push_v'), k('pull_h'), s('lunge'), s('push_h', 1), s('core', 1)],
      },
    ],
  },
  full_body_3x: {
    id: 'full_body_3x',
    name: 'Full Body 3x/week',
    sessions: [
      {
        title: 'Full Body A',
        priority: 'key',
        slots: [k('squat'), k('push_h'), k('pull_h'), s('hinge'), iso('side_delts'), s('core')],
      },
      {
        title: 'Full Body B',
        priority: 'key',
        slots: [k('hinge'), k('push_v'), k('pull_v'), s('lunge'), iso('biceps'), s('core', 1)],
      },
      {
        title: 'Full Body C',
        priority: 'normal',
        slots: [
          k('squat', 1),
          k('push_h', 1),
          k('pull_h', 1),
          s('hinge', 1),
          iso('triceps'),
          s('carry'),
        ],
      },
    ],
  },
  upper_lower_4x: {
    id: 'upper_lower_4x',
    name: 'Upper/Lower 4x/week',
    sessions: [
      {
        title: 'Upper A',
        priority: 'key',
        slots: [k('push_h'), k('pull_h'), s('push_v'), s('pull_v'), iso('triceps'), iso('biceps')],
      },
      {
        title: 'Lower A',
        priority: 'key',
        slots: [k('squat'), s('hinge'), s('lunge'), iso('hamstrings'), iso('calves'), s('core')],
      },
      {
        title: 'Upper B',
        priority: 'normal',
        slots: [
          k('pull_v'),
          k('push_v'),
          s('push_h', 1),
          s('pull_h', 1),
          iso('side_delts'),
          iso('rear_delts'),
        ],
      },
      {
        title: 'Lower B',
        priority: 'normal',
        slots: [k('hinge'), s('squat', 1), s('lunge', 1), iso('quads'), s('core', 1), s('carry')],
      },
    ],
  },
};

/**
 * Template choice by days per week: 1-2 -> Full Body 2x (with 1 day the two sessions
 * alternate week by week), 3 -> Full Body 3x, 4+ -> Upper/Lower 4x (extra days stay free for
 * rest or light activity in the MVP).
 */
export function templateForDays(daysPerWeek: number): TemplateId {
  if (daysPerWeek <= 2) {
    return 'full_body_2x';
  }
  return daysPerWeek === 3 ? 'full_body_3x' : 'upper_lower_4x';
}

/**
 * Preferred exercises per pattern, best first. Candidates not listed come after, in catalog
 * order. Level and equipment filters are applied before this ranking.
 */
export const EXERCISE_PREFERENCES: Readonly<Partial<Record<MovementPattern, readonly string[]>>> = {
  squat: [
    'barbell_back_squat',
    'goblet_squat',
    'kettlebell_goblet_squat',
    'leg_press',
    'dumbbell_front_squat',
    'hack_squat',
    'barbell_front_squat',
    'bodyweight_squat',
    'chair_squat',
    'wall_sit',
  ],
  lunge: [
    'dumbbell_reverse_lunge',
    'dumbbell_step_up',
    'dumbbell_bulgarian_split_squat',
    'barbell_split_squat',
    'barbell_reverse_lunge',
    'dumbbell_walking_lunge',
    'bodyweight_split_squat',
    'bodyweight_reverse_lunge',
    'step_up',
    'lateral_lunge',
  ],
  hinge: [
    'barbell_romanian_deadlift',
    'dumbbell_romanian_deadlift',
    'barbell_hip_thrust',
    'dumbbell_hip_thrust',
    'barbell_deadlift',
    'kettlebell_swing',
    'cable_pull_through',
    'back_extension',
    'dumbbell_single_leg_rdl',
    'glute_bridge',
    'single_leg_glute_bridge',
    'bodyweight_single_leg_rdl',
    'bodyweight_good_morning',
  ],
  push_h: [
    'barbell_bench_press',
    'dumbbell_bench_press',
    'dumbbell_incline_press',
    'machine_chest_press',
    'incline_barbell_bench_press',
    'dumbbell_floor_press',
    'push_up',
    'incline_push_up',
    'knee_push_up',
  ],
  push_v: [
    'barbell_overhead_press',
    'seated_dumbbell_shoulder_press',
    'dumbbell_overhead_press',
    'machine_shoulder_press',
    'landmine_press',
    'half_kneeling_dumbbell_press',
    'dumbbell_arnold_press',
    'incline_pike_push_up',
    'pike_push_up',
  ],
  pull_h: [
    'chest_supported_dumbbell_row',
    'one_arm_dumbbell_row',
    'seated_cable_row',
    'machine_chest_supported_row',
    'barbell_bent_over_row',
    'inverted_row',
    'dumbbell_bent_over_row',
    'doorframe_row',
  ],
  pull_v: [
    'pull_up',
    'lat_pulldown',
    'chin_up',
    'assisted_pull_up',
    'band_assisted_pull_up',
    'negative_pull_up',
    'dumbbell_pullover',
    'straight_arm_pulldown',
  ],
  core: [
    'plank',
    'dead_bug',
    'side_plank',
    'bird_dog',
    'cable_pallof_press',
    'dumbbell_dead_bug',
    'reverse_crunch',
    'hanging_knee_raise',
  ],
  carry: ['farmers_carry', 'suitcase_carry', 'kettlebell_front_rack_carry', 'sled_push'],
  isolation: [
    'dumbbell_lateral_raise',
    'cable_lateral_raise',
    'dumbbell_biceps_curl',
    'barbell_curl',
    'cable_triceps_pushdown',
    'dumbbell_overhead_triceps_extension',
    'seated_leg_curl',
    'slider_leg_curl',
    'leg_extension',
    'machine_calf_raise',
    'dumbbell_calf_raise',
    'bodyweight_calf_raise',
    'face_pull',
    'dumbbell_rear_delt_fly',
    'band_pull_apart',
    'prone_y_raise',
  ],
  /** Conditioning used to fill session time: low-impact options first. */
  cardio: [
    'stationary_bike',
    'elliptical',
    'incline_treadmill_walk',
    'rowing_machine',
    'step_jacks',
    'jumping_jacks',
    'mountain_climber',
  ],
};

/** Conditioning fillers are limited to these (no burpees or thrusters as a time filler). */
export const CONDITIONING_EXERCISES: readonly string[] = EXERCISE_PREFERENCES.cardio ?? [];

export interface RepScheme {
  /** Double-progression range for reps-based sets. */
  rep_min: number;
  rep_max: number;
  rest_sec: number;
}

/**
 * Double-progression rep ranges per goal: work up to `rep_max` on all sets, then add load and
 * restart at `rep_min` (see `nextTargets`). Key lifts use the lower range.
 */
export const REP_SCHEMES: Readonly<Record<GoalType, { key: RepScheme; accessory: RepScheme }>> = {
  strength: {
    key: { rep_min: 4, rep_max: 6, rest_sec: 150 },
    accessory: { rep_min: 8, rep_max: 10, rest_sec: 90 },
  },
  hypertrophy: {
    key: { rep_min: 6, rep_max: 10, rest_sec: 120 },
    accessory: { rep_min: 10, rep_max: 15, rest_sec: 75 },
  },
  fat_loss: {
    key: { rep_min: 8, rep_max: 12, rest_sec: 90 },
    accessory: { rep_min: 12, rep_max: 15, rest_sec: 60 },
  },
  general: {
    key: { rep_min: 8, rep_max: 12, rest_sec: 90 },
    accessory: { rep_min: 10, rep_max: 15, rest_sec: 60 },
  },
};

/** Beginners use a slightly higher key-lift range for strength (technique first, no grinders). */
export const BEGINNER_STRENGTH_KEY: RepScheme = { rep_min: 6, rep_max: 8, rest_sec: 120 };

/** Timed sets (holds, carries): seconds per set and rest. */
export const TIMED_SCHEME: RepScheme = { rep_min: 20, rep_max: 40, rest_sec: 60 };

export const BLOCK_WEEKS = 6;
/** 0-based index of the deload week (week 6). */
export const DELOAD_WEEK_INDEX = 5;

/** Week phases: technique/volume, then intensification, then deload. */
export const WEEK_PHASES: readonly PlanPhase[] = [
  'accumulation',
  'accumulation',
  'accumulation',
  'intensification',
  'intensification',
  'deload',
];

export const WEEK_FOCUS: readonly string[] = [
  'Learn the movements and find your starting weights',
  'Build consistency',
  'Add reps within the range',
  'Push a little closer to your limit',
  'Consolidate before the deload',
  'Deload: fewer sets and easier effort so you recover',
];

/**
 * Target reps in reserve per week. Beginners stay at RIR 3-4 and nobody trains to failure
 * (the minimum is RIR 1). The deload week uses RIR 4.
 */
export const TARGET_RIR_BY_WEEK: Readonly<Record<ExperienceLevel, readonly number[]>> = {
  beginner: [4, 4, 3, 3, 3, 4],
  intermediate: [3, 3, 2, 2, 2, 4],
  advanced: [3, 2, 2, 1, 1, 4],
};

/** Deload volume: working sets are multiplied by this factor (rounded, at least 1). */
export const DELOAD_SET_FACTOR = 0.6;

/** Starting sets per exercise before the session is fitted to the time budget. */
export const BASE_SETS = { key: 3, accessory: 2 } as const;

export const MAX_SETS_PER_EXERCISE: Readonly<Record<ExperienceLevel, number>> = {
  beginner: 4,
  intermediate: 5,
  advanced: 5,
};

/**
 * Weekly cap on hard sets per muscle group (research 2.2: roughly 10-20 for hypertrophy).
 * Counting rule (see `weeklySetsByMuscle`): each working set counts once for every primary
 * muscle of the exercise; secondary muscles, conditioning (cardio pattern) and low-stimulus
 * exercises are not counted.
 */
export const WEEKLY_SET_CAPS: Readonly<Record<ExperienceLevel, number>> = {
  beginner: 12,
  intermediate: 16,
  advanced: 20,
};

/** Duration tolerance: est_minutes must be within session_minutes +/- 10%. */
export const DURATION_TOLERANCE = 0.1;

/**
 * Conditioning finisher cap (D9): one set of at most 10 minutes, only in training weeks.
 * When the weekly volume caps leave a session shorter than requested, it simply ends earlier.
 */
export const MAX_FINISHER_SEC = 600;

/** Most sessions any template schedules per week (Upper/Lower 4x). */
export const MAX_SESSIONS_PER_WEEK = 4;
