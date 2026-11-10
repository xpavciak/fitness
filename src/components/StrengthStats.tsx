import type { StrengthItem } from '../plan';

/** RIR plus tempo, hold or carry info depending on what the sets measure. */
export function StrengthStats({ item }: { item: StrengthItem }) {
  return (
    <>
      <div>
        <dt>RIR</dt>
        <dd>{item.rir}</dd>
      </div>
      {item.measure === 'reps' && (
        <div>
          <dt>Tempo</dt>
          <dd>{item.tempo}</dd>
        </div>
      )}
      {item.measure === 'hold' && (
        <div>
          <dt>Výdrž</dt>
          <dd>{item.reps}</dd>
        </div>
      )}
      {item.measure === 'distance' && (
        <div>
          <dt>Úsek</dt>
          <dd>
            {item.reps} (≈ {item.workSecondsPerSet} s)
          </dd>
        </div>
      )}
    </>
  );
}
