import { Component, Suspense, lazy, useState, type ReactNode } from 'react';
import type { AnimationId } from '../plan';
import { isWebGLAvailable } from '../hologram/webgl';

// three.js and the scene are only downloaded when an exercise is opened.
const HologramStage = lazy(() => import('../hologram/HologramStage'));

interface HologramProps {
  animation: AnimationId;
  playing: boolean;
  reducedMotion: boolean;
  exerciseName: string;
}

class HologramErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Hologram failed to render', error);
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

export function Hologram({ animation, playing, reducedMotion, exerciseName }: HologramProps) {
  const [webgl] = useState(isWebGLAvailable);
  const noWebgl = (
    <Fallback>
      3D ukážka nie je dostupná, pretože prehliadač nepodporuje WebGL. Riaď sa popisom techniky.
    </Fallback>
  );
  if (!webgl) return noWebgl;
  return (
    <HologramErrorBoundary fallback={noWebgl}>
      <Suspense fallback={<Fallback>Načítavam hologram…</Fallback>}>
        <HologramStage
          animation={animation}
          playing={playing}
          reducedMotion={reducedMotion}
          label={`3D hologram predvádza cvik ${exerciseName}. Ťahaním myšou alebo prstom ho otočíš.`}
        />
      </Suspense>
    </HologramErrorBoundary>
  );
}
