import {
  WEEKDAY_SHORT,
  daysBetween,
  formatDateSk,
  formatLongDateSk,
  type DayPlan,
  type TrainingPlan,
} from '../plan';
import { hrefs } from '../routing';
import { DayTypeBadge } from './DayTypeBadge';
import { APP_NAME, DAY_TYPE_DESCRIPTIONS, DAY_TYPE_LABELS, minutesLabel } from './labels';
import { SafetyNote } from './SafetyNote';
import { useFocusHeading } from './useFocusHeading';

interface OverviewProps {
  plan: TrainingPlan;
  today: string;
}

/** Slovak plural for days: 2–4 "dni", 5+ "dní". */
function daysWord(n: number): string {
  return n >= 2 && n <= 4 ? 'dni' : 'dní';
}

function startMessage(plan: TrainingPlan, today: string): string {
  const until = daysBetween(today, plan.startDate);
  if (until > 1) return `Plán začína o ${until} ${daysWord(until)}.`;
  if (until === 1) return 'Plán začína zajtra.';
  if (until === 0) return 'Plán začína dnes. Veľa šťastia!';
  if (today > plan.endDate) return 'Plán skončil.';
  return `Prebieha ${Math.floor(-until / 7) + 1}. týždeň plánu.`;
}

function DayCard({ day, isToday }: { day: DayPlan; isToday: boolean }) {
  const label = [
    formatLongDateSk(day.date),
    isToday ? 'dnes' : null,
    `${DAY_TYPE_LABELS[day.type]}: ${day.shortLabel}`,
    day.estimatedMinutes > 0 ? `približne ${minutesLabel(day.estimatedMinutes)}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <li className="calendar__cell">
      <a
        href={hrefs.day(day.date)}
        className={`day-card day-card--${day.type}${isToday ? ' day-card--today' : ''}`}
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

export function Overview({ plan, today }: OverviewProps) {
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
          približne hodinu. Klikni na deň a uvidíš presný program.
        </p>
        <p className="hero__meta">
          <span>
            {formatLongDateSk(plan.startDate)} – {formatLongDateSk(plan.endDate)}
          </span>
          <span className="hero__status">{startMessage(plan, today)}</span>
        </p>
      </section>

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
                  <DayCard key={day.date} day={day} isToday={day.date === today} />
                ))}
            </ol>
          </section>
        ))}
      </div>

      <SafetyNote />
    </div>
  );
}
