import { addDays, isValidIsoDate, nextMondayOnOrAfter, weekdayIndex } from './dates';
import { estimateMinutes, secondsPerRep } from './duration';
import { requireExercise } from './exercises';
import {
  GYM_SESSIONS,
  INTERVALS,
  REP_SCHEMES,
  TIMED_SCHEMES,
  WEEKS,
  ZONE2_MINUTES,
  exerciseIdForWeek,
  type GymSessionKey,
  type RepScheme,
  type StrengthTemplate,
} from './templates';
import type {
  DayPlan,
  DayType,
  StrengthItem,
  TimedItem,
  TrainingPlan,
  WeekNumber,
  WorkoutSection,
} from './types';

export const PLAN_WEEKS = 4;
export const DAYS_PER_WEEK = 7;

/**
 * Fraction of peak-week sets kept per exercise in the deload week. After
 * rounding to whole sets the deload removes ~40 % of the peak-week sets
 * (asserted in plan.test.ts and stated in the week-4 focus text).
 */
export const DELOAD_SET_FACTOR = 0.6;

type DaySlot =
  | { type: 'gym'; session: GymSessionKey }
  | { type: 'cardio'; variant: 'zone2' | 'intervals' }
  | { type: 'rest'; variant: 'mobility' | 'full' };

/** Weekly layout, index 0 = Monday. */
export const WEEK_LAYOUT: readonly DaySlot[] = [
  { type: 'gym', session: 'legs' },
  { type: 'cardio', variant: 'zone2' },
  { type: 'gym', session: 'push' },
  { type: 'rest', variant: 'mobility' },
  { type: 'gym', session: 'pull' },
  { type: 'cardio', variant: 'intervals' },
  { type: 'rest', variant: 'full' },
];

export function setsForWeek(template: StrengthTemplate, week: WeekNumber): number {
  const base = template.baseSets;
  // Week 2 adds a set to the main lifts; week 3 keeps that volume and raises
  // intensity instead (fewer reps, heavier, longer rest) so sessions stay ≤ 65 min.
  const loaded = template.role === 'main' ? base + 1 : base;
  switch (week) {
    case 1:
      return base;
    case 2:
    case 3:
      return loaded;
    case 4:
      return Math.max(1, Math.round(loaded * DELOAD_SET_FACTOR));
  }
}

const MEASURES: Record<RepScheme, StrengthItem['measure']> = {
  strength: 'reps',
  hypertrophy: 'reps',
  high: 'reps',
  hold: 'hold',
  carry: 'distance',
};

export function buildStrengthItem(template: StrengthTemplate, week: WeekNumber): StrengthItem {
  const rep = REP_SCHEMES[template.scheme][week - 1];
  if (!rep) throw new Error(`Missing rep scheme for week ${week}`);
  const workSecondsPerSet = TIMED_SCHEMES.has(template.scheme)
    ? rep.value
    : rep.value * secondsPerRep(template.tempo);
  return {
    kind: 'strength',
    exerciseId: exerciseIdForWeek(template, week),
    sets: setsForWeek(template, week),
    reps: rep.label,
    measure: MEASURES[template.scheme],
    workSecondsPerSet,
    restSeconds:
      week === 3 ? (template.peakRestSeconds ?? template.restSeconds) : template.restSeconds,
    rir: WEEKS[week].rir,
    tempo: template.tempo,
    cue: template.cue,
  };
}

