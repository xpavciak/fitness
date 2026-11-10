import { useState } from 'react';
import {
  MUSCLE_LABELS,
  exerciseIdsOfDay,
  findDay,
  formatLongDateSk,
  getExercise,
  linkedExerciseIdsOfDay,
  type DayPlan,
  type TrainingPlan,
  type WorkoutItem,
} from '../plan';
import { hrefs } from '../routing';
import { isWebGLAvailable } from '../hologram/webgl';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { Hologram } from './Hologram';
import { APP_NAME, minutesLabel } from './labels';
import { NotInPlan } from './NotFound';
import { StrengthStats } from './StrengthStats';
import { useFocusHeading } from './useFocusHeading';

interface Props {
  plan: TrainingPlan;
  date: string;
  exerciseId: string;
}

function findItem(day: DayPlan, exerciseId: string): WorkoutItem | undefined {
  const items = day.sections.flatMap((s) => s.items);
  // Prefer the working prescription over warm-up mentions of the same exercise.
  return (
    items.find((i) => i.kind === 'strength' && i.exerciseId === exerciseId) ??
    items.find((i) => i.exerciseId === exerciseId) ??
    items.find((i) => i.kind === 'timed' && i.alternativeExerciseId === exerciseId)
  );
}

function Prescription({ item }: { item: WorkoutItem }) {
  if (item.kind === 'strength') {
    return (
      <dl className="prescription" aria-label="Predpis na dnes">
        <div>
          <dt>
            Série ×{' '}
            {item.measure === 'reps' ? 'opakovania' : item.measure === 'hold' ? 'výdrž' : 'úsek'}
          </dt>
          <dd>
            {item.sets} × {item.reps}
          </dd>
        </div>
        <div>
          <dt>Oddych</dt>
          <dd>{item.restSeconds} s</dd>
        </div>
        <StrengthStats item={item} />
      </dl>
    );
  }
  return (
    <dl className="prescription" aria-label="Predpis na dnes">
      <div>
        <dt>Trvanie</dt>
        <dd>{minutesLabel(item.minutes)}</dd>
      </div>
      {item.intensity && (
        <div className="prescription__wide">
          <dt>Intenzita</dt>
          <dd>{item.intensity}</dd>
        </div>
      )}
    </dl>
  );
}

/** Why the deep-linked exercise has no prescription for this date. */
function PlanNotice({ day, date }: { day: DayPlan | undefined; date: string }) {
  return (
    <p className="notice" role="note">
      {day ? (
        <>
          Tento cvik nie je v pláne na tento deň ({formatLongDateSk(date)}).{' '}
          <a href={hrefs.day(day.date)}>Zobraziť tréning dňa</a>
        </>
      ) : (
        <>
          Tento deň nie je v aktuálnom pláne. <a href={hrefs.overview()}>Späť na prehľad mesiaca</a>
        </>
      )}
    </p>
  );
}

