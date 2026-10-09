import { Redirect } from 'expo-router';
import { WithData } from '../src/state/WithData';

export default function Index() {
  return (
    <WithData>
      {/* With a profile the Plan tab shows the plan, or why there is none (screening). */}
      {(data) => <Redirect href={data.profile ? '/plan' : '/onboarding'} />}
    </WithData>
  );
}
