import {
  createSeededIdGenerator,
  PARQ_BLOCK_MESSAGE,
  UNDER_18_MESSAGE,
  type WorkoutLog,
} from '@fitness/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { draftFromProfile } from '../logic/onboarding';
import { sessionsByDate } from '../logic/plan-view';
import { rescheduleProposals } from '../logic/actions';
import { MemoryKeyValueStore } from '../storage/key-value-store';
import { ClearDataError, LocalRepository, STORAGE_KEYS, type AppData } from '../storage/repository';
import { NoopSyncAdapter } from '../sync/sync-adapter';
import { at, completedDraft, must, NOW, TIMEZONE } from '../test/fixtures';
import { AppController } from './app-controller';

let store: MemoryKeyValueStore;
let repository: LocalRepository;
let controller: AppController;
let now: string;

function setup(kv = new MemoryKeyValueStore()): void {
  store = kv;
  repository = new LocalRepository(store);
  now = NOW;
  controller = new AppController({
    repository,
    sync: new NoopSyncAdapter(),
    newId: createSeededIdGenerator(41),
    timezone: () => TIMEZONE,
    now: () => now,
  });
}

function data(): AppData {
  const { state } = controller.getSnapshot();
  if (state.status !== 'ready') {
    throw new Error(`Expected ready state, got ${state.status}`);
  }
  return state.data;
}

async function onboard(): Promise<void> {
  await controller.load();
  const result = await controller.completeOnboarding(completedDraft());
  expect(result.ok).toBe(true);
}

/** The draft a user gets from "Edit my answers" (consent and disclaimer asked again). */
function editedDraft(changes: Parameters<typeof completedDraft>[0]) {
  const { profile, goal } = data();
  return {
    ...draftFromProfile(must(profile), goal),
    healthConsent: true,
    disclaimerAccepted: true,
    ...changes,
  };
}

function logFor(sessionId: string, date: string): WorkoutLog {
  const ids = createSeededIdGenerator(77);
  const id = ids();
  return {
    id,
    user_id: must(data().profile).user_id,
    planned_session_id: sessionId,
    started_at: at(date),
    ended_at: at(date, '11:00:00'),
    sets: [
      {
        id: ids(),
        workout_log_id: id,
        exercise_id: 'goblet_squat',
        set_index: 0,
        measure: 'reps',
        reps: 8,
        load_kg: 16,
        is_warmup: false,
        completed: true,
        performed_at: at(date, '10:10:00'),
      },
    ],
  };
}

beforeEach(() => {
  setup();
});

