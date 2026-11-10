import { describe, expect, it } from 'vitest';
import {
  REQUIRED_MUSCLE_GROUPS,
  addDays,
  dayTypeCounts,
  defaultStartDate,
  exerciseIdsOfDay,
  findDay,
  generatePlan,
  getExercise,
  linkedExerciseIdsOfDay,
  listExercises,
  requireExercise,
  totalSets,
  weekdayIndex,
  type MuscleGroup,
} from './index';

const START = '2026-11-16';
const plan = generatePlan(START);

describe('generatePlan structure', () => {
  it('produces 4 weeks of 7 consecutive days starting on Monday', () => {
    expect(plan.days).toHaveLength(28);
    expect(plan.startDate).toBe(START);
    expect(plan.endDate).toBe('2026-12-13');
    plan.days.forEach((day, i) => {
      expect(day.date).toBe(addDays(START, i));
      expect(day.weekday).toBe(i % 7);
      expect(day.week).toBe(Math.floor(i / 7) + 1);
    });
  });

  it('has 3 gym, 2 cardio and 2 rest days every week in the fixed layout', () => {
    for (let w = 1; w <= 4; w++) {
      const week = plan.days.filter((d) => d.week === w);
      expect(dayTypeCounts(week)).toEqual({ gym: 3, cardio: 2, rest: 2 });
      expect(week.map((d) => d.type)).toEqual([
        'gym',
        'cardio',
        'gym',
        'rest',
        'gym',
        'cardio',
        'rest',
      ]);
      expect(week.map((d) => d.gymSession ?? null)).toEqual([
        'legs',
        null,
        'push',
        null,
        'pull',
        null,
        null,
      ]);
    }
  });

  it('uses split labels Nohy / Tlak / Ťah', () => {
    const labels = plan.days.filter((d) => d.type === 'gym').map((d) => d.shortLabel);
    expect(new Set(labels)).toEqual(new Set(['Nohy', 'Tlak', 'Ťah']));
  });

  it('rejects invalid or non-Monday start dates', () => {
    expect(() => generatePlan('2026-11-17')).toThrow(/Monday/);
    expect(() => generatePlan('2026-02-30')).toThrow(/Invalid/);
    expect(() => generatePlan('not-a-date')).toThrow(/Invalid/);
  });

  it('is deterministic', () => {
    expect(generatePlan(START)).toEqual(generatePlan(START));
    expect(JSON.stringify(generatePlan(START))).toBe(JSON.stringify(plan));
  });

  it('works across a year boundary and DST change', () => {
    const p = generatePlan('2026-12-28');
    expect(p.endDate).toBe('2027-01-24');
    expect(p.days.every((d) => weekdayIndex(d.date) === d.weekday)).toBe(true);
    const dst = generatePlan('2027-03-22');
    expect(dst.days[13]?.date).toBe('2027-04-04');
  });
});

describe('default start date', () => {
  it('is the same day on a Monday, otherwise the next Monday', () => {
    expect(defaultStartDate('2026-11-16')).toBe('2026-11-16');
    expect(defaultStartDate('2026-11-10')).toBe('2026-11-16');
    expect(defaultStartDate('2026-11-15')).toBe('2026-11-16');
  });
});

