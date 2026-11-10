import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { HologramStageProps } from '../hologram/HologramStage';

// Pretend WebGL exists and replace the three.js stage with a probe component.
vi.mock('../hologram/webgl', () => ({ isWebGLAvailable: () => true }));
vi.mock('../hologram/HologramStage', () => ({
  default: (props: HologramStageProps) => (
    <div
      data-testid="stage"
      data-playing={String(props.playing)}
      data-turns={props.turns}
      data-animation={props.animation}
    />
  ),
}));

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exercise view with WebGL', () => {
  it('toggles play/pause and rotates with the arrow buttons', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/den/2026-11-18/cvik/bench-press';
    render(<App today="2026-11-10" />);
    const stage = await screen.findByTestId('stage');
    expect(stage).toHaveAttribute('data-animation', 'bench-press');
    const button = screen.getByRole('button', { name: 'Pozastaviť animáciu' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await user.click(button);
    expect(screen.getByRole('button', { name: 'Prehrať animáciu' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(stage).toHaveAttribute('data-playing', 'false');

    await user.click(screen.getByRole('button', { name: 'Otočiť postavu doprava' }));
    await user.click(screen.getByRole('button', { name: 'Otočiť postavu doprava' }));
    await user.click(screen.getByRole('button', { name: 'Otočiť postavu doľava' }));
    expect(stage).toHaveAttribute('data-turns', '1');
    expect(screen.getByText('Ťahaním myšou alebo šípkami otočíš postavu.')).toBeVisible();
  });

  it('starts paused for reduced motion and uses touch wording on coarse pointers', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce') || query.includes('coarse'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    window.location.hash = '#/den/2026-11-16/cvik/back-squat';
    render(<App today="2026-11-10" />);
    expect(await screen.findByTestId('stage')).toHaveAttribute('data-playing', 'false');
    expect(screen.getByRole('button', { name: 'Prehrať animáciu' })).toBeVisible();
    expect(screen.getByText('Potiahnutím prstom do strany otočíš postavu.')).toBeVisible();
  });
});
