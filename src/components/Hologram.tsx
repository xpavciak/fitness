import { Component, Suspense, lazy, type ReactNode } from 'react';
import type { AnimationId } from '../plan';

// three.js and the scene are only downloaded when an exercise is opened.
const HologramStage = lazy(() => import('../hologram/HologramStage'));

interface HologramProps {
  animation: AnimationId;
  playing: boolean;
  reducedMotion: boolean;
  turns: number;
  exerciseName: string;
  /** Result of WebGL detection (owned by the parent so it can hide controls). */
  webgl: boolean;
  /** Called when the 3D scene fails at runtime (e.g. context creation error). */
  onUnavailable: () => void;
}

class HologramErrorBoundary extends Component<
  { fallback: ReactNode; onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Hologram failed to render', error);
    this.props.onError();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Fallback({ children }: { children: ReactNode }) {
  return (
    <div className="hologram-fallback" role="status">
      <span className="hologram-fallback__figure" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

export function Hologram({ webgl, onUnavailable, exerciseName, ...stage }: HologramProps) {
  const noWebgl = (
    <Fallback>
      3D ukážka nie je dostupná – prehliadač nepodporuje WebGL alebo sa model nepodarilo načítať.
      Riaď sa popisom techniky.
    </Fallback>
  );
  if (!webgl) return noWebgl;
  return (
    <HologramErrorBoundary fallback={noWebgl} onError={onUnavailable}>
      <Suspense fallback={<Fallback>Načítavam hologram…</Fallback>}>
        <HologramStage
          {...stage}
          label={`3D hologram predvádza cvik ${exerciseName}. Otáčať ho môžeš ťahaním alebo tlačidlami pod ním.`}
        />
      </Suspense>
    </HologramErrorBoundary>
  );
}