function gymDay(session: GymSessionKey, week: WeekNumber): Omit<DayPlan, 'date' | 'weekday'> {
  const template = GYM_SESSIONS[session];
  const first = template.exercises[0];
  if (!first) throw new Error(`Session ${session} has no exercises`);
  const firstId = exerciseIdForWeek(first, week);
  const firstName = requireExercise(firstId).name;

  const warmup: WorkoutSection = {
    kind: 'warmup',
    title: 'Rozcvička',
    items: [
      {
        kind: 'timed',
        name: 'Ľahké kardio',
        minutes: 5,
        detail: 'Rotoped, veslovací trenažér alebo rýchla chôdza do kopca.',
        intensity: 'RPE 3–4',
      },
      {
        kind: 'timed',
        name: 'Dynamická mobilita',
        minutes: 3,
        detail: 'Výpady s rotáciou, krúženie bokov a ramien, 5–6 opakovaní na stranu.',
        exerciseId: 'worlds-greatest-stretch',
      },
      {
        kind: 'timed',
        name: 'Rozcvičovacie série',
        minutes: 2,
        detail: `${firstName}: 2–3 ľahké série s 40–70 % pracovnej váhy.`,
        exerciseId: firstId,
      },
    ],
  };

  const main: WorkoutSection = {
    kind: 'main',
    title: 'Hlavná časť',
    items: template.exercises.map((t) => buildStrengthItem(t, week)),
  };

  const sections: WorkoutSection[] = [warmup, main];

  if (week === 4) {
    sections.push({
      kind: 'mobility',
      title: 'Mobilita navyše (deload)',
      items: [
        {
          kind: 'timed',
          name: 'Hlboký drep s výdržou',
          minutes: 4,
          detail: '4 × 45 s, medzi výdržami sa postav a uvoľni.',
          exerciseId: 'deep-squat-hold',
        },
        {
          kind: 'timed',
          name: 'Rotácie hrudnej chrbtice',
          minutes: 4,
          detail: '10 pomalých rotácií na každú stranu.',
          exerciseId: 'thoracic-rotation',
        },
        {
          kind: 'timed',
          name: 'Mačka – krava',
          minutes: 2,
          detail: '10 pomalých opakovaní v rytme dychu.',
          exerciseId: 'cat-cow',
        },
      ],
    });
  }

  sections.push({
    kind: 'cooldown',
    title: 'Upokojenie',
    items: [
      {
        kind: 'timed',
        name: 'Vydýchanie a strečing',
        minutes: 5,
        detail: 'Statický strečing precvičených svalov 30–45 s na stranu, pomalé dýchanie nosom.',
      },
    ],
  });

  return {
    week,
    type: 'gym',
    gymSession: session,
    title: template.title,
    shortLabel: template.shortLabel,
    sections,
    estimatedMinutes: estimateMinutes(sections),
    notes: [
      `RIR ${WEEKS[week].rir} = počet opakovaní, ktoré by si ešte zvládol(a) s dobrou technikou.`,
      'Tempo je v sekundách: spúšťanie – pauza – zdvih.',
    ],
  };
}

const ZONE2_INTENSITY = 'Zóna 2: 60–70 % HRmax, RPE 3–4 – dokážeš rozprávať v celých vetách.';

function zone2Day(week: WeekNumber): Omit<DayPlan, 'date' | 'weekday'> {
  const minutes = ZONE2_MINUTES[week];
  const sections: WorkoutSection[] = [
    {
      kind: 'warmup',
      title: 'Rozcvička',
      items: [
        {
          kind: 'timed',
          name: 'Rýchla chôdza a ľahký klus',
          minutes: 5,
          detail: 'Postupne zrýchľuj z chôdze do veľmi pomalého klusu.',
          intensity: 'RPE 2–3',
        },
        {
          kind: 'timed',
          name: 'Bežecká abeceda a dynamický strečing',
          minutes: 5,
          detail: 'Liftingy, zakopávanie, výpady s rotáciou, krúženie bokov.',
          exerciseId: 'worlds-greatest-stretch',
        },
      ],
    },
    {
      kind: 'main',
      title: 'Hlavná časť',
      items: [
        {
          kind: 'timed',
          name: `Ľahký beh ${minutes} min`,
          minutes,
          detail: 'Rovnomerné uvoľnené tempo na rovine alebo v miernom teréne.',
          exerciseId: 'zone2-run',
          alternativeExerciseId: 'stationary-bike',
          intensity: ZONE2_INTENSITY,
        },
      ],
    },
    {
      kind: 'cooldown',
      title: 'Upokojenie',
      items: [
        {
          kind: 'timed',
          name: 'Vychádzanie',
          minutes: 5,
          detail: 'Pokojná chôdza, kým sa dych úplne neupokojí.',
          intensity: 'RPE 1–2',
        },
        {
          kind: 'timed',
          name: 'Strečing lýtok, stehien a bokov',
          minutes: 5,
          detail: '30–45 s na každý sval a stranu.',
        },
      ],
    },
  ];
  return {
    week,
    type: 'cardio',
    title: 'Beh – ľahký beh v zóne 2',
    shortLabel: `Zóna 2 · ${minutes} min`,
    sections,
    estimatedMinutes: estimateMinutes(sections),
    notes: [
      ZONE2_INTENSITY,
      'HRmax orientačne odhadni ako 220 − vek, presnejšie ju určí záťažový test.',
      `Alternatíva: rotoped alebo veslovací trenažér ${minutes} min v rovnakej zóne.`,
    ],
  };
}

