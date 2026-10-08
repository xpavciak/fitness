import { useRouter } from 'expo-router';
import { SettingsScreen } from '../../src/screens/SettingsScreen';
import { useRefreshOnFocus } from '../../src/state/use-refresh-on-focus';
import { WithData } from '../../src/state/WithData';

export default function SettingsTab() {
  useRefreshOnFocus();
  const router = useRouter();
  return (
    <WithData>
      {(data) => (
        <SettingsScreen
          data={data}
          onEditAnswers={() => {
            router.push('/onboarding');
          }}
          onDeleted={() => {
            router.replace('/onboarding');
          }}
        />
      )}
    </WithData>
  );
}
