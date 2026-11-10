import { describe, expect, it } from 'vitest';
import {
  GYM_SESSIONS,
  SWAP_OPTIONS,
  generatePlan,
  getExercise,
  sanitizeSwaps,
  swapChoices,
  tempoCue,
  type StrengthItem,
} from '.';

const START = '2026-11-16';

function strengthItems(plan: ReturnType<typeof generatePlan>): StrengthItem[] {
  return plan.days
    .flatMap((d) => d.sections)
    .flatMap((s) => s.items)
    .filter((i): i is StrengthItem => i.kind === 'strength');
}

describe('exercise swaps', () => {
  it('offers existing, non-cardio alternatives for every planned strength exercise', () => {
    const planned = new Set(strengthItems(generatePlan(START)).map((i) => i.exerciseId));
    for (const id of planned) {
      const options = SWAP_OPTIONS[id];
      expect(options?.length, id).toBeGreaterThan(0);
      for (const alt of options ?? []) {
        const exercise = getExercise(alt);
        expect(exercise, `${id} -> ${alt}`).toBeDefined();
        expect(alt).not.toBe(id);
        expect(exercise?.primaryMuscles).not.toContain('cardio');
        expect(exercise?.primaryMuscles).not.toContain('mobility');
      }
    }
  });

  it('keeps the kind of prescription (reps, hold, distance) for alternatives', () => {
    const measureOf = new Map<string, string>();
    for (const session of Object.values(GYM_SESSIONS)) {
      for (const t of session.exercises) {
        const measure = t.scheme === 'hold' ? 'hold' : t.scheme === 'carry' ? 'distance' : 'reps';
        measureOf.set(t.exerciseId, measure);
        if (t.alternateExerciseId) measureOf.set(t.alternateExerciseId, measure);
      }
    }
    for (const [id, options] of Object.entries(SWAP_OPTIONS)) {
      for (const alt of options) {
        if (measureOf.has(alt))
          expect(measureOf.get(alt), `${id} -> ${alt}`).toBe(measureOf.get(id));
      }
    }
    expect(SWAP_OPTIONS.plank).toEqual(['high-plank']);
    expect(SWAP_OPTIONS['farmers-carry']).toEqual(['suitcase-carry']);
  });

  it('replaces an exercise on every day of the plan, including its warm-up sets', () => {
    const plan = generatePlan(START, { 'back-squat': 'dumbbell-squat' });
    const items = strengthItems(plan);
    expect(items.some((i) => i.exerciseId === 'back-squat')).toBe(false);
    const swapped = items.filter((i) => i.exerciseId === 'dumbbell-squat');
    expect(swapped).toHaveLength(4);
    for (const item of swapped) {
      expect(item.replaces).toBe('back-squat');
      expect(item.cue).toMatch(/^Tempo: 3 s dole, 1 s pauza/);
    }
    const monday = plan.days[0]!;
    const warmup = monday.sections.find((s) => s.kind === 'warmup')!;
    const sets = warmup.items.find((i) => i.kind === 'timed' && i.name === 'Rozcvičovacie série');
    expect(sets?.exerciseId).toBe('dumbbell-squat');
    expect(sets?.kind === 'timed' && sets.detail).toMatch(/^Drep s jednoručkami na pleciach:/);
  });

  it('ignores invalid swaps', () => {
    const plain = generatePlan(START);
    expect(generatePlan(START, { 'back-squat': 'zone2-run' })).toEqual(plain);
    expect(generatePlan(START, { constructor: 'plank' })).toEqual(plain);
    expect(sanitizeSwaps({ 'back-squat': 'dumbbell-squat', plank: 'run', x: 1 })).toEqual({
      'back-squat': 'dumbbell-squat',
    });
    expect(sanitizeSwaps(null)).toEqual({});
    expect(sanitizeSwaps(['a'])).toEqual({});
  });

  it('never offers an exercise already used in the same session', () => {
    const plan = generatePlan(START);
    const squat = strengthItems(plan).find((i) => i.exerciseId === 'back-squat')!;
    // Bulgarian split squat and walking lunges are already part of leg day.
    expect(swapChoices(squat, plan, 'legs').map((e) => e.id)).toEqual(['dumbbell-squat']);

    const swappedPlan = generatePlan(START, { 'back-squat': 'dumbbell-squat' });
    const swapped = strengthItems(swappedPlan).find((i) => i.replaces === 'back-squat')!;
    expect(swapChoices(swapped, swappedPlan, 'legs')).toEqual([]);
  });

  it('describes the tempo when the original cue no longer applies', () => {
    expect(tempoCue({ tempo: '2-0-1', measure: 'reps' })).toBe('Tempo: 2 s dole, plynulo hore.');
    expect(tempoCue({ tempo: '3-1-2', measure: 'reps' })).toBe(
      'Tempo: 3 s dole, 1 s pauza, 2 s hore.',
    );
    expect(tempoCue({ tempo: '0-0-0', measure: 'hold' })).toMatch(/^Výdrž/);
  });
});
