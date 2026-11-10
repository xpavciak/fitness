import { addDays, findDay, formatLongDateSk, sectionMinutes, type TrainingPlan } from '../plan';
import { hrefs } from '../routing';
import { DayTypeBadge } from './DayTypeBadge';
import { APP_NAME, minutesLabel } from './labels';
import { NotInPlan } from './NotFound';
import { SafetyNote } from './SafetyNote';
import { WorkoutItemRow } from './WorkoutItemRow';
import { useFocusHeading } from './useFocusHeading';

interface DayViewProps {
  plan: TrainingPlan;
  date: string;
  today: string;
}

export function DayView({ plan, date, today }: DayViewProps) {
  const day = findDay(plan, date);
  const heading = useFocusHeading(
    day ? `${day.title} · ${APP_NAME}` : `Deň mimo plánu · ${APP_NAME}`,
  );
  if (!day) return <NotInPlan headingRef={heading} />;

  const week = plan.weeks[day.week - 1];
  const prev = findDay(plan, addDays(date, -1));
  const next = findDay(plan, addDays(date, 1));

  return (
    <article className="day" aria-labelledby="day-title">
      <nav className="crumbs" aria-label="Navigácia">
        <a href={hrefs.overview()}>← Prehľad mesiaca</a>
      </nav>
      <header className="day__header">
        <p className="eyebrow">
          {formatLongDateSk(day.date)} · Týždeň {day.week}
          {week ? ` – ${week.name}` : ''}
        </p>
        <h1 id="day-title" ref={heading} tabIndex={-1}>
          {day.title}
        </h1>
        <div className="day__meta">
          <DayTypeBadge type={day.type} />
          {day.date === today && <span className="pill pill--today">Dnes</span>}
          {day.estimatedMinutes > 0 && (
            <span className="pill pill--time">Odhad: ≈ {minutesLabel(day.estimatedMinutes)}</span>
          )}
          {day.type === 'gym' && week && <span className="pill">RIR {week.rir}</span>}
        </div>
        {week && day.type !== 'rest' && <p className="day__focus">{week.focus}</p>}
      </header>

      {day.sections.length > 0 ? (
        <ol className="sections">
          {day.sections.map((section) => (
            <li key={section.kind} className={`section section--${section.kind}`}>
              <h2 className="section__title">
                {section.title}
                <span className="section__time">
                  {minutesLabel(Math.round(sectionMinutes(section)))}
                </span>
              </h2>
              <ol className="items">
                {section.items.map((item, i) => (
                  <WorkoutItemRow key={i} item={item} date={day.date} />
                ))}
              </ol>
            </li>
          ))}
        </ol>
      ) : (
        <p className="day__rest">Dnes žiadny tréning. Oddychuj a regeneruj.</p>
      )}

      {day.notes.length > 0 && (
        <section className="notes" aria-labelledby="notes-title">
          <h2 id="notes-title">Tipy trénera</h2>
          <ul>
            {day.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <nav className="pager" aria-label="Ďalšie dni">
        {prev ? (
          <a href={hrefs.day(prev.date)} rel="prev">
            ← {formatLongDateSk(prev.date)}
          </a>
        ) : (
          <span />
        )}
        {next && (
          <a href={hrefs.day(next.date)} rel="next">
            {formatLongDateSk(next.date)} →
          </a>
        )}
      </nav>
      <SafetyNote />
    </article>
  );
}
