import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('boom');
}

describe('AppErrorBoundary', () => {
  it('shows a Slovak error message with a way back instead of a blank page', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Niečo sa pokazilo');
    expect(screen.getByRole('link', { name: 'Späť na prehľad mesiaca' })).toHaveAttribute(
      'href',
      '#/mesiac',
    );
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
