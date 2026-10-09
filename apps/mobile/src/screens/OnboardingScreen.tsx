import {
  BODY_REGIONS,
  EXPERIENCE_LEVELS,
  GOAL_TYPES,
  PARQ_QUESTIONS,
  WEEKDAYS,
  type Equipment,
  type ParqQuestionKey,
} from '@fitness/engine';
import { useState } from 'react';
import { View } from 'react-native';
import {
  BODY_REGION_LABELS,
  EQUIPMENT_LABELS,
  EXPERIENCE_LABELS,
  GOAL_LABELS,
  WEEKDAY_LABELS,
} from '../logic/labels';
import {
  ONBOARDING_STEPS,
  SESSION_MINUTE_OPTIONS,
  toggleAvailableDay,
  toggleInList,
  validateOnboarding,
  validateOnboardingStep,
  type OnboardingDraft,
  type OnboardingErrors,
  type OnboardingStep,
} from '../logic/onboarding';
import {
  Body,
  Button,
  Card,
  Checkbox,
  Chip,
  ChipRow,
  ErrorText,
  Field,
  Heading,
  Row,
  Screen,
  Title,
} from '../ui/components';

export const DISCLAIMER =
  'This app gives general fitness guidance, not medical advice. It does not diagnose or treat ' +
  'any condition. Stop exercising and seek medical help if you feel chest pain, dizziness or ' +
  'unusual shortness of breath.';

export const CONSENT_TEXT =
  'I agree that this app stores my health answers (PAR-Q+ and limitations) on this device to ' +
  'build a safe plan. I can export or delete them at any time in Settings.';

export type OnboardingSubmitResult =
  { ok: true } | { ok: false; message: string; redFlags: readonly ParqQuestionKey[] };

const STEP_TITLES: Record<OnboardingStep, string> = {
  about: 'About you',
  schedule: 'When and where',
  health: 'Health check (PAR-Q+)',
  goal: 'Your goal',
};

const EQUIPMENT_OPTIONS = Object.keys(EQUIPMENT_LABELS) as Exclude<Equipment, 'bodyweight'>[];
const PARQ_KEYS = Object.keys(PARQ_QUESTIONS) as ParqQuestionKey[];

export interface OnboardingScreenProps {
  initialDraft: OnboardingDraft;
  currentYear: number;
  timezone: string;
  onSubmit: (draft: OnboardingDraft) => Promise<OnboardingSubmitResult>;
}

