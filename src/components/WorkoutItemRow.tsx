import { getExercise, type StrengthItem, type TimedItem, type WorkoutItem } from '../plan';
import { hrefs } from '../routing';
import { minutesLabel } from './labels';
import { StrengthStats } from './StrengthStats';

function StrengthRow({ item, date }: { item: StrengthItem; date: string }) {
  const exercise = getExercise(item.exerciseId);
  const name = exercise?.name ?? item.exerciseId;
  return (
    <li className="item item--strength">
      <div className="item__head">
        <a className="item__name" href={hrefs.exercise(date, item.exerciseId)}>
          {name}
        </a>
        <span
          className="item__dose"
          aria-label={`${item.sets} ${item.sets >= 5 ? 'sérií' : 'série'} po ${item.reps}`}
        >
          {item.sets} × {item.reps}
        </span>
      </div>
      <dl className="item__stats">
        <div>
          <dt>Oddych</dt>
          <dd>{item.restSeconds} s</dd>
        </div>
        <StrengthStats item={item} />
      </dl>
      <p className="item__cue">{item.cue}</p>
      {exercise?.unilateral && (
        <p className="item__note">Jednostranný cvik – séria = obe strany.</p>
      )}
    </li>
  );
}

function TimedRow({ item, date }: { item: TimedItem; date: string }) {
  return (
    <li className="item item--timed">
      <div className="item__head">
        {item.exerciseId ? (
          <a className="item__name" href={hrefs.exercise(date, item.exerciseId)}>
            {item.name}
          </a>
        ) : (
          <span className="item__name">{item.name}</span>
        )}
        <span className="item__dose">{minutesLabel(item.minutes)}</span>
      </div>
      <p className="item__cue">{item.detail}</p>
      {item.intensity && <p className="item__intensity">{item.intensity}</p>}
      {item.alternativeExerciseId && (
        <p className="item__note">
          Alternatíva:{' '}
          <a href={hrefs.exercise(date, item.alternativeExerciseId)}>
            {getExercise(item.alternativeExerciseId)?.name ?? item.alternativeExerciseId}
          </a>
        </p>
      )}
    </li>
  );
}

export function WorkoutItemRow({ item, date }: { item: WorkoutItem; date: string }) {
  return item.kind === 'strength' ? (
    <StrengthRow item={item} date={date} />
  ) : (
    <TimedRow item={item} date={date} />
  );
}
