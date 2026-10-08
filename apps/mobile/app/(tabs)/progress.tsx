import { ProgressScreen } from '../../src/screens/ProgressScreen';
import { WithData } from '../../src/state/WithData';

export default function ProgressTab() {
  return <WithData>{(data) => <ProgressScreen data={data} />}</WithData>;
}