describe('AppController: edited answers that fail screening (B1)', () => {
  it('edit answers -> PAR-Q+ red flag -> no usable plan', async () => {
    await onboard();
    const before = must(data().profile);
    const draft = editedDraft({});
    now = '2026-10-09T09:00:00.000Z';
    const result = await controller.completeOnboarding({
      ...draft,
      parq: { ...draft.parq, chest_pain: true },
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'parq_red_flag',
      message: PARQ_BLOCK_MESSAGE,
    });

    // In memory and on disk: the updated, consented profile is kept and the plan is gone.
    for (const saved of [data(), await repository.load()]) {
      expect(saved.plan).toBeNull();
      expect(saved.profile?.user_id).toBe(before.user_id);
      expect(saved.profile?.parq.chest_pain).toBe(true);
      expect(saved.profile?.consent_health_at).toBe(now);
    }
    // Regenerate re-screens instead of bringing a plan back.
    await expect(controller.regeneratePlan()).resolves.toMatchObject({ ok: false });
    expect(data().plan).toBeNull();
    expect(await store.getItem(STORAGE_KEYS.plan)).toBeNull();
  });

  it('edit answers -> under 18 -> no usable plan', async () => {
    await onboard();
    const result = await controller.completeOnboarding(editedDraft({ birthYear: '2010' }));
    expect(result).toMatchObject({ ok: false, reason: 'under_18', message: UNDER_18_MESSAGE });
    expect(data().plan).toBeNull();
    expect(data().profile?.birth_year).toBe(2010);
    expect((await repository.load()).plan).toBeNull();
  });

  it('clearing the red flag builds a plan again', async () => {
    await onboard();
    const draft = editedDraft({});
    await controller.completeOnboarding({ ...draft, parq: { ...draft.parq, chest_pain: true } });
    const cleared = editedDraft({});
    expect(cleared.parq.chest_pain).toBe(true); // the saved answers are prefilled
    const result = await controller.completeOnboarding({
      ...cleared,
      parq: { ...cleared.parq, chest_pain: false },
    });
    expect(result.ok).toBe(true);
    expect(data().plan).not.toBeNull();
  });

  it('a first-time blocked onboarding stores nothing', async () => {
    await controller.load();
    const draft = completedDraft();
    await controller.completeOnboarding({ ...draft, parq: { ...draft.parq, chest_pain: true } });
    expect(store.keys()).toEqual([]);
    expect(data().profile).toBeNull();
  });

  it('regenerate re-screens a saved profile that now fails (e.g. answers synced elsewhere)', async () => {
    await onboard();
    const profile = must(data().profile);
    await repository.saveProfile({ ...profile, parq: { ...profile.parq, chest_pain: true } });
    await controller.load();
    expect(data().plan).not.toBeNull();
    await expect(controller.regeneratePlan()).resolves.toMatchObject({ reason: 'parq_red_flag' });
    expect(data().plan).toBeNull();
    expect((await repository.load()).plan).toBeNull();
  });
});

