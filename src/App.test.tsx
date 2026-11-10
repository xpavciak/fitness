import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { START_STORAGE_KEY } from './hooks/usePlan';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('overview', () => {
  it('shows 4 weeks × 7 days with types, legend and safety note', () => {
    render(<App today="2026-11-10" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Tvoj tréningový mesiac' })).toBeVisible();
    for (let w = 1; w <= 4; w++) {
      expect(
        screen.getByRole('heading', { level: 2, name: new RegExp(`Týždeň ${w}`) }),
      ).toBeVisible();
    }
    const dayLinks = screen.getAllByRole('link', {
      name: /(pondelok|utorok|streda|štvrtok|piatok|sobota|nedeľa) \d/,
    });
    expect(dayLinks).toHaveLength(28);
    expect(dayLinks[0]).toHaveAccessibleName(/pondelok 16\. 11\. 2026, Posilňovňa: Nohy/);
    expect(dayLinks[1]).toHaveAccessibleName(/Beh: Zóna 2/);
    expect(dayLinks[6]).toHaveAccessibleName(/nedeľa 22\. 11\. 2026, Odpočinok: Voľno/);
    const legend = screen.getByRole('list', { name: 'Legenda' });
    expect(within(legend).getByText('Posilňovňa')).toBeVisible();
    expect(within(legend).getByText('Beh')).toBeVisible();
    expect(within(legend).getByText('Odpočinok')).toBeVisible();
    expect(screen.getByText('Plán začína o 6 dní.')).toBeVisible();
    expect(
      screen.getByRole('complementary', { name: 'Bezpečnostné upozornenie' }),
    ).toHaveTextContent(/nie lekárska rada/);
  });

  it('persists the start date and highlights today during the plan', () => {
    window.localStorage.setItem(START_STORAGE_KEY, '2026-11-16');
    render(<App today="2026-11-25" />);
    const today = screen.getByRole('link', { current: 'date' });
    expect(today).toHaveAccessibleName(/streda 25\. 11\. 2026, dnes, Posilňovňa: Tlak/);
    expect(screen.getByText('Prebieha 2. týždeň plánu.')).toBeVisible();
    expect(window.localStorage.getItem(START_STORAGE_KEY)).toBe('2026-11-16');
  });

  it('still works when storage is unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<App today="2026-11-10" />);
    expect(screen.getAllByRole('link', { name: /Posilňovňa/ })).toHaveLength(12);
    expect(warn).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('navigation', () => {
  it('goes overview → gym day → exercise and back', async () => {
    const user = userEvent.setup();
    render(<App today="2026-11-10" />);

    await user.click(screen.getByRole('link', { name: /pondelok 16\. 11\. 2026/ }));
    const dayHeading = await screen.findByRole('heading', { level: 1, name: /^Nohy/ });
    expect(dayHeading).toHaveFocus();
    expect(window.location.hash).toBe('#/den/2026-11-16');
    for (const title of ['Rozcvička', 'Hlavná časť', 'Upokojenie']) {
      expect(screen.getByRole('heading', { level: 2, name: new RegExp(title) })).toBeVisible();
    }
    expect(screen.getByText(/Odhad: ≈ \d+ min/)).toBeVisible();
    expect(screen.getByLabelText('4 série po 6–8')).toBeVisible();

    await user.click(screen.getByRole('link', { name: 'Drep s veľkou činkou' }));
    const exHeading = await screen.findByRole('heading', {
      level: 1,
      name: 'Drep s veľkou činkou',
    });
    expect(exHeading).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Technika krok za krokom' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Časté chyby' })).toBeVisible();
    expect(screen.getByText('Ľahšia')).toBeVisible();
    expect(screen.getByText('Predné stehná (kvadriceps)')).toBeVisible();
    // jsdom has no WebGL, so the accessible fallback is shown instead of the canvas.
    expect(screen.getByRole('status')).toHaveTextContent(/nepodporuje WebGL/);
    const prescription = screen.getByLabelText('Predpis na dnes');
    expect(prescription).toHaveTextContent('4 × 6–8');
    expect(prescription).toHaveTextContent('150 s');

    await user.click(screen.getByRole('link', { name: /pondelok 16\. 11\. 2026 – Nohy/ }));
    expect(await screen.findByRole('heading', { level: 1, name: /^Nohy/ })).toBeVisible();
  });

  it('toggles play/pause on the exercise view', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/den/2026-11-18/cvik/bench-press';
    render(<App today="2026-11-10" />);
    const button = screen.getByRole('button', { name: 'Pozastaviť animáciu' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await user.click(button);
    expect(screen.getByRole('button', { name: 'Prehrať animáciu' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('starts paused when the user prefers reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    window.location.hash = '#/den/2026-11-16/cvik/back-squat';
    render(<App today="2026-11-10" />);
    expect(screen.getByRole('button', { name: 'Prehrať animáciu' })).toBeVisible();
  });

  it('shows cardio guidance and a rest day', () => {
    window.location.hash = '#/den/2026-11-21';
    render(<App today="2026-11-10" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Beh – intervaly' })).toBeVisible();
    expect(screen.getAllByText(/HRmax/).length).toBeGreaterThan(0);
    go('#/den/2026-11-22');
    expect(screen.getByRole('heading', { level: 1, name: 'Odpočinok' })).toBeVisible();
    expect(screen.getByText('Dnes žiadny tréning. Oddychuj a regeneruj.')).toBeVisible();
  });

  it('handles unknown routes, days outside the plan and unknown exercises', () => {
    window.location.hash = '#/neexistuje';
    render(<App today="2026-11-10" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Stránka sa nenašla' })).toBeVisible();
    go('#/den/2025-01-06');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Tento deň nie je v aktuálnom pláne' }),
    ).toBeVisible();
    go('#/den/2026-11-16/cvik/neznamy-cvik');
    expect(screen.getByRole('heading', { level: 1, name: 'Cvik sa nenašiel' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Späť na prehľad mesiaca' })).toHaveAttribute(
      'href',
      '#/',
    );
  });
});
