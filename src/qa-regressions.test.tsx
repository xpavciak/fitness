/**
 * QA regression tests for defects found during release verification.
 * These fail on claude/project-thread-4q93re @ 359b33d and should pass once fixed.
 */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { getExercise } from './plan';

function go(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '#/';
});

describe('QA: exercise lookup ignores Object.prototype keys', () => {
  it.each(['constructor', 'hasOwnProperty', 'toString', '__proto__'])(
    'getExercise(%s) is undefined',
    (id) => {
      expect(getExercise(id)).toBeUndefined();
    },
  );

  it('deep link #/den/<date>/cvik/constructor shows "Cvik sa nenašiel" instead of crashing', () => {
    window.location.hash = '#/den/2026-11-16/cvik/constructor';
    render(<App today="2026-11-10" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Cvik sa nenašiel' })).toBeVisible();
  });
});

describe('QA: skip link keeps the current route', () => {
  it('activating "Preskočiť na obsah" does not navigate to the 404 page', () => {
    window.location.hash = '#/den/2026-11-16';
    render(<App today="2026-11-10" />);
    const skip = screen.getByRole('link', { name: 'Preskočiť na obsah' });
    // Following the link's href is what a browser does on Enter/click.
    go(skip.getAttribute('href') ?? '');
    expect(screen.queryByRole('heading', { level: 1, name: 'Stránka sa nenašla' })).toBeNull();
  });
});
