import { createSeededIdGenerator, type WorkoutLog } from '@fitness/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { at, onboardedPlan, must } from '../test/fixtures';
import { MemoryKeyValueStore } from './key-value-store';
import {
  EMPTY_APP_DATA,
  EXPORT_FORMAT,
  LocalRepository,
  STORAGE_KEYS,
  StoredDataError,
} from './repository';

const { plan, outcome } = onboardedPlan();
const session = must(must(plan.weeks[0]).sessions[0]);
const newId = createSeededIdGenerator(31);

function log(reps = 8): WorkoutLog {
  const id = newId();
  return {
    id,
    user_id: outcome.profile.user_id,
    planned_session_id: session.id,
    started_at: at(session.scheduled_date),
    sets: [
      {
        id: newId(),
        workout_log_id: id,
        exercise_id: 'goblet_squat',
        set_index: 0,
        measure: 'reps',
        reps,
        load_kg: 16,
        is_warmup: false,
        completed: true,
        performed_at: at(session.scheduled_date, '10:05:00'),
      },
    ],
  };
}

let store: MemoryKeyValueStore;
let repo: LocalRepository;

beforeEach(() => {
  store = new MemoryKeyValueStore();
  repo = new LocalRepository(store);
});

describe('LocalRepository', () => {
  it('loads empty data on first launch', async () => {
    await expect(repo.load()).resolves.toEqual(EMPTY_APP_DATA);
  });

  it('round-trips profile, goal, plan, logs and schedule changes', async () => {
    const first = log();
    await repo.saveProfile(outcome.profile);
    await repo.saveGoal(outcome.goal);
    await repo.savePlan(plan);
    await repo.saveWorkoutLog(first);
    const change = {
      id: newId(),
      plan_id: plan.id,
      planned_session_id: session.id,
      kind: 'skip' as const,
      reason: 'Skipped for a test.',
      from_date: session.scheduled_date,
      created_by: 'user' as const,
      created_at: at(session.scheduled_date),
    };
    await repo.addScheduleChanges([change]);
    await expect(repo.load()).resolves.toEqual({
      profile: outcome.profile,
      goal: outcome.goal,
      plan,
      workoutLogs: [first],
      scheduleChanges: [change],
    });
  });

  it('upserts workout logs by id', async () => {
    const first = log(8);
    await repo.saveWorkoutLog(first);
    const edited = { ...first, notes: 'Felt strong' };
    await repo.saveWorkoutLog(edited);
    await repo.saveWorkoutLog(log(10));
    const { workoutLogs } = await repo.load();
    expect(workoutLogs).toHaveLength(2);
    expect(workoutLogs[0]).toEqual(edited);
  });

  it('validates with the engine schemas before writing', async () => {
    const bad = { ...log(), sets: [{ ...must(log().sets[0]), exercise_id: 'not_in_catalog' }] };
    await expect(repo.saveWorkoutLog(bad)).rejects.toThrow(/Unknown exercise_id/);
    await expect(repo.saveProfile({ ...outcome.profile, session_minutes: 5 })).rejects.toThrow();
    expect(store.keys()).toEqual([]);
  });

  it('reports corrupt or invalid stored data explicitly', async () => {
    await store.setItem(STORAGE_KEYS.plan, '{not json');
    await expect(repo.load()).rejects.toBeInstanceOf(StoredDataError);
    await store.setItem(STORAGE_KEYS.plan, JSON.stringify({ ...plan, weeks: [] }));
    await expect(repo.load()).rejects.toThrow(/fitness\/v1\/plan/);
  });

  it('exports everything as JSON-safe data', async () => {
    await repo.saveProfile(outcome.profile);
    await repo.savePlan(plan);
    const exported = await repo.exportData('2026-10-08T12:00:00.000Z');
    expect(exported).toMatchObject({
      format: EXPORT_FORMAT,
      version: 1,
      exported_at: '2026-10-08T12:00:00.000Z',
      profile: outcome.profile,
      plan,
      goal: null,
    });
    expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);
  });

  it('deletes all local data', async () => {
    await repo.saveProfile(outcome.profile);
    await repo.saveWorkoutLog(log());
    await store.setItem('unrelated', 'kept');
    await repo.clearAll();
    expect(store.keys()).toEqual(['unrelated']);
    await expect(repo.load()).resolves.toEqual(EMPTY_APP_DATA);
  });
});

describe('LocalRepository: atomic setup and concurrency', () => {
  it('serializes overlapping read-modify-write updates', async () => {
    const logs = [log(5), log(6), log(7)];
    await Promise.all(logs.map((entry) => repo.saveWorkoutLog(entry)));
    expect((await repo.load()).workoutLogs).toEqual(logs);
  });

  it('writes nothing when any part of the setup is invalid', async () => {
    await expect(
      repo.saveSetup({
        profile: outcome.profile,
        goal: outcome.goal,
        plan: { ...plan, weeks: [] },
      }),
    ).rejects.toThrow();
    await expect(
      repo.saveSetup({
        profile: outcome.profile,
        goal: { ...outcome.goal, user_id: '00000009-0000-4000-8000-000000000009' },
        plan,
      }),
    ).rejects.toThrow(/same user/);
    expect(store.keys()).toEqual([]);
  });

  it('removes the plan when the setup has none', async () => {
    await repo.saveSetup({ profile: outcome.profile, goal: outcome.goal, plan });
    await repo.saveSetup({ profile: outcome.profile, goal: outcome.goal, plan: null });
    const loaded = await repo.load();
    expect(loaded.plan).toBeNull();
    expect(loaded.profile).toEqual(outcome.profile);
  });
});
