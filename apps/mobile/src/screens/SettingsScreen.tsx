import { useState } from 'react';
import { formatShortDate, GOAL_LABELS } from '../logic/labels';
import { shareJson } from '../platform/share-json';
import type { AppData } from '../storage/repository';
import { useStore } from '../state/store';
import { Body, Button, Card, ErrorText, Heading, Screen, Title } from '../ui/components';
import { DISCLAIMER } from './OnboardingScreen';

type Confirm = 'regenerate' | 'delete' | null;

export interface SettingsScreenProps {
  data: AppData;
  onEditAnswers: () => void;
  onDeleted: () => void;
}

export function SettingsScreen({ data, onEditAnswers, onDeleted }: SettingsScreenProps) {
  const store = useStore();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { profile, goal, plan } = data;

  const run = (action: () => Promise<string>) => {
    setError(null);
    setMessage(null);
    action()
      .then(setMessage)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setConfirm(null);
      });
  };

  const exportData = () => {
    run(async () => {
      const exported = await store.exportData();
      const date = exported.exported_at.slice(0, 10);
      return shareJson(`fitness-data-${date}.json`, JSON.stringify(exported, null, 2));
    });
  };

  const regenerate = () => {
    if (confirm !== 'regenerate') {
      setConfirm('regenerate');
      return;
    }
    run(async () => {
      const result = await store.regeneratePlan();
      return result.ok
        ? `New plan created. It starts on ${formatShortDate(result.plan.start_date)}.`
        : result.message;
    });
  };

  const deleteAll = () => {
    if (confirm !== 'delete') {
      setConfirm('delete');
      return;
    }
    run(async () => {
      await store.deleteAllData();
      onDeleted();
      return 'All local data deleted.';
    });
  };

  return (
    <Screen testID="settings-screen">
      <Title>Settings</Title>
      {profile ? (
        <Card>
          <Heading>Your profile</Heading>
          <Body>
            {goal ? GOAL_LABELS[goal.type] : 'No goal'} · {profile.days_per_week} sessions per week
            · {profile.session_minutes} min
          </Body>
          <Body muted>Time zone: {profile.timezone}</Body>
          {plan ? <Body muted>Plan started {formatShortDate(plan.start_date)}</Body> : null}
          <Button
            label="Edit my answers"
            variant="secondary"
            onPress={onEditAnswers}
            disabled={store.busy}
            testID="edit-answers"
          />
        </Card>
      ) : null}

      <Card>
        <Heading>Your data</Heading>
        <Body muted>Everything is stored only on this device. Cloud sync is not enabled.</Body>
        <Body muted>
          Dates follow the time zone saved when you set up your plan
          {profile ? ` (${profile.timezone})` : ''}.
        </Body>
        <Button
          label="Export my data (JSON)"
          variant="secondary"
          onPress={exportData}
          disabled={store.busy}
          testID="export-data"
        />
        <Button
          label={confirm === 'regenerate' ? 'Tap again to replace your plan' : 'Regenerate plan'}
          variant="secondary"
          disabled={store.busy || !profile || !goal}
          onPress={regenerate}
          testID="regenerate-plan"
        />
        <Body muted>Your workout history is kept when the plan is regenerated.</Body>
        <Button
          label={confirm === 'delete' ? 'Tap again to delete everything' : 'Delete all local data'}
          variant="danger"
          onPress={deleteAll}
          disabled={store.busy}
          testID="delete-data"
        />
        {confirm !== null ? (
          <Button
            label="Cancel"
            variant="secondary"
            onPress={() => {
              setConfirm(null);
            }}
          />
        ) : null}
      </Card>
      {message !== null ? <Body testID="settings-message">{message}</Body> : null}
      {error !== null ? <ErrorText testID="settings-error">{error}</ErrorText> : null}

      <Card>
        <Heading>Not medical advice</Heading>
        <Body muted>{DISCLAIMER}</Body>
      </Card>
    </Screen>
  );
}
