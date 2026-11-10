import { isValidIsoDate } from './plan/dates';

/**
 * Hash-based routes so the static build works on any host without rewrites:
 *   #/                         today's workout (home screen)
 *   #/mesiac                   month overview
 *   #/den/2026-11-16           day detail
 *   #/den/2026-11-16/cvik/id   exercise detail within a day
 */
export type Route =
  | { name: 'today' }
  | { name: 'overview' }
  | { name: 'day'; date: string }
  | { name: 'exercise'; date: string; exerciseId: string }
  | { name: 'not-found'; path: string };

const EXERCISE_ID = /^[a-z0-9-]+$/;

/**
 * App routes always start with "#/". Other hashes (e.g. "#obsah") are in-page
 * anchors and must not change the route.
 */
export function isRouteHash(hash: string): boolean {
  return hash === '' || hash === '#' || hash.startsWith('#/');
}

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '') || '/';
  if (path === '/' || path === '') return { name: 'today' };
  if (path === '/mesiac') return { name: 'overview' };
  const parts = path.split('/').filter(Boolean).map(safeDecode);
  if (parts[0] === 'den' && parts[1] && isValidIsoDate(parts[1])) {
    if (parts.length === 2) return { name: 'day', date: parts[1] };
    if (parts.length === 4 && parts[2] === 'cvik' && parts[3] && EXERCISE_ID.test(parts[3])) {
      return { name: 'exercise', date: parts[1], exerciseId: parts[3] };
    }
  }
  return { name: 'not-found', path };
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // Malformed escape sequences are treated literally (and then fail validation).
    return segment;
  }
}

export const hrefs = {
  today: () => '#/',
  overview: () => '#/mesiac',
  day: (date: string) => `#/den/${date}`,
  exercise: (date: string, exerciseId: string) => `#/den/${date}/cvik/${exerciseId}`,
};
