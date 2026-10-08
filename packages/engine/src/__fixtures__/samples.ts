import type {
  Exercise,
  Goal,
  Plan,
  PlannedExercise,
  Profile,
  ScheduleChange,
  SetLog,
  WorkoutLog,
} from '../schemas/index.js';

/** Deterministic, valid v4-format UUID for test fixtures: `uuid(1)` -> `...-000000000001`. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

/** Named fixture ids, so tests read as `ids.week` rather than raw UUIDs. */
export const ids = {
  user: uuid(1),
  goal: uuid(2),
  plan: uuid(3),
  week: uuid(4),
  session: uuid(5),
  pe1: uuid(6),
  pe2: uuid(7),
  log: uuid(8),
  set1: uuid(9),
  change: uuid(10),
  /** Ids not used by any fixture, for "other"/"new" entities in tests. */
  other1: uuid(101),
  other2: uuid(102),
  other3: uuid(103),
} as const;

/** Fresh deep copies so tests can mutate freely. */
const clone = <T>(value: T): T => structuredClone(value);

const PROFILE: Profile = {
  user_id: ids.user,
  birth_year: 1990,
  sex: 'female',
  height_cm: 168,
  weight_kg: 64.5,
  timezone: 'Europe/Bratislava',
  experience_level: 'beginner',
  equipment: ['dumbbells', 'bench'],
  limitations: ['knee'],
  days_per_week: 3,
  available_days: ['mon', 'wed', 'fri', 'sat'],
  session_minutes: 45,
  training_slots: [
    { day: 'mon', start_time: '07:00', location: 'home' },
    { day: 'wed', start_time: '18:30', location: 'home' },
    { day: 'fri', start_time: '07:00', location: 'home' },
  ],
  parq: {
    heart_condition_or_high_blood_pressure: false,
    chest_pain: false,
    dizziness_or_loss_of_consciousness: false,
    other_chronic_condition: false,
    prescribed_medication_for_chronic_condition: false,
    bone_joint_or_soft_tissue_problem: false,
    medically_supervised_activity_only: false,
    answered_at: '2026-10-01T08:00:00Z',
  },
  consent_health_at: '2026-10-01T08:00:00Z',
};

const GOAL: Goal = {
  id: ids.goal,
  user_id: ids.user,
  type: 'general',
  target: 'Train 3x per week for 6 weeks',
  status: 'active',
  created_at: '2026-10-01T08:05:00Z',
};

const PLANNED_EXERCISE: PlannedExercise = {
  id: ids.pe1,
  planned_session_id: ids.session,
  exercise_id: 'goblet_squat',
  order: 0,
  sets: 3,
  measure: 'reps',
  rep_min: 8,
  rep_max: 12,
  target_rir: 3,
  target_load_kg: 12,
  rest_sec: 90,
  is_key: true,
};

/** A one-week plan starting Monday 2026-10-05 with one session. */
const PLAN: Plan = {
  id: ids.plan,
  user_id: ids.user,
  goal_id: ids.goal,
  template_id: 'full_body_3x',
  version: 1,
  status: 'active',
  start_date: '2026-10-05',
  generated_by: 'rules',
  created_at: '2026-10-01T08:10:00Z',
  weeks: [
    {
      id: ids.week,
      plan_id: ids.plan,
      index: 0,
      start_date: '2026-10-05',
      phase: 'accumulation',
      sessions: [
        {
          id: ids.session,
          plan_week_id: ids.week,
          day_index: 0,
          scheduled_date: '2026-10-05',
          title: 'Full Body A',
          est_minutes: 45,
          priority: 'key',
          status: 'planned',
          variant: 'full',
          exercises: [
            PLANNED_EXERCISE,
            {
              id: ids.pe2,
              planned_session_id: ids.session,
              exercise_id: 'push_up',
              order: 1,
              sets: 3,
              measure: 'reps',
              rep_min: 6,
              rep_max: 12,
              target_rir: 2,
              rest_sec: 90,
              superset_group: 'A',
              is_key: false,
            },
          ],
        },
      ],
    },
  ],
};

const SET_LOG: SetLog = {
  id: ids.set1,
  workout_log_id: ids.log,
  exercise_id: 'goblet_squat',
  planned_exercise_id: ids.pe1,
  set_index: 0,
  measure: 'reps',
  reps: 10,
  load_kg: 12,
  rir: 2,
  is_warmup: false,
  completed: true,
  performed_at: '2026-10-05T07:10:00Z',
};

const WORKOUT_LOG: WorkoutLog = {
  id: ids.log,
  user_id: ids.user,
  planned_session_id: ids.session,
  started_at: '2026-10-05T07:00:00Z',
  ended_at: '2026-10-05T07:45:00Z',
  pre_checkin: { sleep: 4, energy: 3, soreness: 2, stress: 2 },
  session_rpe: 7,
  sets: [SET_LOG],
};

const SCHEDULE_CHANGE: ScheduleChange = {
  id: ids.change,
  plan_id: ids.plan,
  planned_session_id: ids.session,
  kind: 'move',
  reason: 'You missed Monday, so Full Body A moves to Tuesday.',
  from_date: '2026-10-05',
  to_date: '2026-10-06',
  created_by: 'system',
  created_at: '2026-10-05T20:00:00Z',
};

const EXERCISE: Exercise = {
  id: 'goblet_squat',
  name: 'Dumbbell Goblet Squat',
  pattern: 'squat',
  primary_muscles: ['quads', 'glutes'],
  secondary_muscles: ['adductors'],
  equipment: ['dumbbells'],
  level: 'beginner',
  contraindication_tags: ['knee'],
  substitutes: ['bodyweight_squat'],
  cues: ['Chest up'],
  measure: 'reps',
  loadable: true,
  unilateral: false,
  low_stimulus: false,
};

export const samples = {
  profile: () => clone(PROFILE),
  goal: () => clone(GOAL),
  plannedExercise: () => clone(PLANNED_EXERCISE),
  plan: () => clone(PLAN),
  setLog: () => clone(SET_LOG),
  workoutLog: () => clone(WORKOUT_LOG),
  scheduleChange: () => clone(SCHEDULE_CHANGE),
  exercise: () => clone(EXERCISE),
};
