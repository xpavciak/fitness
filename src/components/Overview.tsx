import {
  WEEKDAY_SHORT,
  daysBetween,
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
import { useFocusHeading } from './useFocusHeading';

interface OverviewProps {
  plan: TrainingPlan;
  today: string;
  onStartChange: (start: string) => void;
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
  if (today > plan.endDate) return 'Plán skončil. Môžeš začať nový.';
  return `Prebieha ${Math.floor(-until / 7) + 1}. týždeň plánu.`;
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

function StartControl({ plan, today, onStartChange }: OverviewProps) {
  const options = startOptions(today);
  const ended = planStatus(plan.startDate, today) === 'ended';
  const choices = [
    { start: options.thisWeek, label: 'Začať tento týždeň' },
    { start: options.nextWeek, label: 'Začať budúci pondelok' },
  ];
  return (
    <section className="start-control" aria-labelledby="start-title">
      <h2 id="start-title">{ended ? 'Plán skončil – začni nový' : 'Začiatok plánu'}</h2>
      <p className="start-control__hint">
        Plán vždy začína v pondelok. Pri začiatku v tomto týždni sú dni pred dneškom označené ako
        uplynulé.
      </p>
      <div className="start-control__buttons">
        {choices.map(({ start, label }) => {
          const active = !ended && plan.startDate === start;
          return (
            <button
              key={start}
              type="button"
              className="button"
              aria-pressed={active}
              onClick={() => onStartChange(start)}
            >
              {label} <span className="start-control__date">(po {formatDateSk(start, false)})</span>
            </button>
          );
        })}
      </div>
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
          približne hodinu. Klikni na deň a uvidíš presný program.
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