describe('whole-body coverage', () => {
  function musclesOf(days: typeof plan.days, kind: 'primary' | 'all'): Set<MuscleGroup> {
    const set = new Set<MuscleGroup>();
    for (const day of days) {
      for (const id of exerciseIdsOfDay(day)) {
        const ex = requireExercise(id);
        ex.primaryMuscles.forEach((m) => set.add(m));
        if (kind === 'all') ex.secondaryMuscles.forEach((m) => set.add(m));
      }
    }
    return set;
  }

  it('trains every major muscle group as a primary target over the month', () => {
    const primary = musclesOf(plan.days, 'primary');
    for (const group of REQUIRED_MUSCLE_GROUPS) {
      expect(primary, `missing ${group}`).toContain(group);
    }
  });

  it('covers every group in each individual week, too', () => {
    for (let w = 1; w <= 4; w++) {
      const primary = musclesOf(
        plan.days.filter((d) => d.week === w),
        'primary',
      );
      for (const group of REQUIRED_MUSCLE_GROUPS) {
        expect(primary, `week ${w} missing ${group}`).toContain(group);
      }
    }
  });

  it('splits gym days into legs, push and pull muscle groups', () => {
    const byKey = (key: string) =>
      musclesOf(
        plan.days.filter((d) => d.gymSession === key),
        'primary',
      );
    expect([...byKey('legs')]).toEqual(
      expect.arrayContaining(['quads', 'hamstrings', 'glutes', 'calves', 'core']),
    );
    expect([...byKey('push')]).toEqual(expect.arrayContaining(['chest', 'shoulders', 'triceps']));
    expect([...byKey('pull')]).toEqual(
      expect.arrayContaining(['back', 'shoulders', 'biceps', 'core']),
    );
    expect(byKey('push').has('quads')).toBe(false);
    expect(byKey('legs').has('chest')).toBe(false);
  });

  it('rotates accessory variants week to week', () => {
    const legs1 = exerciseIdsOfDay(plan.days[0]!);
    const legs2 = exerciseIdsOfDay(plan.days[7]!);
    expect(legs1).toContain('bulgarian-split-squat');
    expect(legs2).toContain('walking-lunge');
    expect(legs2).toContain('back-squat');
  });
});

describe('durations', () => {
  it('keeps every gym session between 50 and 70 minutes', () => {
    for (const day of plan.days.filter((d) => d.type === 'gym')) {
      expect(day.estimatedMinutes, day.date).toBeGreaterThanOrEqual(50);
      expect(day.estimatedMinutes, day.date).toBeLessThanOrEqual(70);
    }
  });

  it('gym sessions have 8–10 min warm-up, 4–5 exercises and 5 min cool-down', () => {
    for (const day of plan.days.filter((d) => d.type === 'gym')) {
      const minutesOf = (kind: string) =>
        day.sections
          .filter((s) => s.kind === kind)
          .flatMap((s) => s.items)
          .reduce((sum, item) => sum + (item.kind === 'timed' ? item.minutes : 0), 0);
      expect(minutesOf('warmup')).toBeGreaterThanOrEqual(8);
      expect(minutesOf('warmup')).toBeLessThanOrEqual(10);
      expect(minutesOf('cooldown')).toBe(5);
      const main = day.sections.find((s) => s.kind === 'main');
      expect(main?.items.length).toBeGreaterThanOrEqual(4);
      expect(main?.items.length).toBeLessThanOrEqual(5);
      main?.items.forEach((item) => {
        expect(item.kind).toBe('strength');
        if (item.kind === 'strength') {
          expect(item.restSeconds).toBeGreaterThan(0);
          expect(item.tempo).toMatch(/^\d-\d-\d$/);
          expect(item.rir).not.toBe('');
        }
      });
    }
  });

  it('keeps cardio sessions at 45–60 min (deload week may be shorter)', () => {
    for (const day of plan.days.filter((d) => d.type === 'cardio')) {
      expect(day.estimatedMinutes).toBeLessThanOrEqual(60);
      expect(day.estimatedMinutes).toBeGreaterThanOrEqual(day.week === 4 ? 35 : 45);
      expect(day.notes.join(' ')).toMatch(/HRmax/);
    }
  });

  it('has a 15–20 min mobility session on Thursdays and full rest on Sundays', () => {
    for (const day of plan.days.filter((d) => d.weekday === 3)) {
      expect(day.type).toBe('rest');
      expect(day.estimatedMinutes).toBeGreaterThanOrEqual(15);
      expect(day.estimatedMinutes).toBeLessThanOrEqual(20);
    }
    for (const day of plan.days.filter((d) => d.weekday === 6)) {
      expect(day.type).toBe('rest');
      expect(day.sections).toHaveLength(0);
    }
  });
});

