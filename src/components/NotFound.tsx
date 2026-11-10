import type { RefObject } from 'react';
import { hrefs } from '../routing';

interface Props {
  headingRef: RefObject<HTMLHeadingElement | null>;
  title?: string;
  message?: string;
}

export function NotInPlan({
  headingRef,
  title = 'Tento deň nie je v aktuálnom pláne',
  message = 'Odkaz pravdepodobne patrí k staršiemu plánu alebo je neplatný.',
}: Props) {
  return (
    <section className="not-found" aria-labelledby="nf-title">
      <h1 id="nf-title" ref={headingRef} tabIndex={-1}>
        {title}
      </h1>
      <p>{message}</p>
      <p>
        <a className="button" href={hrefs.overview()}>
          Späť na prehľad mesiaca
        </a>
      </p>
    </section>
  );
}
