import type { WeekInfo, WeekNumber } from './types';

/**
 * Coaching data: weekly periodisation and session templates.
 * The generator (generator.ts) turns these into concrete daily workouts.
 */

export const WEEKS: Record<WeekNumber, WeekInfo> = {
  1: {
    week: 1,
    name: 'Základ',
    focus: 'Technika a návyk. Zvoľ váhu, pri ktorej ti po sérii ostanú ~3 opakovania v zálohe.',
    rir: '3',
  },
  2: {
    week: 2,
    name: 'Objem',
    focus: 'Viac práce: +1 séria na hlavných cvikoch a o 2,5–5 % vyššia váha.',
    rir: '2',
  },
  3: {
    week: 3,
    name: 'Vrchol',
    focus: 'Najťažší týždeň mesiaca: menej opakovaní, vyššia váha, technika má stále prednosť.',
    rir: '1–2',
  },
  4: {
    week: 4,
    name: 'Odľahčenie',
    focus:
      'Deload: o ~45 % menej sérií, o ~10 % nižšia váha a viac mobility. Telo regeneruje a rastie.',
    rir: '4',
  },
};

export type RepScheme = 'strength' | 'hypertrophy' | 'high' | 'hold' | 'carry';

interface RepWeek {
  label: string;
  /** Reps used for timing, or seconds for hold/carry schemes. */
  value: number;
}

/** Rep targets per week (index 0 = week 1). */
export const REP_SCHEMES: Record<RepScheme, [RepWeek, RepWeek, RepWeek, RepWeek]> = {
  strength: [
    { label: '6–8', value: 7 },
    { label: '6–8', value: 7 },
    { label: '4–6', value: 5 },
    { label: '6–8', value: 7 },
  ],
  hypertrophy: [
    { label: '10–12', value: 11 },
    { label: '10–12', value: 11 },
    { label: '8–10', value: 9 },
    { label: '10–12', value: 11 },
  ],
  high: [
    { label: '12–15', value: 13 },
    { label: '12–15', value: 13 },
    { label: '10–12', value: 11 },
    { label: '12–15', value: 13 },
  ],
  hold: [
    { label: '30 s', value: 30 },
    { label: '40 s', value: 40 },
    { label: '45 s', value: 45 },
    { label: '30 s', value: 30 },
  ],
  // Carries: value is seconds; a loaded farmer's walk covers roughly 1 m/s,
  // so 30 m ≈ 30 s of work.
  carry: [
    { label: '30 m', value: 30 },
    { label: '40 m', value: 40 },
    { label: '40 m', value: 40 },
    { label: '30 m', value: 30 },
  ],
};

/** Schemes whose value is already seconds (not reps × tempo). */
export const TIMED_SCHEMES: ReadonlySet<RepScheme> = new Set(['hold', 'carry']);

export type ExerciseRole = 'main' | 'accessory';

export interface StrengthTemplate {
  exerciseId: string;
  /**
   * Optional variant used in even weeks (2 and 4) for variety. The slot keeps
   * the same role, sets, reps and rest, so progression stays comparable.
   */
  alternateExerciseId?: string;
  role: ExerciseRole;
  /** Sets in week 1. */
  baseSets: number;
  scheme: RepScheme;
  restSeconds: number;
  /** Longer rest in the peak week (heavy 4–6 rep sets). Defaults to restSeconds. */
  peakRestSeconds?: number;
  tempo: string;
  cue: string;
}

export type GymSessionKey = 'legs' | 'push' | 'pull';

export interface GymSessionTemplate {
  key: GymSessionKey;
  /** Short Slovak name used in the UI: "Nohy", "Tlak", "Ťah". */
  name: string;
  title: string;
  shortLabel: string;
  exercises: StrengthTemplate[];
}

/**
 * Split routine: Monday legs, Wednesday push, Friday pull. Each session trains
 * its muscle groups hard; together (plus Thursday mobility) they cover the
 * whole body every week.
 */
