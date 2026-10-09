import { useState, type ReactNode } from 'react';
import type { AppData } from '../storage/repository';
import { Body, Button, Card, ErrorText, Loading, Screen, Title } from '../ui/components';
import { useTwoStepConfirm } from '../ui/use-taps';
import { useStore } from './store';

/**
 * Renders `children` once local data is loaded. When stored data is unreadable it says so
 * explicitly and offers to start over, instead of silently discarding it.
 */
export function WithData({ children }: { children: (data: AppData) => ReactNode }) {
  const store = useStore();
  const confirm = useTwoStepConfirm<'delete'>();
  const [error, setError] = useState<string | null>(null);
  const { state } = store;

  if (state.status === 'loading') {
    return <Loading />;
  }
  if (state.status === 'error') {
    return (
      <Screen testID="storage-error">
        <Title>Your saved data could not be read</Title>
        <Card>
          <ErrorText>{state.message}</ErrorText>
          <Body muted>You can try again, or delete the local data and start over.</Body>
        </Card>
        <Button label="Try again" variant="secondary" onPress={() => void store.reload()} />
        <Button
          label={confirm.armed('delete') ? 'Tap again to delete everything' : 'Delete local data'}
          variant="danger"
          onPress={() => {
            confirm.press('delete', () => {
              store.deleteAllData().catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : String(cause));
              });
            });
          }}
        />
        {error !== null ? <ErrorText>{error}</ErrorText> : null}
      </Screen>
    );
  }
  return <>{children(state.data)}</>;
}