const HARD_INTENSITY = 'Rýchly úsek: RPE 8, 85–90 % HRmax. Oddych: RPE 2–3, chôdza alebo klus.';

function intervalDay(week: WeekNumber): Omit<DayPlan, 'date' | 'weekday'> {
  const spec = INTERVALS[week];
  const mainMinutes = spec.repeats * (spec.hardMinutes + spec.easyMinutes);
  const label = `${spec.repeats} × ${spec.hardMinutes} min`;
  const sections: WorkoutSection[] = [
    {
      kind: 'warmup',
      title: 'Rozcvička',
      items: [
        {
          kind: 'timed',
          name: 'Ľahký klus',
          minutes: 8,
          detail: 'Začni veľmi pomaly, posledné 2 minúty mierne zrýchli.',
          intensity: 'RPE 3–4',
        },
        {
          kind: 'timed',
          name: 'Dynamická rozcvička a 3 rovinky',
          minutes: 4,
          detail: 'Bežecká abeceda, potom 3 × 15 s stupňovaný beh s návratom chôdzou.',
          exerciseId: 'worlds-greatest-stretch',
        },
      ],
    },
    {
      kind: 'main',
      title: 'Hlavná časť',
      items: [
        {
          kind: 'timed',
          name: `Intervaly ${label} rýchlo / ${spec.easyMinutes} min voľne`,
          minutes: mainMinutes,
          detail: `${spec.repeats}× opakuj: ${spec.hardMinutes} min rýchly beh, ${spec.easyMinutes} min voľný klus alebo chôdza.`,
          exerciseId: 'interval-run',
          alternativeExerciseId: 'stationary-bike',
          intensity: HARD_INTENSITY,
        },
      ],
    },
    {
      kind: 'cooldown',
      title: 'Upokojenie',
      items: [
        {
          kind: 'timed',
          name: 'Výklus a chôdza',
          minutes: 5,
          detail: 'Veľmi pomalý klus, potom chôdza.',
          intensity: 'RPE 1–2',
        },
        {
          kind: 'timed',
          name: 'Strečing',
          minutes: 5,
          detail: 'Lýtka, predné a zadné stehná, bedrové flexory – 30–45 s na stranu.',
        },
      ],
    },
  ];
  return {
    week,
    type: 'cardio',
    title: week === 4 ? 'Beh – ľahšie intervaly (deload)' : 'Beh – intervaly',
    shortLabel: `Intervaly ${label}`,
    sections,
    estimatedMinutes: estimateMinutes(sections),
    notes: [
      HARD_INTENSITY,
      'Alternatíva: rovnaké intervaly na rotopede alebo veslovacom trenažéri.',
      'Ak máš za sebou dlhšiu pauzu, začni so 4 opakovaniami a pridávaj postupne.',
    ],
  };
}

function mobilityDay(week: WeekNumber): Omit<DayPlan, 'date' | 'weekday'> {
  const items: TimedItem[] = [
    {
      kind: 'timed',
      name: 'Mačka – krava',
      minutes: 2,
      detail: '10–12 pomalých opakovaní v rytme dychu.',
      exerciseId: 'cat-cow',
    },
    {
      kind: 'timed',
      name: 'Výpad s rotáciou',
      minutes: 4,
      detail: '5 opakovaní na stranu, v krajnej polohe 2 nádychy.',
      exerciseId: 'worlds-greatest-stretch',
    },
    {
      kind: 'timed',
      name: 'Rotácie hrudnej chrbtice',
      minutes: 3,
      detail: '8 rotácií na každú stranu.',
      exerciseId: 'thoracic-rotation',
    },
    {
      kind: 'timed',
      name: 'Hlboký drep s výdržou',
      minutes: 3,
      detail: '3 × 40 s s oporou, ak treba.',
      exerciseId: 'deep-squat-hold',
    },
    {
      kind: 'timed',
      name: 'Krúženie ramien a bokov',
      minutes: 3,
      detail: 'Veľké pomalé kruhy, 10 na každú stranu.',
    },
    {
      kind: 'timed',
      name: 'Dýchanie bránicou v ľahu',
      minutes: 3,
      detail: 'Nádych nosom 4 s do brucha, výdych ústami 6 s.',
    },
  ];
  const sections: WorkoutSection[] = [{ kind: 'mobility', title: 'Mobilita', items }];
  const minutes = estimateMinutes(sections);
  return {
    week,
    type: 'rest',
    title: 'Odpočinok + mobilita',
    shortLabel: `Mobilita · ${minutes} min`,
    sections,
    estimatedMinutes: minutes,
    notes: [
      'Aktívna regenerácia: pohyb bez námahy, nič nesmie bolieť.',
      'Voliteľne pridaj 20–30 min prechádzku.',
    ],
  };
}

