import { useEffect, useState } from 'react';
import { isRouteHash, parseHash, type Route } from '../routing';

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => {
    const hash = window.location.hash;
    return isRouteHash(hash) ? parseHash(hash) : { name: 'overview' };
  });
  useEffect(() => {
    const onChange = () => {
      const hash = window.location.hash;
      // In-page anchors such as the skip link keep the current route.
      if (isRouteHash(hash)) setRoute(parseHash(hash));
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
