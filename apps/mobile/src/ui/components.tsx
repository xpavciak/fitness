import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, spacing } from './theme';

export function Screen({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
      testID={testID}
    >
      {children}
    </ScrollView>
  );
}

export function Card({
  children,
  testID,
  style,
}: {
  children: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.heading} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted = false,
  testID,
}: {
  children: ReactNode;
  muted?: boolean;
  testID?: string;
}) {
  return (
    <Text style={[styles.body, muted && styles.muted]} testID={testID}>
      {children}
    </Text>
  );
}

export function ErrorText({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text style={styles.error} accessibilityRole="alert" testID={testID}>
      {children}
    </Text>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${variant}`],
        (pressed || disabled) && styles.buttonDimmed,
      ]}
    >
      <Text style={[styles.buttonText, variant !== 'primary' && styles[`buttonText_${variant}`]]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      testID={testID}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

export function Checkbox({
  label,
  checked,
  onChange,
  testID,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => {
        onChange(!checked);
      }}
      testID={testID}
      style={styles.checkboxRow}
    >
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
      </View>
      <Text style={styles.checkboxLabel}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  error,
  placeholder,
  keyboardType,
  testID,
  compact = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string | undefined;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  testID?: string;
  compact?: boolean;
}) {
  return (
    <View style={[styles.field, compact && styles.fieldCompact]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        testID={testID}
        style={[styles.input, error !== undefined && styles.inputError]}
      />
      {error !== undefined ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

export function Badge({
  label,
  tone,
}: {
  label: string;
  tone: 'neutral' | 'good' | 'bad' | 'info';
}) {
  return (
    <View style={[styles.badge, styles[`badge_${tone}`]]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.center} testID="loading">
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: {
    padding: spacing.lg,
    gap: spacing.md,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  heading: { fontSize: 18, fontWeight: '600', color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  muted: { color: colors.muted },
  error: { color: colors.danger, fontSize: 14 },
  button: {
    borderRadius: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
  },
  button_primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  button_secondary: { backgroundColor: colors.surface, borderColor: colors.border },
  button_danger: { backgroundColor: colors.surface, borderColor: colors.danger },
  buttonDimmed: { opacity: 0.6 },
  buttonText: { color: colors.primaryText, fontWeight: '600', fontSize: 15 },
  buttonText_secondary: { color: colors.text },
  buttonText_danger: { color: colors.danger },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextSelected: { color: colors.primaryText },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { color: colors.primaryText, fontWeight: '700', fontSize: 14 },
  checkboxLabel: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 21 },
  field: { gap: spacing.xs },
  fieldCompact: { flex: 1, minWidth: 64 },
  label: { color: colors.muted, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  inputError: { borderColor: colors.danger },
  badge: {
    borderRadius: 10,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    alignSelf: 'flex-start',
  },
  badge_neutral: { backgroundColor: colors.border },
  badge_good: { backgroundColor: '#d7f0d9' },
  badge_bad: { backgroundColor: '#fbdcdc' },
  badge_info: { backgroundColor: colors.chip },
  badgeText: { fontSize: 12, fontWeight: '600', color: colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
});
