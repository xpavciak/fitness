import { Component, type ReactNode } from 'react';
import { hrefs } from '../routing';

interface Props {
  children: ReactNode;
}

/** Last line of defence: a render error shows a message instead of a blank page. */
export class AppErrorBoundary extends Component<Props, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error('Unexpected render error', error);
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <section className="not-found" role="alert">
        <h1>Niečo sa pokazilo</h1>
        <p>Túto stránku sa nepodarilo zobraziť. Skús sa vrátiť na prehľad mesiaca.</p>
        <p>
          <a className="button" href={hrefs.overview()}>
            Späť na prehľad mesiaca
          </a>
        </p>
      </section>
    );
  }
}
