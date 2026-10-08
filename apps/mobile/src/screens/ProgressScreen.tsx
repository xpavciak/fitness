import { StyleSheet, Text, View } from 'react-native';
import { formatShortDate } from '../logic/labels';
import { adherenceSummary, exerciseProgress, type ExerciseProgress } from '../logic/progress';
import type { AppData } from '../storage/repository';
import { useStore } from '../state/store';
import { Badge, Body, Card, Heading, Screen, Title } from '../ui/components';
import { colors, spacing } from '../ui/theme';

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? '–' : `${value}%`;
}

export function ProgressScreen({ data }: { data: AppData }) {
  const store = useStore();
  const { plan, profile } = data;
  if (!plan || !profile) {
    return (
      <Screen testID="progress-empty">
        <Title>Progress</Title>
        <Body>Finish onboarding to start tracking your progress.</Body>
      </Screen>
    );
  }
  const summary = adherenceSummary(
    plan,
    profile,
    data.workoutLogs,
    store.today(),
    data.scheduleChanges,
  );
  const exercises = exerciseProgress(data.workoutLogs, profile.timezone);
  const { streak, thisWeek, stats, reflection } = summary;

  return (
    <Screen testID="progress-screen">
      <Title>Progress</Title>
      <View style={styles.tiles}>
        <Tile
          label="This week"
          value={thisWeek ? percent(thisWeek.percentage) : '–'}
          detail={
            thisWeek ? `${thisWeek.completed} of ${thisWeek.planned} sessions` : 'Plan not started'
          }
          testID="adherence-this-week"
        />
        <Tile
          label="Weekly streak"
          value={`${streak.current} wk`}
          detail={`Best ${streak.best} wk${streak.current_week_met ? ' · this week counts' : ''}`}
          testID="weekly-streak"
        />
        <Tile
          label="Overall"
          value={percent(stats.overall.percentage)}
          detail={`${stats.overall.completed} of ${stats.overall.due} due`}
          testID="adherence-overall"
        />
      </View>
      <Body muted>
        A week counts toward your streak when you complete at least 80% of its sessions.
      </Body>

      <Card testID="weekly-reflection">
        <Heading>Week {reflection.weekIndex + 1} reflection</Heading>
        {reflection.source === 'ai' ? <Badge label="AI-generated" tone="info" /> : null}
        <Body>{reflection.text}</Body>
      </Card>

      <Heading>Weeks</Heading>
      <Card testID="weeks-table">
        {stats.weeks.map((week) => (
          <View key={week.week_index} style={styles.tableRow}>
            <Text style={styles.cellWide}>
              Week {week.week_index + 1} · {formatShortDate(week.start_date)}
            </Text>
            <Text style={styles.cell}>
              {week.completed}/{week.planned}
            </Text>
            <Text style={styles.cell}>
              {week.status === 'future' ? '–' : percent(week.percentage)}
            </Text>
          </View>
        ))}
      </Card>

      <Heading>Personal records</Heading>
      {exercises.length === 0 ? (
        <Body muted testID="no-records">
          Log a workout to see your estimated 1RM and personal records.
        </Body>
      ) : (
        exercises.map((exercise) => (
          <ExerciseRecord key={exercise.exerciseId} exercise={exercise} />
        ))
      )}
    </Screen>
  );
}

function Tile({
  label,
  value,
  detail,
  testID,
}: {
  label: string;
  value: string;
  detail: string;
  testID: string;
}) {
  return (
    <View style={styles.tile} testID={testID}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue} testID={`${testID}-value`}>
        {value}
      </Text>
      <Text style={styles.tileDetail}>{detail}</Text>
    </View>
  );
}

function ExerciseRecord({ exercise }: { exercise: ExerciseProgress }) {
  const unit = exercise.measure === 'seconds' ? 's' : ' reps';
  const max = Math.max(...exercise.e1rmHistory.map((point) => point.e1rmKg), 1);
  return (
    <Card testID={`record-${exercise.exerciseId}`}>
      <Heading>{exercise.name}</Heading>
      <Body>
        {exercise.bestE1rmKg !== undefined ? `e1RM ${exercise.bestE1rmKg} kg · ` : ''}
        {exercise.bestLoadKg !== undefined ? `heaviest ${exercise.bestLoadKg} kg · ` : ''}
        {exercise.bestReps !== undefined ? `best set ${exercise.bestReps}${unit}` : ''}
      </Body>
      {exercise.e1rmChangePct !== undefined ? (
        <Body muted>
          e1RM {exercise.e1rmChangePct >= 0 ? 'up' : 'down'} {Math.abs(exercise.e1rmChangePct)}%
          since your first session.
        </Body>
      ) : null}
      {exercise.e1rmHistory.length > 1 ? (
        <View style={styles.chart} accessibilityLabel={`e1RM trend for ${exercise.name}`}>
          {exercise.e1rmHistory.map((point, index) => (
            <View
              key={`${point.date}-${index}`}
              style={[styles.bar, { height: Math.max(4, (56 * point.e1rmKg) / max) }]}
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: 140,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
  },
  tileLabel: { color: colors.muted, fontSize: 13 },
  tileValue: { color: colors.text, fontSize: 28, fontWeight: '700' },
  tileDetail: { color: colors.muted, fontSize: 13 },
  tableRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  cellWide: { flex: 1, color: colors.text },
  cell: { width: 56, textAlign: 'right', color: colors.text },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 60 },
  bar: { width: 12, borderRadius: 3, backgroundColor: colors.primary },
});