describe('progression and deload', () => {
  const gymSets = (week: number) =>
    plan.days.filter((d) => d.week === week && d.type === 'gym').map(totalSets);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it('increases volume from week 1 to week 3', () => {
    expect(sum(gymSets(2))).toBeGreaterThan(sum(gymSets(1)));
    expect(sum(gymSets(3))).toBeGreaterThan(sum(gymSets(2)));
  });

  it('cuts ~45 % of sets in the deload week (as the focus text says) and raises RIR to 4', () => {
    const removed = 1 - sum(gymSets(4)) / sum(gymSets(3));
    expect(removed).toBeGreaterThanOrEqual(0.4);
    expect(removed).toBeLessThanOrEqual(0.5);
    expect(plan.weeks[3]?.focus).toContain(`~${Math.round(removed * 20) * 5} %`);
    const rirs = plan.days
      .filter((d) => d.week === 4)
      .flatMap((d) => d.sections.flatMap((s) => s.items))
      .flatMap((i) => (i.kind === 'strength' ? [i.rir] : []));
    expect(new Set(rirs)).toEqual(new Set(['4']));
    expect(plan.weeks[3]?.name).toBe('Odľahčenie');
  });

  it('gives heavy squat and bench sets 180 s rest in the peak week', () => {
    const restOf = (week: number, id: string) =>
      plan.days
        .filter((d) => d.week === week)
        .flatMap((d) => d.sections.flatMap((s) => s.items))
        .find((i) => i.kind === 'strength' && i.exerciseId === id);
    for (const id of ['back-squat', 'bench-press']) {
      expect(restOf(3, id)).toMatchObject({ restSeconds: 180, reps: '4–6' });
      expect(restOf(2, id)).toMatchObject({ restSeconds: 150 });
    }
  });

  it('marks holds and carries so the UI shows time/distance instead of tempo', () => {
    const items = plan.days.flatMap((d) => d.sections.flatMap((s) => s.items));
    expect(items.find((i) => i.exerciseId === 'farmers-carry')).toMatchObject({
      measure: 'distance',
      reps: '30 m',
    });
    expect(items.find((i) => i.exerciseId === 'plank')).toMatchObject({ measure: 'hold' });
    expect(items.find((i) => i.exerciseId === 'back-squat' && i.kind === 'strength')).toMatchObject(
      { measure: 'reps' },
    );
  });

  it('uses RIR 3 / 2 / 1–2 in weeks 1–3', () => {
    expect(plan.weeks.map((w) => w.rir)).toEqual(['3', '2', '1–2', '4']);
  });

  it('makes deload intervals lighter than the peak week', () => {
    const sat = (w: number) => plan.days.find((d) => d.week === w && d.weekday === 5)!;
    expect(sat(4).estimatedMinutes).toBeLessThan(sat(3).estimatedMinutes);
    expect(sat(3).estimatedMinutes).toBeGreaterThan(sat(1).estimatedMinutes);
  });
});

describe('exercise library', () => {
  it('every referenced exercise exists', () => {
    for (const day of plan.days) {
      for (const id of exerciseIdsOfDay(day)) expect(getExercise(id), id).toBeDefined();
    }
  });

  it('every exercise has complete Slovak content', () => {
    for (const ex of listExercises()) {
      expect(ex.steps.length, ex.id).toBeGreaterThanOrEqual(3);
      expect(ex.steps.length, ex.id).toBeLessThanOrEqual(5);
      expect(ex.mistakes.length, ex.id).toBeGreaterThan(0);
      expect(ex.primaryMuscles.length, ex.id).toBeGreaterThan(0);
      expect(ex.easier && ex.harder && ex.equipment && ex.animation, ex.id).toBeTruthy();
    }
  });

  it('heavy barbell lifts include safety setup and bail-out guidance', () => {
    for (const id of ['back-squat', 'bench-press']) {
      const safety = requireExercise(id).safety ?? [];
      expect(safety.length, id).toBeGreaterThan(0);
      expect(safety.join(' '), id).toMatch(/bezpečnostn/);
    }
  });

  it('references the bike as the cardio alternative', () => {
    const cardio = plan.days.filter((d) => d.type === 'cardio');
    for (const day of cardio) {
      expect(linkedExerciseIdsOfDay(day)).toContain('bike-intervals');
      expect(exerciseIdsOfDay(day)).not.toContain('bike-intervals');
    }
  });

  it('findDay returns undefined outside the plan', () => {
    expect(findDay(plan, '2026-11-15')).toBeUndefined();
    expect(findDay(plan, START)?.shortLabel).toBe('Nohy');
  });
});