export function OnboardingScreen({
  initialDraft,
  currentYear,
  timezone,
  onSubmit,
}: OnboardingScreenProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<OnboardingErrors>({});
  const [blocked, setBlocked] = useState<{ message: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const step = ONBOARDING_STEPS[stepIndex] ?? 'about';
  const isLast = stepIndex === ONBOARDING_STEPS.length - 1;

  const patch = (changes: Partial<OnboardingDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
  };

  const next = () => {
    const stepErrors = validateOnboardingStep(draft, step, currentYear);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) {
      return;
    }
    if (!isLast) {
      setStepIndex(stepIndex + 1);
      return;
    }
    const invalid = validateOnboarding(draft, currentYear);
    if (invalid) {
      setStepIndex(ONBOARDING_STEPS.indexOf(invalid.step));
      setErrors(invalid.errors);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    onSubmit(draft)
      .then((result) => {
        if (!result.ok) {
          setBlocked({ message: result.message });
        }
      })
      .catch((error: unknown) => {
        setSubmitError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  if (blocked) {
    return (
      <Screen testID="onboarding-blocked">
        <Title>Please check with a professional first</Title>
        <Card testID="screening-message">
          <Body>{blocked.message}</Body>
        </Card>
        <Body muted>{DISCLAIMER}</Body>
        <Button
          label="Review my answers"
          variant="secondary"
          testID="review-answers"
          onPress={() => {
            setBlocked(null);
            setStepIndex(ONBOARDING_STEPS.indexOf('about'));
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen testID={`onboarding-${step}`}>
      <Body muted>
        Step {stepIndex + 1} of {ONBOARDING_STEPS.length}
      </Body>
      <Title>{STEP_TITLES[step]}</Title>

      {step === 'about' ? (
        <>
          <Field
            label="Year of birth"
            value={draft.birthYear}
            onChangeText={(birthYear) => {
              patch({ birthYear });
            }}
            placeholder="e.g. 1990"
            keyboardType="number-pad"
            error={errors.birthYear}
            testID="birth-year"
          />
          <Heading>Training experience</Heading>
          <ChipRow>
            {EXPERIENCE_LEVELS.map((level) => (
              <Chip
                key={level}
                label={EXPERIENCE_LABELS[level]}
                role="radio"
                selected={draft.experience === level}
                onPress={() => {
                  patch({ experience: level });
                }}
                testID={`experience-${level}`}
              />
            ))}
          </ChipRow>
          <Heading>Equipment you can use</Heading>
          <Body muted>Bodyweight exercises are always included.</Body>
          <ChipRow>
            {EQUIPMENT_OPTIONS.map((item) => (
              <Chip
                key={item}
                label={EQUIPMENT_LABELS[item]}
                selected={draft.equipment.includes(item)}
                onPress={() => {
                  patch({ equipment: toggleInList(draft.equipment, item, EQUIPMENT_OPTIONS) });
                }}
                testID={`equipment-${item}`}
              />
            ))}
          </ChipRow>
          <Heading>Areas to protect (optional)</Heading>
          <Body muted>Exercises that may aggravate these areas are left out.</Body>
          <ChipRow>
            {BODY_REGIONS.map((region) => (
              <Chip
                key={region}
                label={BODY_REGION_LABELS[region]}
                selected={draft.limitations.includes(region)}
                onPress={() => {
                  patch({ limitations: toggleInList(draft.limitations, region, BODY_REGIONS) });
                }}
                testID={`limitation-${region}`}
              />
            ))}
          </ChipRow>
        </>
      ) : null}

      {step === 'schedule' ? (
        <>
          <Heading>Sessions per week</Heading>
          <ChipRow>
            {[1, 2, 3, 4, 5, 6, 7].map((days) => (
              <Chip
                key={days}
                label={String(days)}
                role="radio"
                accessibilityLabel={`${days} sessions per week`}
                selected={draft.daysPerWeek === days}
                onPress={() => {
                  patch({ daysPerWeek: days });
                }}
                testID={`days-${days}`}
              />
            ))}
          </ChipRow>
          <Heading>Minutes per session</Heading>
          <ChipRow>
            {SESSION_MINUTE_OPTIONS.map((minutes) => (
              <Chip
                key={minutes}
                label={`${minutes} min`}
                role="radio"
                selected={draft.sessionMinutes === minutes}
                onPress={() => {
                  patch({ sessionMinutes: minutes });
                }}
                testID={`minutes-${minutes}`}
              />
            ))}
          </ChipRow>
          <Heading>Days you could train</Heading>
          <ChipRow>
            {WEEKDAYS.map((day) => (
              <Chip
                key={day}
                label={WEEKDAY_LABELS[day]}
                selected={draft.availableDays.includes(day)}
                onPress={() => {
                  setDraft((current) => toggleAvailableDay(current, day));
                }}
                testID={`day-${day}`}
              />
            ))}
          </ChipRow>
          {errors.availableDays !== undefined ? (
            <ErrorText>{errors.availableDays}</ErrorText>
          ) : null}
          <Heading>When and where</Heading>
          <Body muted>
            Deciding when and where you will train makes you much more likely to follow through.
            Leave a time empty if you have no preference.
          </Body>
          <Row>
            {draft.availableDays.map((day) => (
              <View key={day} style={{ width: 92 }}>
                <Field
                  label={WEEKDAY_LABELS[day]}
                  value={draft.slotTimes[day] ?? ''}
                  onChangeText={(time) => {
                    patch({ slotTimes: { ...draft.slotTimes, [day]: time } });
                  }}
                  placeholder="HH:MM"
                  error={errors[`slot_${day}`]}
                  testID={`slot-time-${day}`}
                  compact
                />
              </View>
            ))}
          </Row>
          <Field
            label="Where"
            value={draft.location}
            onChangeText={(location) => {
              patch({ location });
            }}
            placeholder='e.g. "Home" or "Gym near work"'
            error={errors.location}
            testID="location"
          />
          <Body muted>Time zone: {timezone}</Body>
        </>
      ) : null}

      {step === 'health' ? (
        <>
          <Body muted>
            The Physical Activity Readiness Questionnaire (PAR-Q+) checks whether you should talk to
            a doctor before starting. Answer honestly; your answers stay on this device.
          </Body>
          {PARQ_KEYS.map((key) => (
            <Card key={key} testID={`parq-${key}`}>
              <Body>{PARQ_QUESTIONS[key]}</Body>
              <ChipRow radioGroup={PARQ_QUESTIONS[key]}>
                <Chip
                  label="No"
                  role="radio"
                  accessibilityLabel={`${PARQ_QUESTIONS[key]} No`}
                  selected={draft.parq[key] === false}
                  onPress={() => {
                    patch({ parq: { ...draft.parq, [key]: false } });
                  }}
                  testID={`parq-${key}-no`}
                />
                <Chip
                  label="Yes"
                  role="radio"
                  accessibilityLabel={`${PARQ_QUESTIONS[key]} Yes`}
                  selected={draft.parq[key] === true}
                  onPress={() => {
                    patch({ parq: { ...draft.parq, [key]: true } });
                  }}
                  testID={`parq-${key}-yes`}
                />
              </ChipRow>
            </Card>
          ))}
          {errors.parq !== undefined ? <ErrorText>{errors.parq}</ErrorText> : null}
        </>
      ) : null}

      {step === 'goal' ? (
        <>
          <ChipRow>
            {GOAL_TYPES.map((type) => (
              <Chip
                key={type}
                label={GOAL_LABELS[type]}
                role="radio"
                selected={draft.goalType === type}
                onPress={() => {
                  patch({ goalType: type });
                }}
                testID={`goal-${type}`}
              />
            ))}
          </ChipRow>
          <Field
            label="Specific target (optional)"
            value={draft.goalTarget}
            onChangeText={(goalTarget) => {
              patch({ goalTarget });
            }}
            placeholder='e.g. "10 push-ups in a row"'
            error={errors.goalTarget}
            testID="goal-target"
          />
          <Card>
            <Heading>Not medical advice</Heading>
            <Body>{DISCLAIMER}</Body>
            <Checkbox
              label="I understand this app does not give medical advice."
              checked={draft.disclaimerAccepted}
              onChange={(disclaimerAccepted) => {
                patch({ disclaimerAccepted });
              }}
              testID="disclaimer-checkbox"
            />
            {errors.disclaimerAccepted !== undefined ? (
              <ErrorText>{errors.disclaimerAccepted}</ErrorText>
            ) : null}
            <Checkbox
              label={CONSENT_TEXT}
              checked={draft.healthConsent}
              onChange={(healthConsent) => {
                patch({ healthConsent });
              }}
              testID="consent-checkbox"
            />
            {errors.healthConsent !== undefined ? (
              <ErrorText>{errors.healthConsent}</ErrorText>
            ) : null}
          </Card>
        </>
      ) : null}

      {submitError !== null ? <ErrorText testID="submit-error">{submitError}</ErrorText> : null}
      <Row>
        {stepIndex > 0 ? (
          <Button
            label="Back"
            variant="secondary"
            testID="onboarding-back"
            onPress={() => {
              setErrors({});
              setStepIndex(stepIndex - 1);
            }}
          />
        ) : null}
        <Button
          label={isLast ? (submitting ? 'Building your plan...' : 'Build my plan') : 'Next'}
          disabled={submitting}
          testID={isLast ? 'onboarding-submit' : 'onboarding-next'}
          onPress={next}
        />
      </Row>
    </Screen>
  );
}
