import type { DayType } from '../plan';
import { DAY_TYPE_LABELS } from './labels';

export function DayTypeBadge({ type }: { type: DayType }) {
  return (
    <span className={`badge badge--${type}`}>
      <span className="badge__dot" aria-hidden="true" />
      {DAY_TYPE_LABELS[type]}
    </span>
  );
}
