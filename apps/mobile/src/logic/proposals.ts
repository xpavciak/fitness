import type { ScheduleChange, ScheduleProposal } from '@fitness/engine';
import { MINIMUM_DOSE_AVAILABLE_MINUTES } from './actions';

const KIND_LABELS: Record<ScheduleProposal['kind'], string> = {
  move: 'Move',
  merge: 'Merge',
  shorten: 'Shorter session',
  skip: 'Skip',
};

/** Minutes of a shorten proposal (the longest new duration of its changes), if any. */
function shortenMinutes(proposal: ScheduleProposal): number | undefined {
  const minutes = proposal.changes.flatMap((change) =>
    change.new_est_minutes === undefined ? [] : [change.new_est_minutes],
  );
  return minutes.length > 0 ? Math.max(...minutes) : undefined;
}

/** "Move", "Skip", "Shorter session (28 min)" or "Minimum dose (12 min)". */
export function proposalLabel(proposal: ScheduleProposal): string {
  const minutes = proposal.kind === 'shorten' ? shortenMinutes(proposal) : undefined;
  if (minutes === undefined) {
    return KIND_LABELS[proposal.kind];
  }
  return minutes <= MINIMUM_DOSE_AVAILABLE_MINUTES
    ? `Minimum dose (${minutes} min)`
    : `${KIND_LABELS.shorten} (${minutes} min)`;
}

/**
 * Changes in reading order: the ones matching the proposal's kind first (e.g. the move before
 * the skip that frees its slot). Apply order is unchanged: always apply `proposal.changes`.
 */
export function changesForDisplay(proposal: ScheduleProposal): ScheduleChange[] {
  return [
    ...proposal.changes.filter((change) => change.kind === proposal.kind),
    ...proposal.changes.filter((change) => change.kind !== proposal.kind),
  ];
}
