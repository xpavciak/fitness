import { useLocalSearchParams, useRouter } from 'expo-router';
import { WorkoutScreen } from '../../src/screens/WorkoutScreen';
import { WithData } from '../../src/state/WithData';

export default function WorkoutRoute() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  return (
    <WithData>
      {(data) => (
        <WorkoutScreen
          data={data}
          sessionId={typeof sessionId === 'string' ? sessionId : ''}
          onFinished={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/plan');
            }
          }}
        />
      )}
    </WithData>
  );
}
