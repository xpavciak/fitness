import { ProgressScreen } from '../../src/screens/ProgressScreen';
import { useRefreshOnFocus } from '../../src/state/use-refresh-on-focus';
import { WithData } from '../../src/state/WithData';

export default function ProgressTab() {
  useRefreshOnFocus();
  return <WithData>{(data) => <ProgressScreen data={data} />}</WithData>;
}
