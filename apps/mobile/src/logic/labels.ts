import {
  getExerciseById,
  type BodyRegion,
  type Equipment,
  type ExperienceLevel,
  type GoalType,
  type Weekday,
} from '@fitness/engine';

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

export const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  beginner: 'Beginner (under 6 months)',
  intermediate: 'Intermediate (6 months to 2 years)',
  advanced: 'Advanced (2+ years)',
};

export const EQUIPMENT_LABELS: Record<Exclude<Equipment, 'bodyweight'>, string> = {
  dumbbells: 'Dumbbells',
  kettlebell: 'Kettlebell',
  barbell: 'Barbell',
  bench: 'Bench',
  rack: 'Squat rack',
  pullup_bar: 'Pull-up bar',
  cable: 'Cable machine',
  machine: 'Gym machines',
  bands: 'Resistance bands',
};

export const BODY_REGION_LABELS: Record<BodyRegion, string> = {
  knee: 'Knee',
  lower_back: 'Lower back',
  shoulder: 'Shoulder',
  wrist: 'Wrist',
  elbow: 'Elbow',
  hip: 'Hip',
  ankle: 'Ankle',
  neck: 'Neck',
};

export const GOAL_LABELS: Record<GoalType, string> = {
  general: 'Get fit and healthy',
  strength: 'Get stronger',
  hypertrophy: 'Build muscle',
  fat_loss: 'Lose fat',
};

export function exerciseName(exerciseId: string): string {
  return getExerciseById(exerciseId)?.name ?? exerciseId;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "Wed 14 Oct" for a `YYYY-MM-DD` date (calendar arithmetic only, no time zone). */
export function formatShortDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return date;
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  const weekday = DAY_NAMES[(utc.getUTCDay() + 6) % 7]?.slice(0, 3) ?? '';
  const monthName = MONTH_NAMES[month - 1] ?? '';
  return `${weekday} ${day} ${monthName}`;
}
