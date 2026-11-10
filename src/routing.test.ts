import { describe, expect, it } from 'vitest';
import { hrefs, parseHash } from './routing';

describe('parseHash', () => {
  it('parses overview, day and exercise routes', () => {
    expect(parseHash('')).toEqual({ name: 'overview' });
    expect(parseHash('#/')).toEqual({ name: 'overview' });
    expect(parseHash('#/den/2026-11-16')).toEqual({ name: 'day', date: '2026-11-16' });
    expect(parseHash('#/den/2026-11-16/')).toEqual({ name: 'day', date: '2026-11-16' });
    expect(parseHash('#/den/2026-11-16/cvik/back-squat')).toEqual({
      name: 'exercise',
      date: '2026-11-16',
      exerciseId: 'back-squat',
    });
  });

  it('rejects malformed routes', () => {
    expect(parseHash('#/den/2026-13-01').name).toBe('not-found');
    expect(parseHash('#/den/2026-11-16/cvik/<script>').name).toBe('not-found');
    expect(parseHash('#/den/%E0%A4%A').name).toBe('not-found');
    expect(parseHash('#/nieco').name).toBe('not-found');
  });

  it('round-trips hrefs', () => {
    expect(parseHash(hrefs.exercise('2026-11-16', 'plank'))).toMatchObject({ name: 'exercise' });
    expect(parseHash(hrefs.day('2026-11-16'))).toMatchObject({ name: 'day' });
    expect(parseHash(hrefs.overview())).toEqual({ name: 'overview' });
  });
});
