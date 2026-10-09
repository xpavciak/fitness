import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { findSession, sessionLog } from '../logic/plan-view';
import {
  buildWorkoutDraft,
  completedSetCount,
  draftToSaved,
  restoreDraft,
  stepRir,
  summarizeLog,
  toggleSetCompleted,
  updateSet,
  workoutLogFromDraft,
  type ExerciseDraft,
  type WorkoutDraft,
} from '../logic/workout';
import { formatShortDate } from '../logic/labels';
import type { AppData } from '../storage/repository';
import { useStore } from '../state/store';
import {
  Body,
  Button,
  Card,
  ErrorText,
  Field,
  Heading,
  Loading,
  Row,
  Screen,
  Title,
} from '../ui/components';
import { MIN_TOUCH } from '../ui/components';
import { useTwoStepConfirm } from '../ui/use-taps';
import { colors, spacing } from '../ui/theme';
import { RestTimer, type RestTimerState } from './RestTimer';

export interface WorkoutScreenProps {
  data: AppData;
  sessionId: string;
  onFinished: () => void;
}

export function WorkoutScreen({ data, sessionId, onFinished }: WorkoutScreenProps) {
  const store = useStore();
  const { repository } = store.services;
  const found = data.plan ? findSession(data.plan, sessionId) : null;
  const profile = data.profile;
  // A done session opens read-only: logging it again would create a second log.
  const existingLog = found ? sessionLog(data.workoutLogs, found.session.id) : null;
  const canLog =
    found !== null && profile !== null && !existingLog && found.session.status !== 'done';
  // The form as prefilled from the plan; the saved in-progress inputs are overlaid on it.
  const [fresh] = useState<WorkoutDraft | null>(() =>
    canLog
      ? buildWorkoutDraft(found.session, data.workoutLogs, {
          today: store.today(),
          timezone: profile.timezone,
          experienceLevel: profile.experience_level,
          now: store.services.now(),
          newId: store.services.newId,
        })
      : null,
  );
  const [draft, setDraft] = useState<WorkoutDraft | null>(null);
  const [timer, setTimer] = useState<RestTimerState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [finishError, setFinishError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  // True from "Finish"/"Discard" until the screen closes: no more draft saves, no read-only flash.
  const [closing, setClosing] = useState(false);
  // Nothing is stored until the user changes something (opening a workout creates no draft).
  const [dirty, setDirty] = useState(false);
  const discard = useTwoStepConfirm<'discard'>();

  // Restore the in-progress workout once (survives a reload or an app kill).
  useEffect(() => {
    if (!fresh) {
      return undefined;
    }
    let active = true;
    repository.loadWorkoutDraft(fresh.sessionId).then(
      (saved) => {
        if (active) {
          setDraft(saved ? restoreDraft(fresh, saved) : fresh);
        }
      },
      (cause: unknown) => {
        if (active) {
          setDraft(fresh);
          setStorageError(`Your unfinished workout could not be restored: ${message(cause)}`);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [fresh, repository]);

  // Save the inputs after every change.
  useEffect(() => {
    if (!draft || closing || !dirty) {
      return;
    }
    repository
      .saveWorkoutDraft(draftToSaved(draft, store.services.now()))
      .catch((cause: unknown) => {
        setStorageError(`Your progress could not be saved on this device: ${message(cause)}`);
      });
  }, [draft, closing, dirty, repository, store.services]);

  if (!closing && found && (existingLog || found.session.status === 'done')) {
    return (
      <Screen testID="workout-readonly">
        <Title>{found.session.title}</Title>
        <Body muted>
          Done
          {existingLog ? ` on ${formatShortDate(existingLog.started_at.slice(0, 10))}` : ''}. This
          workout is already logged.
        </Body>
        {existingLog ? (
          summarizeLog(existingLog).map((exercise) => (
            <Card key={exercise.exerciseId} testID={`logged-${exercise.exerciseId}`}>
              <Heading>{exercise.name}</Heading>
              {exercise.sets.map((line, index) => (
                <Body key={`${exercise.exerciseId}-${index}`}>
                  Set {index + 1}: {line}
                </Body>
              ))}
            </Card>
          ))
        ) : (
          <Body muted>The log for this session is not on this device.</Body>
        )}
        <Button label="Back to plan" variant="secondary" onPress={onFinished} />
      </Screen>
    );
  }

  if (fresh && !draft) {
    return <Loading />;
  }

  if (!found || !profile || !draft) {
    return (
      <Screen testID="workout-missing">
        <Title>Session not found</Title>
        <Body>This session is no longer in your plan.</Body>
        <Button label="Back to plan" onPress={onFinished} />
      </Screen>
    );
  }

  const toggle = (exerciseIndex: number, setIndex: number) => {
    const key = `${exerciseIndex}-${setIndex}`;
    const now = store.services.now();
    const result = toggleSetCompleted(draft, exerciseIndex, setIndex, now);
    if (!result.ok) {
      setErrors({ ...errors, [key]: result.error });
      return;
    }
    const { [key]: _cleared, ...rest } = errors;
    setErrors(rest);
    setDraft(() => result.draft);
    setDirty(true);
    setTimer(
      result.restSec > 0 ? { durationSec: result.restSec, startedAtMs: Date.parse(now) } : null,
    );
  };

  const finish = () => {
    setFinishError(null);
    let log;
    try {
      log = workoutLogFromDraft(draft, { userId: profile.user_id, endedAt: store.services.now() });
    } catch (cause) {
      setFinishError(message(cause));
      return;
    }
    setClosing(true);
    store
      .saveWorkout(log)
      .then(onFinished)
      .catch((cause: unknown) => {
        setFinishError(`Could not save: ${message(cause)}`);
        setClosing(false);
      });
  };

  const discardWorkout = () => {
    discard.press('discard', () => {
      setClosing(true);
      store
        .discardWorkoutDraft(draft.sessionId)
        .then(onFinished)
        .catch((cause: unknown) => {
          setFinishError(`Could not discard: ${message(cause)}`);
          setClosing(false);
        });
    });
  };

  const done = completedSetCount(draft);
  return (
    <Screen testID="workout-screen">
      <Title>{draft.title}</Title>
      <Body muted>
        {found.session.est_minutes} min · {done} set{done === 1 ? '' : 's'} done
      </Body>
      {storageError !== null ? <ErrorText testID="draft-error">{storageError}</ErrorText> : null}
      {timer ? (
        <RestTimer
          // A new rest remounts the timer, so its clock starts from the new start time.
          key={timer.startedAtMs}
          timer={timer}
          onDismiss={() => {
            setTimer(null);
          }}
        />
      ) : null}
      {draft.exercises.map((exercise, exerciseIndex) => (
        <ExerciseCard
          key={exercise.planned.id}
          exercise={exercise}
          exerciseIndex={exerciseIndex}
          errors={errors}
          onChange={(setIndex, update) => {
            setDirty(true);
            setDraft((current) =>
              current ? updateSet(current, exerciseIndex, setIndex, update) : current,
            );
          }}
          onToggle={(setIndex) => {
            toggle(exerciseIndex, setIndex);
          }}
        />
      ))}
      {finishError !== null ? <ErrorText testID="finish-error">{finishError}</ErrorText> : null}
      <Button
        label={closing ? 'Saving...' : 'Finish workout'}
        disabled={closing || store.busy}
        onPress={finish}
        testID="finish-workout"
      />
      <Button
        label={discard.armed('discard') ? 'Tap again to discard this workout' : 'Discard workout'}
        variant="danger"
        disabled={closing || store.busy}
        onPress={discardWorkout}
        testID="discard-workout"
      />
    </Screen>
  );
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function ExerciseCard({
  exercise,
  exerciseIndex,
  errors,
  onChange,
  onToggle,
}: {
  exercise: ExerciseDraft;
  exerciseIndex: number;
  errors: Record<string, string>;
  onChange: (
    setIndex: number,
    update: (set: ExerciseDraft['sets'][number]) => ExerciseDraft['sets'][number],
  ) => void;
  onToggle: (setIndex: number) => void;
}) {
  const { targets } = exercise;
  const unit = exercise.measure === 'seconds' ? 's' : ' reps';
  return (
    <Card testID={`exercise-${exerciseIndex}`}>
      <Heading>{exercise.name}</Heading>
      <Body muted>
        {targets.sets} × {targets.rep_min}–{targets.rep_max}
        {unit}
        {exercise.measure === 'seconds' ? '' : ` · target RIR ${targets.target_rir}`}
        {targets.target_load_kg !== undefined ? ` · ${targets.target_load_kg} kg` : ''} · rest{' '}
        {exercise.planned.rest_sec}s
      </Body>
      <Body muted>{targets.reason}</Body>
      {exercise.cues[0] !== undefined ? <Body muted>Tip: {exercise.cues[0]}</Body> : null}
      {exercise.sets.map((set, setIndex) => {
        const key = `${exerciseIndex}-${setIndex}`;
        const testPrefix = `set-${exerciseIndex}-${setIndex}`;
        return (
          <View
            key={set.id}
            style={[styles.setRow, set.completed && styles.setDone]}
            testID={testPrefix}
          >
            <Text style={styles.setLabel}>Set {setIndex + 1}</Text>
            <Field
              label={exercise.measure === 'seconds' ? 'Seconds' : 'Reps'}
              value={set.reps}
              onChangeText={(reps) => {
                onChange(setIndex, (current) => ({ ...current, reps }));
              }}
              keyboardType="number-pad"
              testID={`${testPrefix}-reps`}
              compact
            />
            {exercise.loadable ? (
              <Field
                label="kg"
                value={set.loadKg}
                onChangeText={(loadKg) => {
                  onChange(setIndex, (current) => ({ ...current, loadKg }));
                }}
                keyboardType="decimal-pad"
                placeholder="kg"
                testID={`${testPrefix}-load`}
                compact
              />
            ) : null}
            {exercise.measure === 'seconds' ? null : (
              <View style={styles.rir}>
                <Text style={styles.rirLabel}>RIR</Text>
                <View style={styles.rirControls}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Decrease RIR"
                    onPress={() => {
                      onChange(setIndex, (current) => ({
                        ...current,
                        rir: stepRir(current.rir, -1),
                      }));
                    }}
                    style={styles.stepper}
                    testID={`${testPrefix}-rir-minus`}
                  >
                    <Text>−</Text>
                  </Pressable>
                  <Text style={styles.rirValue} testID={`${testPrefix}-rir`}>
                    {set.rir ?? '–'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Increase RIR"
                    onPress={() => {
                      onChange(setIndex, (current) => ({
                        ...current,
                        rir: stepRir(current.rir, 1),
                      }));
                    }}
                    style={styles.stepper}
                    testID={`${testPrefix}-rir-plus`}
                  >
                    <Text>+</Text>
                  </Pressable>
                </View>
              </View>
            )}
            <Pressable
              accessibilityRole="checkbox"
              aria-checked={set.completed}
              accessibilityLabel={`Complete set ${setIndex + 1}`}
              onPress={() => {
                onToggle(setIndex);
              }}
              style={[styles.complete, set.completed && styles.completeDone]}
              testID={`${testPrefix}-complete`}
            >
              <Text style={[styles.completeText, set.completed && styles.completeTextDone]}>
                {set.completed ? '✓' : 'Done'}
              </Text>
            </Pressable>
            {errors[key] !== undefined ? (
              <View style={styles.fullWidth}>
                <ErrorText testID={`${testPrefix}-error`}>{errors[key]}</ErrorText>
              </View>
            ) : null}
          </View>
        );
      })}
      {exercise.measure === 'seconds' ? null : (
        <Row>
          <Body muted>RIR = reps in reserve: how many more reps you could have done.</Body>
        </Row>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  setRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  setDone: { backgroundColor: '#eef8ef' },
  setLabel: { width: 44, paddingBottom: spacing.sm, color: colors.muted },
  rir: { alignItems: 'center', gap: spacing.xs },
  rirLabel: { color: colors.muted, fontSize: 13 },
  rirControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rirValue: { minWidth: 18, textAlign: 'center', fontSize: 16 },
  stepper: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  complete: {
    minWidth: 64,
    height: MIN_TOUCH,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  completeDone: { backgroundColor: colors.success },
  completeText: { color: colors.success, fontWeight: '600' },
  completeTextDone: { color: colors.primaryText },
  fullWidth: { width: '100%' },
});