export const GYM_SESSIONS: Record<GymSessionKey, GymSessionTemplate> = {
  legs: {
    key: 'legs',
    name: 'Nohy',
    title: 'Nohy – drep, mŕtvy ťah, výpady, lýtka, core',
    shortLabel: 'Nohy',
    exercises: [
      {
        exerciseId: 'back-squat',
        role: 'main',
        baseSets: 4,
        scheme: 'strength',
        restSeconds: 150,
        peakRestSeconds: 180,
        tempo: '3-1-1',
        cue: '3 s dole, 1 s pauza v drepe, výbušne hore.',
      },
      {
        exerciseId: 'romanian-deadlift',
        role: 'main',
        baseSets: 3,
        scheme: 'strength',
        restSeconds: 120,
        tempo: '3-0-1',
        cue: '3 s dole so strečingom zadných stehien, boky dopredu hore.',
      },
      {
        exerciseId: 'bulgarian-split-squat',
        alternateExerciseId: 'walking-lunge',
        role: 'accessory',
        baseSets: 2,
        scheme: 'hypertrophy',
        restSeconds: 60,
        tempo: '2-0-1',
        cue: '2 s dole, zatlač prednou pätou.',
      },
      {
        exerciseId: 'standing-calf-raise',
        role: 'accessory',
        baseSets: 3,
        scheme: 'high',
        restSeconds: 45,
        tempo: '1-1-1',
        cue: '1 s natiahnutie dole, 1 s stiahnutie hore.',
      },
      {
        exerciseId: 'plank',
        role: 'accessory',
        baseSets: 3,
        scheme: 'hold',
        restSeconds: 45,
        tempo: '0-0-0',
        cue: 'Výdrž – stiahnuté sedacie svaly, pokojný dych.',
      },
    ],
  },
  push: {
    key: 'push',
    name: 'Tlak',
    title: 'Tlak – hrudník, ramená, triceps',
    shortLabel: 'Tlak',
    exercises: [
      {
        exerciseId: 'bench-press',
        role: 'main',
        baseSets: 4,
        scheme: 'strength',
        restSeconds: 150,
        peakRestSeconds: 180,
        tempo: '2-1-1',
        cue: '2 s dole, krátky dotyk hrudníka, plynulo hore.',
      },
      {
        exerciseId: 'overhead-press',
        role: 'main',
        baseSets: 3,
        scheme: 'strength',
        restSeconds: 120,
        tempo: '2-0-1',
        cue: 'Kontrolovane dole, rýchlo a kolmo hore.',
      },
      {
        exerciseId: 'incline-dumbbell-press',
        alternateExerciseId: 'push-up',
        role: 'accessory',
        baseSets: 3,
        scheme: 'hypertrophy',
        restSeconds: 90,
        tempo: '2-1-1',
        cue: '2 s dole, pauza pri hrudníku.',
      },
      {
        exerciseId: 'lateral-raise',
        role: 'accessory',
        baseSets: 3,
        scheme: 'high',
        restSeconds: 45,
        tempo: '2-1-1',
        cue: 'Ľahká váha, vedú lakte, 1 s podrž hore.',
      },
      {
        exerciseId: 'overhead-triceps-extension',
        role: 'accessory',
        baseSets: 3,
        scheme: 'hypertrophy',
        restSeconds: 60,
        tempo: '2-0-1',
        cue: 'Plné natiahnutie za hlavou, lakte na mieste.',
      },
    ],
  },
  pull: {
    key: 'pull',
    name: 'Ťah',
    title: 'Ťah – chrbát, zadné delty, biceps, core',
    shortLabel: 'Ťah',
    exercises: [
      {
        exerciseId: 'lat-pulldown',
        role: 'main',
        baseSets: 4,
        scheme: 'strength',
        restSeconds: 120,
        tempo: '2-1-1',
        cue: '1 s podrž tyč pri hrudníku, pomaly hore.',
      },
      {
        exerciseId: 'barbell-row',
        alternateExerciseId: 'one-arm-dumbbell-row',
        role: 'main',
        baseSets: 3,
        scheme: 'hypertrophy',
        restSeconds: 90,
        tempo: '2-1-1',
        cue: 'Na vrchu 1 s stiahni lopatky.',
      },
      {
        exerciseId: 'reverse-fly',
        role: 'accessory',
        baseSets: 3,
        scheme: 'high',
        restSeconds: 45,
        tempo: '2-1-1',
        cue: 'Ľahká váha, 1 s podrž v rozpažení.',
      },
      {
        exerciseId: 'dumbbell-curl',
        role: 'accessory',
        baseSets: 3,
        scheme: 'hypertrophy',
        restSeconds: 60,
        tempo: '3-0-1',
        cue: '3 s pomalé spúšťanie.',
      },
      {
        exerciseId: 'farmers-carry',
        role: 'accessory',
        baseSets: 3,
        scheme: 'carry',
        restSeconds: 60,
        tempo: '0-0-0',
        cue: 'Vzpriamene, krátke rýchle kroky.',
      },
    ],
  },
};

/** Exercise used by a template slot in the given week (variants in weeks 2 and 4). */
export function exerciseIdForWeek(template: StrengthTemplate, week: WeekNumber): string {
  return week % 2 === 0 && template.alternateExerciseId
    ? template.alternateExerciseId
    : template.exerciseId;
}

/** Zone 2 run duration (main part) in minutes per week. */
export const ZONE2_MINUTES: Record<WeekNumber, number> = { 1: 30, 2: 35, 3: 40, 4: 25 };

export interface IntervalSpec {
  repeats: number;
  hardMinutes: number;
  easyMinutes: number;
}

/** Saturday interval session per week. */
export const INTERVALS: Record<WeekNumber, IntervalSpec> = {
  1: { repeats: 6, hardMinutes: 2, easyMinutes: 2 },
  2: { repeats: 7, hardMinutes: 2, easyMinutes: 2 },
  3: { repeats: 8, hardMinutes: 2, easyMinutes: 2 },
  4: { repeats: 4, hardMinutes: 2, easyMinutes: 2 },
};

export const SAFETY_NOTE =
  'Tento plán je všeobecné odporúčanie, nie lekárska rada. Ak máš zdravotné problémy, ' +
  'bolesti, užívaš lieky alebo si dlhšie necvičil(a), poraď sa pred začatím s lekárom. ' +
  'Pri ostrej bolesti, závrate alebo tlaku na hrudníku cvičenie okamžite ukonči.';
