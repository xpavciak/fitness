import { toLocalIsoDate } from './plan';
import { DayView } from './components/DayView';
import { ExerciseView } from './components/ExerciseView';
import { NotInPlan } from './components/NotFound';
import { Overview } from './components/Overview';
import { APP_NAME } from './components/labels';
import { useFocusHeading } from './components/useFocusHeading';
import { useHashRoute } from './hooks/useHashRoute';
import { usePlan } from './hooks/usePlan';
import { hrefs, type Route } from './routing';

function PageNotFound() {
  const heading = useFocusHeading(`Stránka sa nenašla · ${APP_NAME}`);
  return (
    <NotInPlan headingRef={heading} title="Stránka sa nenašla" message="Táto adresa neexistuje." />
  );
}

function routeKey(route: Route): string {
  switch (route.name) {
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

export function App({ today = toLocalIsoDate(new Date()) }: AppProps) {
  const route = useHashRoute();
  const plan = usePlan(today);

  let page;
  switch (route.name) {
    case 'overview':
      page = <Overview plan={plan} today={today} />;
      break;
    case 'day':
      page = <DayView plan={plan} date={route.date} />;
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
      <a className="skip-link" href="#obsah">
        Preskočiť na obsah
      </a>
      <header className="topbar">
        <a className="brand" href={hrefs.overview()}>
          <span className="brand__mark" aria-hidden="true" />
          {APP_NAME}
        </a>
        <span className="topbar__tag">nohy · tlak · ťah · beh</span>
      </header>
      <main id="obsah" className="page" key={routeKey(route)}>
        {page}
      </main>
      <footer className="footer">
        <p>Plán je generovaný deterministicky – rovnaký začiatok vždy znamená rovnaký plán.</p>
      </footer>
    </>
  );
}
