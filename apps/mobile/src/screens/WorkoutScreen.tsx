import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { findSession, sessionLog } from '../logic/plan-view';
import {
  buildWorkoutDraft,
  completedSetCount,
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
  Row,
  Screen,
  Title,
} from '../ui/components';
import { MIN_TOUCH } from '../ui/components';
import { colors, spacing } from '../ui/theme';
import { RestTimer, type RestTimerState } from './RestTimer';

export interface WorkoutScreenProps {
  data: AppData;
  sessionId: string;
  onFinished: () => void;
}

export function WorkoutScreen({ data, sessionId, onFinished }: WorkoutScreenProps) {
  const store = useStore();
  const found = data.plan ? findSession(data.plan, sessionId) : null;
  const profile = data.profile;
  // A done session opens read-only: logging it again would create a second log.
  const existingLog = found ? sessionLog(data.workoutLogs, found.session.id) : null;
  const [draft, setDraft] = useState<WorkoutDraft | null>(() =>
    found && profile && !existingLog && found.session.status !== 'done'
      ? buildWorkoutDraft(found.session, data.workoutLogs, {
          today: store.today(),
          timezone: profile.timezone,
          now: store.services.now(),
          newId: store.services.newId,
        })
      : null,
  );
  const [timer, setTimer] = useState<RestTimerState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [finishError, setFinishError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (found && (existingLog || found.session.status === 'done')) {
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
      setFinishError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    setSaving(true);
    store
      .saveWorkout(log)
      .then(onFinished)
      .catch((cause: unknown) => {
        setFinishError(`Could not save: ${cause instanceof Error ? cause.message : String(cause)}`);
        setSaving(false);
      });
  };

  const done = completedSetCount(draft);
  return (
    <Screen testID="workout-screen">
      <Title>{draft.title}</Title>
      <Body muted>
        {found.session.est_minutes} min · {done} set{done === 1 ? '' : 's'} done
      </Body>
      {timer ? (
        <RestTimer
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
        label={saving ? 'Saving...' : 'Finish workout'}
        disabled={saving || store.busy}
        onPress={finish}
        testID="finish-workout"
      />
    </Screen>
  );
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
        {unit} · target RIR {targets.target_rir}
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
      <Row>
        <Body muted>RIR = reps in reserve: how many more reps you could have done.</Body>
      </Row>
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
