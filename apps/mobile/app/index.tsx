import { Redirect } from 'expo-router';
import { WithData } from '../src/state/WithData';

export default function Index() {
  return (
    <WithData>
      {(data) => <Redirect href={data.profile && data.plan ? '/plan' : '/onboarding'} />}
    </WithData>
  );
}
