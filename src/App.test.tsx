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

  it('lets the user start this week (past days marked) or next Monday', async () => {
    const user = userEvent.setup();
    render(<App today="2026-11-11" />);
    const thisWeek = screen.getByRole('button', { name: /Začať tento týždeň/ });
    const nextWeek = screen.getByRole('button', { name: /Začať budúci pondelok/ });
    expect(nextWeek).toHaveAttribute('aria-pressed', 'true');
    expect(thisWeek).toHaveAttribute('aria-pressed', 'false');

    await user.click(thisWeek);
    expect(thisWeek).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(START_STORAGE_KEY)).toBe('2026-11-09');
    expect(
      screen.getByRole('link', { name: /pondelok 9\. 11\. 2026, uplynulý deň/ }),
    ).toBeVisible();
    expect(screen.getByRole('link', { current: 'date' })).toHaveAccessibleName(
      /streda 11\. 11\. 2026, dnes/,
    );
    expect(screen.getByText('Prebieha 1. týždeň plánu.')).toBeVisible();

    // The plan is now in progress, so switching asks for confirmation first.
    await user.click(nextWeek);
    expect(window.localStorage.getItem(START_STORAGE_KEY)).toBe('2026-11-09');
    const confirm = screen.getByRole('group', { name: /Naozaj začať odznova\?/ });
    expect(within(confirm).getByRole('button', { name: 'Zrušiť' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Áno, začať odznova' }));
    expect(window.localStorage.getItem(START_STORAGE_KEY)).toBe('2026-11-16');
    expect(screen.queryByRole('group', { name: /Naozaj začať odznova\?/ })).toBeNull();
    expect(screen.queryByRole('link', { current: 'date' })).toBeNull();
  });

  it('cancelling the restart keeps the running plan', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(START_STORAGE_KEY, '2026-11-02');
    render(<App today="2026-11-11" />);
    expect(screen.getByText('Prebieha 2. týždeň plánu.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Začať tento týždeň/ }));
    await user.click(screen.getByRole('button', { name: 'Zrušiť' }));
    expect(window.localStorage.getItem(START_STORAGE_KEY)).toBe('2026-11-02');
    expect(screen.getByText('Prebieha 2. týždeň plánu.')).toBeVisible();
  });

  it('returns focus to the opening button when the confirmation closes', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(START_STORAGE_KEY, '2026-11-02');
    render(<App today="2026-11-11" />);
    const thisWeek = screen.getByRole('button', { name: /Začať tento týždeň/ });
    const nextWeek = screen.getByRole('button', { name: /Začať budúci pondelok/ });
    const confirm = () => screen.queryByRole('group', { name: /Naozaj začať odznova\?/ });

    await user.click(thisWeek);
    await user.click(screen.getByRole('button', { name: 'Zrušiť' }));
    expect(confirm()).toBeNull();
    expect(thisWeek).toHaveFocus();

    await user.click(nextWeek);
    expect(screen.getByRole('button', { name: 'Zrušiť' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(confirm()).toBeNull();
    expect(nextWeek).toHaveFocus();
    expect(window.localStorage.getItem(START_STORAGE_KEY)).toBe('2026-11-02');

    await user.click(thisWeek);
    await user.click(screen.getByRole('button', { name: 'Áno, začať odznova' }));
    expect(window.localStorage.getItem(START_STORAGE_KEY)).toBe('2026-11-09');
    expect(screen.getByRole('button', { name: /Začať tento týždeň/ })).toHaveFocus();
  });

  it('closes the confirmation if the plan stops running while it is open', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(START_STORAGE_KEY, '2026-11-02');
    const { rerender } = render(<App today="2026-11-29" />);
    const thisWeek = screen.getByRole('button', { name: /Začať tento týždeň/ });
    await user.click(thisWeek);
    expect(screen.getByRole('group', { name: /Naozaj/ })).toBeVisible();
    // Midnight: the plan (2. 11. – 29. 11.) has ended.
    rerender(<App today="2026-11-30" />);
    expect(screen.queryByRole('group', { name: /Naozaj/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Plán skončil – začni nový' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Začať tento týždeň/ })).toHaveFocus();
  });

  it('does not ask for confirmation before an upcoming plan starts', async () => {
    const user = userEvent.setup();
    render(<App today="2026-11-11" />);
    await user.click(screen.getByRole('button', { name: /Začať tento týždeň/ }));
    expect(screen.queryByRole('group', { name: /Naozaj/ })).toBeNull();
    expect(window.localStorage.getItem(START_STORAGE_KEY)).toBe('2026-11-09');
  });

  it('offers a restart after the plan has ended', () => {
    window.localStorage.setItem(START_STORAGE_KEY, '2026-11-16');
    render(<App today="2026-12-15" />);
    expect(screen.getByRole('heading', { name: 'Plán skončil – začni nový' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: /Začať tento týždeň \(po 14\. 12\.\)/ }),
    ).toBeVisible();
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

describe('plan start stability with a live clock', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function liveClockScenario() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // First visit on Monday evening: the default plan starts today.
    vi.setSystemTime(new Date(2026, 10, 16, 23, 59, 50));
    render(<App />);
    const range = /pondelok 16\. 11\. 2026 – nedeľa 13\. 12\. 2026/;
    expect(screen.getByText(range)).toBeVisible();
    // Midnight passes in the open tab.
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByText(range)).toBeVisible();
    expect(screen.getByRole('link', { current: 'date' })).toHaveAccessibleName(/utorok 17\. 11\./);
    // The tab sleeps for days and becomes visible again.
    act(() => {
      vi.setSystemTime(new Date(2026, 10, 19, 9, 0, 0));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByText(range)).toBeVisible();
    expect(screen.getByRole('link', { current: 'date' })).toHaveAccessibleName(/štvrtok 19\. 11\./);
  }

  it('keeps a first-visit plan across midnight and visibilitychange', () => {
    liveClockScenario();
    expect(window.localStorage.getItem(START_STORAGE_KEY)).toBe('2026-11-16');
  });

  it('keeps it in memory when storage is blocked', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    liveClockScenario();
  });
});

describe('skip link', () => {
  it('moves focus to the main content without changing the route', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/den/2026-11-16';
    render(<App today="2026-11-10" />);
    await user.click(screen.getByRole('link', { name: 'Preskočiť na obsah' }));
    expect(screen.getByRole('main')).toHaveFocus();
    expect(window.location.hash).toBe('#/den/2026-11-16');
    expect(screen.getByRole('heading', { level: 1, name: /^Nohy/ })).toBeVisible();
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
    // Without WebGL the 3D controls and drag hint are hidden.
    expect(screen.queryByRole('button', { name: /animáciu/ })).toBeNull();
    expect(screen.queryByText(/otočíš postavu/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Bezpečnosť' })).toBeVisible();
    expect(screen.getByText(/bezpečnostnými tyčami/)).toBeVisible();
    const prescription = screen.getByLabelText('Predpis na dnes');
    expect(prescription).toHaveTextContent('4 × 6–8');
    expect(prescription).toHaveTextContent('150 s');

    await user.click(screen.getByRole('link', { name: /pondelok 16\. 11\. 2026 – Nohy/ }));
    expect(await screen.findByRole('heading', { level: 1, name: /^Nohy/ })).toBeVisible();
  });

  it('shows cardio guidance and a rest day', () => {
    window.location.hash = '#/den/2026-11-21';
    render(<App today="2026-11-10" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Beh – intervaly' })).toBeVisible();
    expect(screen.getAllByText(/HRmax/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Rotoped (alternatíva k behu)' })).toHaveLength(1);
    go('#/den/2026-11-22');
    expect(screen.getByRole('heading', { level: 1, name: 'Odpočinok' })).toBeVisible();
    expect(screen.getByText('Dnes žiadny tréning. Oddychuj a regeneruj.')).toBeVisible();
  });

  it('explains when a deep-linked exercise is not planned for that day', () => {
    window.location.hash = '#/den/2026-11-17/cvik/back-squat';
    render(<App today="2026-11-10" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Drep s veľkou činkou' })).toBeVisible();
    const notice = screen.getByRole('note');
    expect(notice).toHaveTextContent('Tento cvik nie je v pláne na tento deň');
    expect(within(notice).getByRole('link', { name: 'Zobraziť tréning dňa' })).toHaveAttribute(
      'href',
      '#/den/2026-11-17',
    );
    expect(screen.queryByLabelText('Predpis na dnes')).toBeNull();
    const crumbs = screen.getByRole('navigation', { name: 'Navigácia' });
    expect(within(crumbs).getAllByRole('link')).toHaveLength(1);

    go('#/den/2025-01-06/cvik/back-squat');
    expect(screen.getByRole('note')).toHaveTextContent('Tento deň nie je v aktuálnom pláne');
  });

  it('shows the carry distance instead of a tempo', () => {
    window.location.hash = '#/den/2026-11-20';
    render(<App today="2026-11-10" />);
    expect(screen.getByText('30 m (≈ 30 s)')).toBeVisible();
    expect(screen.queryByText('výdrž')).toBeNull();
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
