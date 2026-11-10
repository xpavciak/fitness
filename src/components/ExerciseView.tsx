import { useState } from 'react';
import {
  MUSCLE_LABELS,
  exerciseIdsOfDay,
  findDay,
  formatLongDateSk,
  getExercise,
  type DayPlan,
  type WorkoutItem,
  type TrainingPlan,
} from '../plan';
import { hrefs } from '../routing';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { Hologram } from './Hologram';
import { APP_NAME, minutesLabel } from './labels';
import { NotInPlan } from './NotFound';
import { useFocusHeading } from './useFocusHeading';

interface Props {
  plan: TrainingPlan;
  date: string;
  exerciseId: string;
}

function findItem(day: DayPlan | undefined, exerciseId: string): WorkoutItem | undefined {
  const items = day?.sections.flatMap((s) => s.items) ?? [];
  // Prefer the working prescription over warm-up mentions of the same exercise.
  return (
    items.find((i) => i.kind === 'strength' && i.exerciseId === exerciseId) ??
    items.find((i) => i.exerciseId === exerciseId)
  );
}

function Prescription({ item }: { item: WorkoutItem }) {
  if (item.kind === 'strength') {
    return (
      <dl className="prescription" aria-label="Predpis na dnes">
        <div>
          <dt>Série × opakovania</dt>
          <dd>
            {item.sets} × {item.reps}
          </dd>
        </div>
        <div>
          <dt>Oddych</dt>
          <dd>{item.restSeconds} s</dd>
        </div>
        <div>
          <dt>RIR</dt>
          <dd>{item.rir}</dd>
        </div>
        <div>
          <dt>Tempo</dt>
          <dd>{item.tempo === '0-0-0' ? 'výdrž' : item.tempo}</dd>
        </div>
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

export function ExerciseView({ plan, date, exerciseId }: Props) {
  const exercise = getExercise(exerciseId);
  const day = findDay(plan, date);
  const heading = useFocusHeading(
    exercise ? `${exercise.name} · ${APP_NAME}` : `Cvik sa nenašiel · ${APP_NAME}`,
  );
  const reducedMotion = usePrefersReducedMotion();
  const [playing, setPlaying] = useState(!reducedMotion);

  if (!exercise) {
    return (
      <NotInPlan
        headingRef={heading}
        title="Cvik sa nenašiel"
        message="Tento cvik v knižnici cvikov neexistuje."
      />
    );
  }

  const item = findItem(day, exerciseId);
  const ids = day ? exerciseIdsOfDay(day) : [];
  const index = ids.indexOf(exerciseId);
  const prevId = index > 0 ? ids[index - 1] : undefined;
  const nextId = index >= 0 && index < ids.length - 1 ? ids[index + 1] : undefined;

  return (
    <article className="exercise" aria-labelledby="exercise-title">
      <nav className="crumbs" aria-label="Navigácia">
        <a href={hrefs.overview()}>Prehľad</a>
        {day && (
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
              exerciseName={exercise.name}
            />
          </div>
          <div className="stage__controls">
            <button
              type="button"
              className="button"
              aria-pressed={playing}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? 'Pozastaviť animáciu' : 'Prehrať animáciu'}
            </button>
            <span className="stage__hint">Ťahaním otočíš postavu, kolieskom priblížiš.</span>
          </div>
        </section>

        <section className="panel panel--steps" aria-labelledby="steps-title">
          <h2 id="steps-title">Technika krok za krokom</h2>
          <ol className="steps">
            {exercise.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
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
