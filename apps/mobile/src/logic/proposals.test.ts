import type { ScheduleChange, ScheduleProposal } from '@fitness/engine';
import { describe, expect, it } from 'vitest';
import { changesForDisplay, proposalLabel } from './proposals';

const base: ScheduleChange = {
  id: '00000001-0000-4000-8000-000000000001',
  plan_id: '00000001-0000-4000-8000-000000000002',
  planned_session_id: '00000001-0000-4000-8000-000000000003',
  kind: 'skip',
  reason: 'Skipped.',
  from_date: '2026-10-12',
  created_by: 'user',
  created_at: '2026-10-12T08:00:00.000Z',
};

function proposal(
  kind: ScheduleProposal['kind'],
  changes: Partial<ScheduleChange>[],
): ScheduleProposal {
  return {
    kind,
    changes: changes.map((change, index) => ({
      ...base,
      id: `0000000${index + 2}-0000-4000-8000-000000000001`,
      ...change,
    })),
  };
}

describe('proposalLabel', () => {
  it('names the minimum dose and short versions with their minutes', () => {
    expect(proposalLabel(proposal('shorten', [{ kind: 'shorten', new_est_minutes: 12 }]))).toBe(
      'Minimum dose (12 min)',
    );
    expect(proposalLabel(proposal('shorten', [{ kind: 'shorten', new_est_minutes: 28 }]))).toBe(
      'Shorter session (28 min)',
    );
    expect(proposalLabel(proposal('move', [{ kind: 'move', to_date: '2026-10-13' }]))).toBe('Move');
    expect(proposalLabel(proposal('skip', [{}]))).toBe('Skip');
  });
});

describe('changesForDisplay', () => {
  it('lists the move first in a displacement, without changing the apply order', () => {
    const displacement = proposal('move', [
      { kind: 'skip', reason: 'Other session skipped.' },
      { kind: 'move', to_date: '2026-10-14', reason: 'Key session moved.' },
    ]);
    expect(changesForDisplay(displacement).map((change) => change.kind)).toEqual(['move', 'skip']);
    expect(displacement.changes.map((change) => change.kind)).toEqual(['skip', 'move']);
  });
});