describe('AppController: serialized mutations (S2)', () => {
  it('overlapping actions all land, in memory and on disk', async () => {
    await onboard();
    const [first, second] = sessionsByDate(must(must(data().plan).weeks[0]));
    now = at(must(second).scheduled_date, '08:00:00');
    const skip = must(
      rescheduleProposals(
        must(data().plan),
        must(data().profile),
        { type: 'missed', session_id: must(first).id },
        { now, newId: createSeededIdGenerator(5) },
      ).find((proposal) => proposal.kind === 'skip'),
    );
    const log = logFor(must(second).id, must(second).scheduled_date);

    // Fired together, as from two quick taps; neither may overwrite the other's result.
    const actions = Promise.all([controller.saveWorkout(log), controller.acceptProposal(skip)]);
    expect(controller.getSnapshot().busy).toBe(true);
    await actions;
    expect(controller.getSnapshot().busy).toBe(false);

    for (const saved of [data(), await repository.load()]) {
      const statuses = Object.fromEntries(
        must(saved.plan?.weeks[0]).sessions.map((session) => [session.id, session.status]),
      );
      expect(statuses[must(first).id]).toBe('skipped');
      expect(statuses[must(second).id]).toBe('done');
      expect(saved.workoutLogs).toEqual([log]);
      expect(saved.scheduleChanges).toEqual(skip.changes);
    }
  });

  it('accepting the same proposal twice keeps one copy of each change, then rejects as stale', async () => {
    await onboard();
    const [first] = sessionsByDate(must(must(data().plan).weeks[0]));
    const skip = must(
      rescheduleProposals(
        must(data().plan),
        must(data().profile),
        { type: 'skip', session_id: must(first).id },
        { now, newId: createSeededIdGenerator(6) },
      )[0],
    );
    const results = await Promise.allSettled([
      controller.acceptProposal(skip),
      controller.acceptProposal(skip),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(data().scheduleChanges).toHaveLength(skip.changes.length);
    expect((await repository.load()).scheduleChanges).toHaveLength(skip.changes.length);
  });

  it('never stores a second log for the same session (S7)', async () => {
    await onboard();
    const [first] = sessionsByDate(must(must(data().plan).weeks[0]));
    await controller.saveWorkout(logFor(must(first).id, must(first).scheduled_date));
    const second = {
      ...logFor(must(first).id, must(first).scheduled_date),
      id: '00000099-0000-4000-8000-000000000001',
    };
    second.sets = second.sets.map((set) => ({ ...set, workout_log_id: second.id }));
    await expect(controller.saveWorkout(second)).rejects.toThrow('already logged');
    expect(data().workoutLogs).toHaveLength(1);
  });
});

describe('AppController: delete and failures (S3)', () => {
  it('reports keys that could not be deleted and resyncs with what is left', async () => {
    class FlakyStore extends MemoryKeyValueStore {
      override removeItem(key: string): Promise<void> {
        return key === STORAGE_KEYS.profile
          ? Promise.reject(new Error('disk busy'))
          : super.removeItem(key);
      }
    }
    setup(new FlakyStore());
    await onboard();
    const error: unknown = await controller.deleteAllData().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ClearDataError);
    expect((error as ClearDataError).failedKeys).toEqual([STORAGE_KEYS.profile]);
    expect(data().plan).toBeNull();
    expect(data().profile).not.toBeNull();
    expect(controller.getSnapshot().busy).toBe(false);
  });

  it('deletes everything and works from the error state', async () => {
    await store.setItem(STORAGE_KEYS.plan, '{broken');
    await controller.load();
    expect(controller.getSnapshot().state.status).toBe('error');
    await controller.deleteAllData();
    expect(data()).toMatchObject({ profile: null, plan: null, workoutLogs: [] });
  });

  it('refreshClock re-renders subscribers and today follows the profile zone', async () => {
    await onboard();
    let calls = 0;
    const unsubscribe = controller.subscribe(() => {
      calls += 1;
    });
    controller.refreshClock();
    unsubscribe();
    expect(calls).toBe(1);
    now = '2026-10-11T22:30:00.000Z';
    expect(controller.today()).toBe('2026-10-12');
  });
});

describe('AppController: plan warnings', () => {
  it('persists the generator warnings with the plan and replaces them on regenerate', async () => {
    await controller.load();
    const result = await controller.completeOnboarding(
      completedDraft({ daysPerWeek: 3, availableDays: ['mon', 'tue', 'wed'], slotTimes: {} }),
    );
    expect(result.ok && result.warnings.length).toBeGreaterThan(0);
    const notes = must(data().planNotes);
    expect(notes.plan_id).toBe(must(data().plan).id);
    expect(notes.warnings[0]).toMatch(/back-to-back/);
    expect((await repository.load()).planNotes).toEqual(notes);

    await controller.regeneratePlan();
    expect(must(data().planNotes).plan_id).toBe(must(data().plan).id);
    expect(must(data().planNotes).plan_id).not.toBe(notes.plan_id);
  });
});

describe('AppController: workout drafts and export files', () => {
  it('finishing a workout removes its saved draft', async () => {
    await onboard();
    const [first] = sessionsByDate(must(must(data().plan).weeks[0]));
    const log = logFor(must(first).id, must(first).scheduled_date);
    await repository.saveWorkoutDraft({
      id: log.id,
      session_id: must(first).id,
      started_at: log.started_at,
      saved_at: log.started_at,
      sets: [],
    });
    await controller.saveWorkout(log);
    await expect(repository.loadWorkoutDraft(must(first).id)).resolves.toBeNull();
  });

  it('discarding removes the draft; delete-all also removes export files', async () => {
    const deleteExportFiles = vi.fn(() => Promise.resolve());
    setup();
    controller = new AppController({ ...controller.services, deleteExportFiles });
    await onboard();
    const [first] = sessionsByDate(must(must(data().plan).weeks[0]));
    await repository.saveWorkoutDraft({
      id: '00000006-0000-4000-8000-000000000001',
      session_id: must(first).id,
      started_at: NOW,
      saved_at: NOW,
      sets: [],
    });
    await controller.discardWorkoutDraft(must(first).id);
    await expect(repository.loadWorkoutDraft(must(first).id)).resolves.toBeNull();
    await controller.deleteAllData();
    expect(deleteExportFiles).toHaveBeenCalledTimes(1);
    expect(store.keys()).toEqual([]);
  });
});
