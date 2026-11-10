import { useEffect, useRef, useState } from 'react';
import {
  WEEKDAY_SHORT,
  formatDateSk,
  formatLongDateSk,
  planStatus,
  startOptions,
  type DayPlan,
  type TrainingPlan,
} from '../plan';
import { hrefs } from '../routing';
import { DayTypeBadge } from './DayTypeBadge';
import { APP_NAME, DAY_TYPE_DESCRIPTIONS, DAY_TYPE_LABELS, minutesLabel } from './labels';
import { SafetyNote } from './SafetyNote';
import { startMessage } from './startMessage';
import { useFocusHeading } from './useFocusHeading';

export interface OverviewProps {
  plan: TrainingPlan;
  today: string;
  onStartChange: (start: string) => void;
}

function DayCard({ day, today }: { day: DayPlan; today: string }) {
  const isToday = day.date === today;
  const isPast = day.date < today;
  const label = [
    formatLongDateSk(day.date),
    isToday ? 'dnes' : null,
    isPast ? 'uplynulý deň' : null,
    `${DAY_TYPE_LABELS[day.type]}: ${day.shortLabel}`,
    day.estimatedMinutes > 0 ? `približne ${minutesLabel(day.estimatedMinutes)}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <li className="calendar__cell">
      <a
        href={hrefs.day(day.date)}
        className={`day-card day-card--${day.type}${isToday ? ' day-card--today' : ''}${isPast ? ' day-card--past' : ''}`}
        aria-label={label}
        aria-current={isToday ? 'date' : undefined}
      >
        <span className="day-card__date">
          <span className="day-card__weekday">{WEEKDAY_SHORT[day.weekday]}</span>
          {formatDateSk(day.date, false)}
          {isToday && <span className="day-card__today">Dnes</span>}
        </span>
        <DayTypeBadge type={day.type} />
        <span className="day-card__label">{day.shortLabel}</span>
        {day.estimatedMinutes > 0 && (
          <span className="day-card__time">≈ {minutesLabel(day.estimatedMinutes)}</span>
        )}
      </a>
    </li>
  );
}

export function StartControl({ plan, today, onStartChange }: OverviewProps) {
  const options = startOptions(today);
  const status = planStatus(plan.startDate, today);
  const ended = status === 'ended';
  const [pending, setPending] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  /** Start button that opened the confirmation; focus returns here on close. */
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);
  const choicesRef = useRef<HTMLDivElement>(null);

  // The question only makes sense while the plan runs (e.g. it may end at midnight).
  if (pending !== null && status !== 'running') setPending(null);
  const choices = [
    { start: options.thisWeek, label: 'Začať tento týždeň' },
    { start: options.nextWeek, label: 'Začať budúci pondelok' },
  ];

  useEffect(() => {
    if (pending) {
      wasOpen.current = true;
      cancelRef.current?.focus();
      return;
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      // The confirmation's buttons are gone; don't leave focus on <body>.
      const active = document.activeElement;
      if (active && active !== document.body) return;
      // The opener can be re-rendered away when the options change (new week).
      const opener = openerRef.current?.isConnected ? openerRef.current : null;
      (opener ?? choicesRef.current?.querySelector('button'))?.focus();
    }
  }, [pending]);

  const choose = (start: string, opener: HTMLButtonElement) => {
    if (start === plan.startDate) return;
    // Replacing a plan that is already in progress needs an explicit confirmation.
    if (status === 'running') {
      openerRef.current = opener;
      setPending(start);
    } else {
      onStartChange(start);
    }
  };

  return (
    <section className="start-control" aria-labelledby="start-title">
      <h2 id="start-title">{ended ? 'Plán skončil – začni nový' : 'Začiatok plánu'}</h2>
      <p className="start-control__hint">
        Plán vždy začína v pondelok. Pri začiatku v tomto týždni sú dni pred dneškom označené ako
        uplynulé.
      </p>
      <div className="start-control__buttons" ref={choicesRef}>
        {choices.map(({ start, label }) => {
          const active = !ended && plan.startDate === start;
          return (
            <button
              key={start}
              type="button"
              className="button"
              aria-pressed={active}
              onClick={(event) => choose(start, event.currentTarget)}
            >
              {label} <span className="start-control__date">(po {formatDateSk(start, false)})</span>
            </button>
          );
        })}
      </div>
      {pending && (
        <div
          className="start-control__confirm"
          role="group"
          aria-labelledby="restart-question"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setPending(null);
            }
          }}
        >
          <p id="restart-question">
            <strong>Naozaj začať odznova?</strong> Rozbehnutý plán sa nahradí novým od pondelka{' '}
            {formatDateSk(pending)}.
          </p>
          <div className="start-control__buttons">
            <button
              type="button"
              className="button button--danger"
              onClick={() => {
                onStartChange(pending);
                setPending(null);
              }}
            >
              Áno, začať odznova
            </button>
            <button
              type="button"
              className="button"
              ref={cancelRef}
              onClick={() => setPending(null)}
            >
              Zrušiť
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function Overview({ plan, today, onStartChange }: OverviewProps) {
  const heading = useFocusHeading(APP_NAME);
  return (
    <div className="overview">
      <section className="hero" aria-labelledby="overview-title">
        <p className="eyebrow">Mesačný plán · 4 týždne</p>
        <h1 id="overview-title" ref={heading} tabIndex={-1}>
          Tvoj tréningový mesiac
        </h1>
        <p className="hero__lead">
          3× týždenne posilňovňa (nohy, tlak, ťah), 2× beh a zvyšok regenerácia. Každý tréning
          približne hodinu. Klikni na deň a uvidíš presný program.{' '}
          <a href={hrefs.today()}>Späť na dnešný tréning</a>
        </p>
        <p className="hero__meta">
          <span>
            {formatLongDateSk(plan.startDate)} – {formatLongDateSk(plan.endDate)}
          </span>
          <span className="hero__status">{startMessage(plan, today)}</span>
        </p>
      </section>

      <StartControl plan={plan} today={today} onStartChange={onStartChange} />

      <ul className="legend" aria-label="Legenda">
        {(['gym', 'cardio', 'rest'] as const).map((type) => (
          <li key={type}>
            <DayTypeBadge type={type} />
            <span className="legend__text">{DAY_TYPE_DESCRIPTIONS[type]}</span>
          </li>
        ))}
        <li>
          <span className="legend__today" aria-hidden="true" />
          <span className="legend__text">dnešný deň</span>
        </li>
      </ul>

      <div className="calendar">
        <div className="calendar__head" aria-hidden="true">
          {WEEKDAY_SHORT.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        {plan.weeks.map((week) => (
          <section
            key={week.week}
            className={`week week--${week.week}`}
            aria-labelledby={`week-${week.week}`}
          >
            <header className="week__header">
              <h2 id={`week-${week.week}`}>
                Týždeň {week.week} <span className="week__name">· {week.name}</span>
              </h2>
              <p className="week__focus">
                <span className="pill">RIR {week.rir}</span> {week.focus}
              </p>
            </header>
            <ol className="calendar__grid">
              {plan.days
                .filter((d) => d.week === week.week)
                .map((day) => (
                  <DayCard key={day.date} day={day} today={today} />
                ))}
            </ol>
          </section>
        ))}
      </div>

      <SafetyNote />
    </div>
  );
}
