import { useRouter } from 'expo-router';
import { PlanScreen } from '../../src/screens/PlanScreen';
import { WithData } from '../../src/state/WithData';

export default function PlanTab() {
  const router = useRouter();
  return (
    <WithData>
      {(data) => (
        <PlanScreen
          data={data}
          onOpenSession={(sessionId) => {
            router.push({ pathname: '/workout/[sessionId]', params: { sessionId } });
          }}
          onEditAnswers={() => {
            router.push('/onboarding');
          }}
        />
      )}
    </WithData>
  );
}
