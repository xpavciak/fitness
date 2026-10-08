import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatSeconds, restRemaining } from '../logic/workout';
import { Button } from '../ui/components';
import { colors, spacing } from '../ui/theme';

export interface RestTimerState {
  durationSec: number;
  startedAtMs: number;
}

/** Counts down from the planned rest; computed from the start time so it survives re-renders. */
export function RestTimer({ timer, onDismiss }: { timer: RestTimerState; onDismiss: () => void }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 250);
    return () => {
      clearInterval(interval);
    };
  }, [timer]);
  const remaining = restRemaining(timer.durationSec, timer.startedAtMs, nowMs);
  return (
    <View style={styles.timer} testID="rest-timer" accessibilityLiveRegion="polite">
      <Text style={styles.label}>{remaining > 0 ? 'Rest' : 'Rest over: next set'}</Text>
      <Text style={styles.time} testID="rest-timer-remaining">
        {formatSeconds(remaining)}
      </Text>
      <Button
        label={remaining > 0 ? 'Skip rest' : 'Dismiss'}
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
