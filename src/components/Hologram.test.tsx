import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hologram } from './Hologram';

// The stage fails the way the real one does when the model download fails,
// until `modelAvailable` flips.
const state = vi.hoisted(() => ({ modelAvailable: false, contextLost: false }));
vi.mock('../hologram/HologramStage', async () => {
  const { ModelLoadError: LoadError } = await import('../hologram/modelError');
  return {
    default: () => {
      if (state.contextLost) throw new Error('WebGL context could not be created');
      if (!state.modelAvailable) throw new LoadError('Human model request failed: HTTP 503');
      return <div data-testid="stage" />;
    },
  };
});

const props = {
  animation: 'squat' as const,
  playing: true,
  reducedMotion: false,
  turns: 0,
  exerciseName: 'Drep',
  webgl: true,
};

afterEach(() => {
  state.modelAvailable = false;
  state.contextLost = false;
  vi.restoreAllMocks();
});

describe('Hologram failures', () => {
  it('offers a retry after a model load failure and keeps WebGL enabled', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onUnavailable = vi.fn();
    const user = userEvent.setup();
    render(<Hologram {...props} onUnavailable={onUnavailable} />);
    await screen.findByText(/model postavy sa nepodarilo/);
    expect(screen.getByRole('status')).not.toHaveTextContent(/WebGL/);
    expect(onUnavailable).not.toHaveBeenCalled();

    state.modelAvailable = true;
    await user.click(screen.getByRole('button', { name: 'Skúsiť znova' }));
    expect(await screen.findByTestId('stage')).toBeInTheDocument();
  });

  it('reports a broken 3D context as unavailable WebGL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onUnavailable = vi.fn();
    state.contextLost = true;
    render(<Hologram {...props} onUnavailable={onUnavailable} />);
    await screen.findByText(/nepodporuje WebGL/);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Skúsiť znova' })).toBeNull();
  });
});
