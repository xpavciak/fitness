import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AnimationId } from '../plan/types';
import { HologramController } from './controller';
import { HUMAN_MODEL_HASH } from './humanSkeleton';
import { OrbitCamera } from './orbitCamera';

/** Self-hosted CC0 human model (see docs/ASSETS.md); relative to the page. */
export const MODEL_URL = `${import.meta.env.BASE_URL}models/human.glb?v=${HUMAN_MODEL_HASH}`;

/** Degrees per press of the rotate buttons. */
export const ROTATE_STEP_DEGREES = 30;

export interface HologramStageProps {
  animation: AnimationId;
  playing: boolean;
  /** Disables flicker/scanline motion (prefers-reduced-motion). */
  reducedMotion: boolean;
  /** Signed count of rotate-button presses; each step turns the view 30°. */
  turns: number;
  label: string;
}

function CameraControls({ turns }: { turns: number }) {
  const camera = useThree((s) => s.camera);
  const domElement = useThree((s) => s.gl.domElement);
  const invalidate = useThree((s) => s.invalidate);
  const orbit = useRef<OrbitCamera | null>(null);
  const appliedTurns = useRef(0);

  // Create and dispose in the same effect so StrictMode's mount/unmount/mount
  // cycle in development ends with a live instance.
  useEffect(() => {
    const instance = new OrbitCamera(camera, domElement, () => invalidate());
    orbit.current = instance;
    return () => {
      instance.dispose();
      if (orbit.current === instance) orbit.current = null;
    };
  }, [camera, domElement, invalidate]);

  useEffect(() => {
    const delta = turns - appliedTurns.current;
    appliedTurns.current = turns;
    if (delta !== 0) orbit.current?.rotateBy(delta * ROTATE_STEP_DEGREES);
  }, [turns]);

  useFrame(() => orbit.current?.update());
  return null;
}

function HologramScene({
  animation,
  playing,
  reducedMotion,
}: Pick<HologramStageProps, 'animation' | 'playing' | 'reducedMotion'>) {
  // Suspends (outer <Suspense> shows the loading text) until the model is parsed.
  const gltf = useLoader(GLTFLoader, MODEL_URL);
  const [controller] = useState(() => new HologramController(animation, gltf.scene));
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => controller.setAnimation(animation), [controller, animation]);
  // The controller must exist during render (<primitive object>), so it lives in
  // state. dispose() only frees GPU buffers/programs; three re-uploads them on
  // the next render, so StrictMode's dev-only unmount/remount stays functional.
  useEffect(() => () => controller.dispose(), [controller]);
  // In 'demand' mode a frame is only drawn when requested.
  useEffect(() => invalidate(), [invalidate, animation, playing, reducedMotion]);

  useFrame((_, delta) => controller.update(delta, playing, reducedMotion));

  return (
    <>
      <primitive object={controller.root} />
      <mesh rotation-x={-Math.PI / 2} position-y={0.002} material={controller.discMaterial}>
        <circleGeometry args={[1.05, 64]} />
      </mesh>
      <mesh
        ref={(mesh) => controller.setRing(mesh)}
        rotation-x={-Math.PI / 2}
        position-y={0.004}
        material={controller.discMaterial}
      >
        <ringGeometry args={[1.12, 1.16, 64, 1, 0, Math.PI * 1.5]} />
      </mesh>
      <mesh position-y={1.1} material={controller.beamMaterial}>
        <cylinderGeometry args={[0.95, 1.05, 2.2, 48, 1, true]} />
      </mesh>
    </>
  );
}

/** 3D hologram canvas. Default export so it can be lazy-loaded. */
export default function HologramStage({ label, turns, ...sceneProps }: HologramStageProps) {
  return (
    <Canvas
      className="hologram-canvas"
      // Render continuously only while the animation plays; otherwise on demand
      // (camera moves, prop changes) to save battery.
      frameloop={sceneProps.playing ? 'always' : 'demand'}
      camera={{ position: [3.0, 1.5, 2.4], fov: 40, near: 0.1, far: 50 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      // Horizontal drag rotates; vertical swipes must keep scrolling the page.
      style={{ touchAction: 'pan-y' }}
      role="img"
      aria-label={label}
    >
      <HologramScene {...sceneProps} />
      <CameraControls turns={turns} />
    </Canvas>
  );
}
