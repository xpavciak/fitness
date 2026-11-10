import { useEffect, useRef } from 'react';

/** Moves focus to the page heading on mount (route change) and sets the title. */
export function useFocusHeading(title: string) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = title;
    ref.current?.focus({ preventScroll: true });
    window.scrollTo?.({ top: 0 });
  }, [title]);
  return ref;
}
