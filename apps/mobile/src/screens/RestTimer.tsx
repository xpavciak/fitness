import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { formatSeconds, restRemaining } from '../logic/workout';
import { Button } from '../ui/components';
import { colors, spacing } from '../ui/theme';

export interface RestTimerState {
  durationSec: number;
  startedAtMs: number;
}

const TICK_MS = 250;
export const REST_OVER_TEXT = 'Rest over: next set';

/**
 * Counts down from the planned rest. The time left is computed from the start instant, so it
 * stays correct across re-renders and slow ticks. The interval stops when the rest is over, and
 * only that transition is announced to screen readers (the countdown itself is not): through
 * `AccessibilityInfo` (iOS VoiceOver ignores live regions) and an assertive live region on web.
 * Callers pass `key={timer.startedAtMs}`, so a new rest remounts the timer with a fresh clock.
 */
export function RestTimer({ timer, onDismiss }: { timer: RestTimerState; onDismiss: () => void }) {
  const [nowMs, setNowMs] = useState(timer.startedAtMs);
  useEffect(() => {
    const interval = setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      if (restRemaining(timer.durationSec, timer.startedAtMs, current) === 0) {
        clearInterval(interval);
        AccessibilityInfo.announceForAccessibility(REST_OVER_TEXT);
      }
    }, TICK_MS);
    return () => {
      clearInterval(interval);
    };
  }, [timer]);
  const remaining = restRemaining(timer.durationSec, timer.startedAtMs, nowMs);
  const over = remaining === 0;
  return (
    <View style={styles.timer} testID="rest-timer">
      {over ? (
        <Text style={styles.label} aria-live="assertive" testID="rest-over">
          {REST_OVER_TEXT}
        </Text>
      ) : (
        <Text style={styles.label}>Rest</Text>
      )}
      <Text style={styles.time} testID="rest-timer-remaining">
        {formatSeconds(remaining)}
      </Text>
      <Button
        label={over ? 'Dismiss' : 'Skip rest'}
        variant="secondary"
        onPress={onDismiss}
        testID="rest-timer-dismiss"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.chip,
  },
  label: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '600' },
  time: { fontSize: 24, fontWeight: '700', color: colors.primary, fontVariant: ['tabular-nums'] },
});
