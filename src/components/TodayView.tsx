import { findDay, formatLongDateSk, type TrainingPlan } from '../plan';
import { hrefs } from '../routing';
import { DayView } from './DayView';
import { APP_NAME } from './labels';
import { StartControl } from './Overview';
import { SafetyNote } from './SafetyNote';
import { startMessage } from './startMessage';
import type { SwapHandler } from './SwapControl';
import { useFocusHeading } from './useFocusHeading';

interface TodayViewProps {
  plan: TrainingPlan;
  today: string;
  onStartChange: (start: string) => void;
  onSwap: SwapHandler;
}

/** Home screen: only today's workout, with a way to the whole month. */
export function TodayView({ plan, today, onStartChange, onSwap }: TodayViewProps) {
  if (findDay(plan, today)) {
    return <DayView plan={plan} date={today} today={today} onSwap={onSwap} isHome />;
  }
  return <NoWorkoutToday plan={plan} today={today} onStartChange={onStartChange} />;
}

function NoWorkoutToday({ plan, today, onStartChange }: Omit<TodayViewProps, 'onSwap'>) {
  const heading = useFocusHeading(`Dnes · ${APP_NAME}`);
  const upcoming = today < plan.startDate;
  return (
    <article className="today-empty" aria-labelledby="today-title">
      <nav className="crumbs" aria-label="Navigácia">
        <a className="button button--month" href={hrefs.overview()}>
          Celý mesiac
        </a>
      </nav>
      <header className="day__header">
        <p className="eyebrow">Dnes · {formatLongDateSk(today)}</p>
        <h1 id="today-title" ref={heading} tabIndex={-1}>
          {upcoming ? 'Plán ešte nezačal' : 'Plán skončil'}
        </h1>
        <p className="day__focus">{startMessage(plan, today)}</p>
        {upcoming && (
          <p>
            <a className="button" href={hrefs.day(plan.startDate)}>
              Pozrieť prvý tréning ({formatLongDateSk(plan.startDate)})
            </a>
          </p>
        )}
      </header>
      <StartControl plan={plan} today={today} onStartChange={onStartChange} />
      <SafetyNote />
    </article>
  );
}
