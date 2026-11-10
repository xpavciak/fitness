import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { START_STORAGE_KEY, SWAPS_STORAGE_KEY } from './hooks/usePlan';

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

describe('home screen', () => {
  it("shows only today's workout with a link to the whole month", () => {
    window.localStorage.setItem(START_STORAGE_KEY, '2026-11-16');
    render(<App today="2026-11-18" />);
    expect(screen.getByRole('heading', { level: 1, name: /^Tlak/ })).toHaveFocus();
    expect(document.title).toMatch(/^Dnes/);
    expect(screen.getByText(/^Dnes · streda 18\. 11\. 2026/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Tlak na rovnej lavici' })).toBeVisible();
    // No month calendar on the home screen.
    expect(screen.queryByRole('heading', { name: /Týždeň 2 · / })).toBeNull();

    const nav = screen.getByRole('navigation', { name: 'Hlavná navigácia' });
    expect(within(nav).getByRole('link', { name: 'Dnes' })).toHaveAttribute('aria-current', 'page');
    const month = screen.getAllByRole('link', { name: 'Celý mesiac' });
    expect(month.length).toBe(2);
    for (const link of month) expect(link).toHaveAttribute('href', '#/mesiac');

    go('#/mesiac');
    expect(screen.getByRole('heading', { level: 1, name: 'Tvoj tréningový mesiac' })).toBeVisible();
    expect(within(nav).getByRole('link', { name: 'Celý mesiac' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('explains when the plan has not started yet and offers the start choice', () => {
    render(<App today="2026-11-10" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Plán ešte nezačal' })).toBeVisible();
    expect(screen.getByText('Plán začína o 6 dní.')).toBeVisible();
    expect(screen.getByRole('link', { name: /Pozrieť prvý tréning/ })).toHaveAttribute(
      'href',
      '#/den/2026-11-16',
    );
    expect(screen.getByRole('button', { name: /Začať tento týždeň/ })).toBeVisible();
  });

  it('shows rest days on the home screen too', () => {
    window.localStorage.setItem(START_STORAGE_KEY, '2026-11-16');
    render(<App today="2026-11-22" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Odpočinok' })).toBeVisible();
  });
});

describe('replacing an exercise', () => {
  it('removes a disliked exercise, puts the alternative in every day and can undo it', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(START_STORAGE_KEY, '2026-11-16');
    render(<App today="2026-11-18" />);

    const bench = screen.getByRole('link', { name: 'Tlak na rovnej lavici' }).closest('li')!;
    const toggle = within(bench).getByRole('button', { name: 'Zmazať a nahradiť' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = within(bench).getByRole('group', { name: 'Náhrada cviku' });
    // Incline press and push-ups are already part of push day.
    const choices = within(panel).getAllByRole('button');
    expect(choices.map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^Tlak s jednoručkami na rovnej lavici/),
    ]);
    expect(choices[0]).toHaveFocus();
    await user.click(choices[0]!);

    expect(screen.queryByRole('link', { name: 'Tlak na rovnej lavici' })).toBeNull();
    const swapped = screen
      .getByRole('link', { name: 'Tlak s jednoručkami na rovnej lavici' })
      .closest('li')!;
    expect(within(swapped).getByText(/Namiesto cviku/)).toHaveTextContent(
      'Namiesto cviku Tlak na rovnej lavici.',
    );
    expect(within(swapped).getByRole('button', { name: 'Zmazať a nahradiť' })).toHaveFocus();
    expect(JSON.parse(window.localStorage.getItem(SWAPS_STORAGE_KEY)!)).toEqual({
      'bench-press': 'dumbbell-bench-press',
    });

    // Applies to the other push days as well.
    go('#/den/2026-12-02');
    expect(
      screen.getByRole('link', { name: 'Tlak s jednoručkami na rovnej lavici' }),
    ).toBeVisible();

    // Restore the original.
    const row = screen
      .getByRole('link', { name: 'Tlak s jednoručkami na rovnej lavici' })
      .closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Zmazať a nahradiť' }));
    await user.click(within(row).getByRole('button', { name: /Vrátiť pôvodný/ }));
    expect(screen.getByRole('link', { name: 'Tlak na rovnej lavici' })).toBeVisible();
    expect(JSON.parse(window.localStorage.getItem(SWAPS_STORAGE_KEY)!)).toEqual({});
  });

  it('closes the choice with Escape and keeps swaps after a reload', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(START_STORAGE_KEY, '2026-11-16');
    window.localStorage.setItem(SWAPS_STORAGE_KEY, '{"dumbbell-curl":"hammer-curl","x":"y"}');
    window.location.hash = '#/den/2026-11-20';
    render(<App today="2026-11-18" />);
    expect(screen.getByRole('link', { name: 'Kladivový bicepsový zdvih' })).toBeVisible();

    const row = screen.getByRole('link', { name: 'Farmárska chôdza' }).closest('li')!;
    const toggle = within(row).getByRole('button', { name: 'Zmazať a nahradiť' });
    await user.click(toggle);
    await user.keyboard('{Escape}');
    expect(within(row).queryByRole('group')).toBeNull();
    expect(toggle).toHaveFocus();
  });

  it('does not offer replacements for warm-up items or cardio days', () => {
    window.localStorage.setItem(START_STORAGE_KEY, '2026-11-16');
    window.location.hash = '#/den/2026-11-17';
    render(<App today="2026-11-18" />);
    expect(screen.queryByRole('button', { name: 'Zmazať a nahradiť' })).toBeNull();
    go('#/den/2026-11-16');
    // 5 main exercises on leg day, none in the warm-up.
    expect(screen.getAllByRole('button', { name: 'Zmazať a nahradiť' })).toHaveLength(5);
  });
});
