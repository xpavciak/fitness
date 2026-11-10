import { useRef, type MouseEvent } from 'react';
import { DayView } from './components/DayView';
import { AppErrorBoundary } from './components/ErrorBoundary';
import { ExerciseView } from './components/ExerciseView';
import { NotInPlan } from './components/NotFound';
import { Overview } from './components/Overview';
import { TodayView } from './components/TodayView';
import { APP_NAME } from './components/labels';
import { useFocusHeading } from './components/useFocusHeading';
import { useHashRoute } from './hooks/useHashRoute';
import { usePlan } from './hooks/usePlan';
import { useToday } from './hooks/useToday';
import { hrefs, type Route } from './routing';

function PageNotFound() {
  const heading = useFocusHeading(`Stránka sa nenašla · ${APP_NAME}`);
  return (
    <NotInPlan headingRef={heading} title="Stránka sa nenašla" message="Táto adresa neexistuje." />
  );
}

function routeKey(route: Route): string {
  switch (route.name) {
    case 'today':
      return 'today';
    case 'overview':
      return 'overview';
    case 'day':
      return `day-${route.date}`;
    case 'exercise':
      return `ex-${route.date}-${route.exerciseId}`;
    case 'not-found':
      return 'nf';
  }
}

export interface AppProps {
  /** Override "today" (ISO date) – used by tests. */
  today?: string;
}

export function App({ today: todayOverride }: AppProps) {
  const liveToday = useToday();
  const today = todayOverride ?? liveToday;
  const route = useHashRoute();
  const { plan, setStart, swapExercise } = usePlan(today);
  const mainRef = useRef<HTMLElement>(null);

  // Hash routing would treat "#obsah" as a route, so move focus manually.
  const skipToContent = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    mainRef.current?.focus();
  };

  let page;
  switch (route.name) {
    case 'today':
      page = <TodayView plan={plan} today={today} onStartChange={setStart} onSwap={swapExercise} />;
      break;
    case 'overview':
      page = <Overview plan={plan} today={today} onStartChange={setStart} />;
      break;
    case 'day':
      page = <DayView plan={plan} date={route.date} today={today} onSwap={swapExercise} />;
      break;
    case 'exercise':
      page = <ExerciseView plan={plan} date={route.date} exerciseId={route.exerciseId} />;
      break;
    case 'not-found':
      page = <PageNotFound />;
      break;
  }

  return (
    <>
      <a className="skip-link" href="#obsah" onClick={skipToContent}>
        Preskočiť na obsah
      </a>
      <header className="topbar">
        <a className="brand" href={hrefs.today()}>
          <span className="brand__mark" aria-hidden="true" />
          <span className="brand__text">{APP_NAME}</span>
        </a>
        <nav className="topnav" aria-label="Hlavná navigácia">
          <a href={hrefs.today()} aria-current={route.name === 'today' ? 'page' : undefined}>
            Dnes
          </a>
          <a href={hrefs.overview()} aria-current={route.name === 'overview' ? 'page' : undefined}>
            Celý mesiac
          </a>
        </nav>
      </header>
      <main id="obsah" className="page" ref={mainRef} tabIndex={-1}>
        {/* Keyed by route so an error on one page is cleared by navigating away. */}
        <AppErrorBoundary key={routeKey(route)}>{page}</AppErrorBoundary>
      </main>
      <footer className="footer">
        <p>Plán je generovaný deterministicky – rovnaký začiatok vždy znamená rovnaký plán.</p>
      </footer>
    </>
  );
}
