import { Component, Suspense, lazy, type ReactNode } from 'react';
import { isModelLoadError, retryModelLoad } from '../hologram/modelError';
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
  /** Called when the 3D scene fails at runtime (e.g. context creation error), not for model loads. */
  onUnavailable: () => void;
}

type Failure = 'model' | 'runtime' | null;

class HologramErrorBoundary extends Component<
  {
    renderFallback: (failure: Exclude<Failure, null>, retry: () => void) => ReactNode;
    onUnavailable: () => void;
    children: ReactNode;
  },
  { failure: Failure }
> {
  state: { failure: Failure } = { failure: null };

  constructor(props: HologramErrorBoundary['props']) {
    super(props);
    // Opening another exercise tries a previously failed model download again.
    retryModelLoad();
  }

  static getDerivedStateFromError(error: unknown): { failure: Failure } {
    return { failure: isModelLoadError(error) ? 'model' : 'runtime' };
  }

  componentDidCatch(error: unknown) {
    console.error('Hologram failed to render', error);
    // A model that failed to download may load next time; only a broken 3D
    // context disables WebGL (and its controls) for the rest of the visit.
    if (!isModelLoadError(error)) this.props.onUnavailable();
  }

  private retry = () => {
    retryModelLoad();
    this.setState({ failure: null });
  };

  render() {
    const { failure } = this.state;
    return failure ? this.props.renderFallback(failure, this.retry) : this.props.children;
  }
}

function Fallback({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="hologram-fallback" role="status">
      <span className="hologram-fallback__figure" aria-hidden="true" />
      <p>{children}</p>
      {action}
    </div>
  );
}

const NO_WEBGL = (
  <Fallback>
    3D ukážka nie je dostupná, pretože prehliadač nepodporuje WebGL. Riaď sa popisom techniky.
  </Fallback>
);

function renderFailure(failure: 'model' | 'runtime', retry: () => void): ReactNode {
  if (failure === 'runtime') return NO_WEBGL;
  return (
    <Fallback
      action={
        <button type="button" className="button" onClick={retry}>
          Skúsiť znova
        </button>
      }
    >
      3D model postavy sa nepodarilo načítať. Riaď sa popisom techniky alebo to skús znova.
    </Fallback>
  );
}

export function Hologram({ webgl, onUnavailable, exerciseName, ...stage }: HologramProps) {
  if (!webgl) return NO_WEBGL;
  return (
    <HologramErrorBoundary renderFallback={renderFailure} onUnavailable={onUnavailable}>
      <Suspense fallback={<Fallback>Načítavam hologram…</Fallback>}>
        <HologramStage
          {...stage}
          label={`3D hologram predvádza cvik ${exerciseName}. Otáčať ho môžeš ťahaním alebo tlačidlami pod ním.`}
        />
      </Suspense>
    </HologramErrorBoundary>
  );
}
