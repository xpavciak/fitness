import { z } from 'zod';

/** Generic entity id (UUID in Supabase, any non-empty string locally). */
export const IdSchema = z.string().trim().min(1).max(64);
export type Id = z.infer<typeof IdSchema>;

/** Catalog exercise id: a stable snake_case slug, e.g. `goblet_squat`. */
export const ExerciseIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, 'Exercise id must be a snake_case slug');
export type ExerciseId = z.infer<typeof ExerciseIdSchema>;

/** Calendar date, `YYYY-MM-DD` (no time zone; interpreted in the user's local zone). */
export const IsoDateSchema = z.iso.date();
export type IsoDate = z.infer<typeof IsoDateSchema>;

/** Instant in time, ISO 8601 with an offset (e.g. `2026-10-08T07:30:00Z`). */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** Local wall-clock time, `HH:MM` (24h). */
export const TimeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24h)');
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;

/** Days of the week. Index in this array is the `day_index` used by planned sessions (0 = Monday). */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const WeekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof WeekdaySchema>;

/** 0 = Monday ... 6 = Sunday. */
export const DayIndexSchema = z.int().min(0).max(6);
export type DayIndex = z.infer<typeof DayIndexSchema>;

export const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export const ExperienceLevelSchema = z.enum(EXPERIENCE_LEVELS);
export type ExperienceLevel = z.infer<typeof ExperienceLevelSchema>;

/**
 * Equipment a user can own or an exercise can require.
 * `bodyweight` means "no equipment needed" and is always available.
 * `machine` covers selectorized/plate-loaded machines, cardio machines and sleds.
 */
export const EQUIPMENT = [
  'bodyweight',
  'dumbbells',
  'kettlebell',
  'barbell',
  'bench',
  'pullup_bar',
  'cable',
  'machine',
  'bands',
] as const;
export const EquipmentSchema = z.enum(EQUIPMENT);
export type Equipment = z.infer<typeof EquipmentSchema>;

/** Body regions used both as profile limitations and as exercise contraindication tags. */
export const BODY_REGIONS = [
  'knee',
  'lower_back',
  'shoulder',
  'wrist',
  'elbow',
  'hip',
  'ankle',
  'neck',
] as const;
export const BodyRegionSchema = z.enum(BODY_REGIONS);
export type BodyRegion = z.infer<typeof BodyRegionSchema>;

export const MUSCLE_GROUPS = [
  'chest',
  'lats',
  'upper_back',
  'traps',
  'front_delts',
  'side_delts',
  'rear_delts',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'lower_back',
  'glutes',
  'quads',
  'hamstrings',
  'adductors',
  'calves',
] as const;
export const MuscleGroupSchema = z.enum(MUSCLE_GROUPS);
export type MuscleGroup = z.infer<typeof MuscleGroupSchema>;

/**
 * Movement patterns. Extends the research sketch (section 5.3) with `lunge`
 * (single-leg knee-dominant) and `isolation` (single-joint accessories) so every
 * catalog entry has a meaningful pattern for substitution and volume balancing.
 */
export const MOVEMENT_PATTERNS = [
  'squat',
  'lunge',
  'hinge',
  'push_h',
  'push_v',
  'pull_h',
  'pull_v',
  'carry',
  'core',
  'cardio',
  'isolation',
] as const;
export const MovementPatternSchema = z.enum(MOVEMENT_PATTERNS);
export type MovementPattern = z.infer<typeof MovementPatternSchema>;

/** Returns true when the array has no duplicate values (by `===`). */
export function hasNoDuplicates(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

/** An array schema that rejects duplicate entries. */
export function uniqueArray<T extends z.ZodType>(item: T) {
  return z.array(item).refine(hasNoDuplicates, { message: 'Array must not contain duplicates' });
}
