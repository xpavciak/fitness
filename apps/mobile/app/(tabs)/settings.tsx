import { useRouter } from 'expo-router';
import { SettingsScreen } from '../../src/screens/SettingsScreen';
import { WithData } from '../../src/state/WithData';

export default function SettingsTab() {
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