export function ExerciseView({ plan, date, exerciseId }: Props) {
  const exercise = getExercise(exerciseId);
  const heading = useFocusHeading(
    exercise ? `${exercise.name} · ${APP_NAME}` : `Cvik sa nenašiel · ${APP_NAME}`,
  );
  const reducedMotion = usePrefersReducedMotion();
  const coarsePointer = useMediaQuery('(pointer: coarse)');
  const [playing, setPlaying] = useState(!reducedMotion);
  const [turns, setTurns] = useState(0);
  const [webgl, setWebgl] = useState(isWebGLAvailable);

  if (!exercise) {
    return (
      <NotInPlan
        headingRef={heading}
        title="Cvik sa nenašiel"
        message="Tento cvik v knižnici cvikov neexistuje."
      />
    );
  }

  const day = findDay(plan, date);
  const inDay = day ? linkedExerciseIdsOfDay(day).includes(exerciseId) : false;
  const item = day && inDay ? findItem(day, exerciseId) : undefined;
  const ids = day && inDay ? exerciseIdsOfDay(day) : [];
  const index = ids.indexOf(exerciseId);
  const prevId = index > 0 ? ids[index - 1] : undefined;
  const nextId = index >= 0 && index < ids.length - 1 ? ids[index + 1] : undefined;

  return (
    <article className="exercise" aria-labelledby="exercise-title">
      <nav className="crumbs" aria-label="Navigácia">
        <a href={hrefs.overview()}>Prehľad</a>
        {day && inDay && (
          <>
            <span aria-hidden="true"> / </span>
            <a href={hrefs.day(day.date)}>
              {formatLongDateSk(day.date)} – {day.shortLabel}
            </a>
          </>
        )}
      </nav>

      <header className="exercise__header">
        <p className="eyebrow">{exercise.equipment}</p>
        <h1 id="exercise-title" ref={heading} tabIndex={-1}>
          {exercise.name}
        </h1>
        {!inDay && <PlanNotice day={day} date={date} />}
        {item && <Prescription item={item} />}
        {item?.kind === 'strength' && <p className="exercise__cue">{item.cue}</p>}
      </header>

      <div className="exercise__layout">
        <section className="stage" aria-label="3D ukážka cviku">
          <div className="stage__viewport">
            <Hologram
              animation={exercise.animation}
              playing={playing}
              reducedMotion={reducedMotion}
              turns={turns}
              exerciseName={exercise.name}
              webgl={webgl}
              onUnavailable={() => setWebgl(false)}
            />
          </div>
          {webgl && (
            <div className="stage__controls">
              <button
                type="button"
                className="button button--icon"
                aria-label="Otočiť postavu doľava"
                onClick={() => setTurns((t) => t - 1)}
              >
                <span aria-hidden="true">←</span>
              </button>
              <button
                type="button"
                className="button"
                aria-pressed={playing}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? 'Pozastaviť animáciu' : 'Prehrať animáciu'}
              </button>
              <button
                type="button"
                className="button button--icon"
                aria-label="Otočiť postavu doprava"
                onClick={() => setTurns((t) => t + 1)}
              >
                <span aria-hidden="true">→</span>
              </button>
              <p className="stage__hint">
                {coarsePointer
                  ? 'Potiahnutím prstom do strany otočíš postavu.'
                  : 'Ťahaním myšou alebo šípkami otočíš postavu.'}
              </p>
            </div>
          )}
        </section>

        <section className="panel panel--steps" aria-labelledby="steps-title">
          <h2 id="steps-title">Technika krok za krokom</h2>
          <ol className="steps">
            {exercise.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {exercise.safety && (
            <div className="safety-setup">
              <h3>Bezpečnosť</h3>
              <ul>
                {exercise.safety.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="panel panel--muscles" aria-labelledby="muscles-title">
          <h2 id="muscles-title">Zapojené svaly</h2>
          <ul className="tags">
            {exercise.primaryMuscles.map((m) => (
              <li key={m} className="tag tag--primary">
                {MUSCLE_LABELS[m]}
              </li>
            ))}
            {exercise.secondaryMuscles.map((m) => (
              <li key={m} className="tag">
                {MUSCLE_LABELS[m]}
              </li>
            ))}
          </ul>
          <p className="panel__hint">Zvýraznené = hlavné svaly, ostatné pomáhajú.</p>
        </section>

        <section className="panel panel--mistakes" aria-labelledby="mistakes-title">
          <h2 id="mistakes-title">Časté chyby</h2>
          <ul className="mistakes">
            {exercise.mistakes.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </section>

        <section className="panel panel--alternatives" aria-labelledby="alt-title">
          <h2 id="alt-title">Alternatívy</h2>
          <dl className="alternatives">
            <div>
              <dt>Ľahšia</dt>
              <dd>{exercise.easier}</dd>
            </div>
            <div>
              <dt>Ťažšia</dt>
              <dd>{exercise.harder}</dd>
            </div>
          </dl>
        </section>
      </div>

      {day && (prevId || nextId) && (
        <nav className="pager" aria-label="Ďalšie cviky v tento deň">
          {prevId ? (
            <a href={hrefs.exercise(day.date, prevId)} rel="prev">
              ← {getExercise(prevId)?.name}
            </a>
          ) : (
            <span />
          )}
          {nextId && (
            <a href={hrefs.exercise(day.date, nextId)} rel="next">
              {getExercise(nextId)?.name} →
            </a>
          )}
        </nav>
      )}
    </article>
  );
}