function fullRestDay(week: WeekNumber): Omit<DayPlan, 'date' | 'weekday'> {
  return {
    week,
    type: 'rest',
    title: 'Odpočinok',
    shortLabel: 'Voľno',
    sections: [],
    estimatedMinutes: 0,
    notes: [
      'Úplný odpočinok – svaly rastú počas regenerácie.',
      'Spánok 7–9 hodín, dostatok bielkovín (1,6–2 g/kg) a tekutín.',
      'Voliteľne ľahká prechádzka 30–45 minút.',
    ],
  };
}

function buildDay(slot: DaySlot, week: WeekNumber): Omit<DayPlan, 'date' | 'weekday'> {
  switch (slot.type) {
    case 'gym':
      return gymDay(slot.session, week);
    case 'cardio':
      return slot.variant === 'zone2' ? zone2Day(week) : intervalDay(week);
    case 'rest':
      return slot.variant === 'mobility' ? mobilityDay(week) : fullRestDay(week);
  }
}

/**
 * Generates the 4-week plan. Pure and deterministic: the same start date
 * always yields the same plan.
 */
export function generatePlan(startDate: string): TrainingPlan {
  if (!isValidIsoDate(startDate)) {
    throw new Error(`Invalid start date: ${startDate}`);
  }
  if (weekdayIndex(startDate) !== 0) {
    throw new Error(`Plan must start on a Monday, got ${startDate}`);
  }
  const days: DayPlan[] = [];
  for (let w = 0; w < PLAN_WEEKS; w++) {
    const week = (w + 1) as WeekNumber;
    WEEK_LAYOUT.forEach((slot, weekday) => {
      const date = addDays(startDate, w * DAYS_PER_WEEK + weekday);
      days.push({ date, weekday, ...buildDay(slot, week) });
    });
  }
  return {
    startDate,
    endDate: addDays(startDate, PLAN_WEEKS * DAYS_PER_WEEK - 1),
    weeks: [WEEKS[1], WEEKS[2], WEEKS[3], WEEKS[4]],
    days,
  };
}

/** Default start: the given day if Monday, else the following Monday. */
export function defaultStartDate(todayIso: string): string {
  return nextMondayOnOrAfter(todayIso);
}

export function findDay(plan: TrainingPlan, date: string): DayPlan | undefined {
  return plan.days.find((d) => d.date === date);
}

export function dayTypeCounts(days: DayPlan[]): Record<DayType, number> {
  const counts: Record<DayType, number> = { gym: 0, cardio: 0, rest: 0 };
  for (const day of days) counts[day.type]++;
  return counts;
}

/** Unique exercise ids performed on a day, in order of appearance. */
export function exerciseIdsOfDay(day: DayPlan): string[] {
  const ids = day.sections
    .flatMap((s) => s.items)
    .map((item) => item.exerciseId)
    .filter((id): id is string => typeof id === 'string');
  return [...new Set(ids)];
}

/** Exercise ids linked from a day, including equivalent alternatives. */
export function linkedExerciseIdsOfDay(day: DayPlan): string[] {
  const alternatives = day.sections
    .flatMap((s) => s.items)
    .flatMap((item) =>
      item.kind === 'timed' && item.alternativeExerciseId ? [item.alternativeExerciseId] : [],
    );
  return [...new Set([...exerciseIdsOfDay(day), ...alternatives])];
}
