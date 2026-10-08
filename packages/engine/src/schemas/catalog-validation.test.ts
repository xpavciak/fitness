import { describe, expect, it } from 'vitest';
import { ids, samples } from '../__fixtures__/samples.js';
import { EXERCISE_CATALOG } from '../catalog/index.js';
import { createCatalogValidators } from './catalog-validation.js';

const validators = createCatalogValidators(EXERCISE_CATALOG);

function messagesAt(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('createCatalogValidators', () => {
  it('accepts plans and logs that only reference catalog exercises', () => {
    expect(validators.Plan.safeParse(samples.plan()).success).toBe(true);
    expect(validators.WorkoutLog.safeParse(samples.workoutLog()).success).toBe(true);
    expect(validators.PlannedExercise.safeParse(samples.plannedExercise()).success).toBe(true);
    expect(validators.SetLog.safeParse(samples.setLog()).success).toBe(true);
  });

  it('rejects an unknown exercise_id on a planned exercise and a set log', () => {
    const pe = { ...samples.plannedExercise(), exercise_id: 'quantum_squat' };
    expect(messagesAt(validators.PlannedExercise.safeParse(pe))).toEqual([
      'exercise_id: Unknown exercise_id "quantum_squat" (not in the exercise catalog)',
    ]);
    const set = { ...samples.setLog(), exercise_id: 'quantum_squat' };
    expect(validators.SetLog.safeParse(set).success).toBe(false);
  });

  it('reports the full path of an unknown exercise_id deep inside a plan', () => {
    const plan = samples.plan();
    const session = plan.weeks[0]?.sessions[0];
    const second = session?.exercises[1];
    if (!session || !second) throw new Error('fixture missing data');
    second.exercise_id = 'made_up_press';
    const messages = messagesAt(validators.Plan.safeParse(plan));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^weeks\.0\.sessions\.0\.exercises\.1\.exercise_id: Unknown/);
  });

  it('checks session- and week-level schemas and workout log sets', () => {
    const plan = samples.plan();
    const week = plan.weeks[0];
    const session = week?.sessions[0];
    const first = session?.exercises[0];
    if (!week || !session || !first) throw new Error('fixture missing data');
    first.exercise_id = 'nope';
    expect(validators.PlannedSession.safeParse(session).success).toBe(false);
    expect(validators.PlanWeek.safeParse(week).success).toBe(false);

    const log = samples.workoutLog();
    log.sets.push({ ...samples.setLog(), id: ids.other1, set_index: 1, exercise_id: 'nope' });
    expect(messagesAt(validators.WorkoutLog.safeParse(log))[0]).toMatch(/^sets\.1\.exercise_id/);
  });

  it('still applies structural rules (rep_min > rep_max) alongside the catalog check', () => {
    const pe = { ...samples.plannedExercise(), rep_min: 10, rep_max: 6 };
    expect(validators.PlannedExercise.safeParse(pe).success).toBe(false);
  });

  it('works with an empty catalog (everything unknown) and exposes isKnownExerciseId', () => {
    const empty = createCatalogValidators([]);
    expect(empty.isKnownExerciseId('goblet_squat')).toBe(false);
    expect(validators.isKnownExerciseId('goblet_squat')).toBe(true);
    expect(empty.SetLog.safeParse(samples.setLog()).success).toBe(false);
  });
});
