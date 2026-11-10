import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useState } from 'react';
import type { AnimationId } from '../plan/types';
import { HologramController } from './controller';

export interface HologramStageProps {
  animation: AnimationId;
  playing: boolean;
  /** Disables flicker/scanline motion (prefers-reduced-motion). */
  reducedMotion: boolean;
  label: string;
}

function HologramScene({ animation, playing, reducedMotion }: Omit<HologramStageProps, 'label'>) {
  const [controller] = useState(() => new HologramController(animation));

  useEffect(() => controller.setAnimation(animation), [controller, animation]);
  useEffect(() => () => controller.dispose(), [controller]);

  useFrame((_, delta) => controller.update(delta, playing, reducedMotion));

  return (
    <>
      <primitive object={controller.rig.container} />
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
export default function HologramStage({ label, ...sceneProps }: HologramStageProps) {
  return (
    <Canvas
      className="hologram-canvas"
      camera={{ position: [3.0, 1.5, 2.4], fov: 40, near: 0.1, far: 50 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      role="img"
      aria-label={label}
    >
      <HologramScene {...sceneProps} />
      <OrbitControls
        target={[0, 0.8, 0]}
        enablePan={false}
        enableDamping
        minDistance={2}
        maxDistance={7}
        maxPolarAngle={Math.PI * 0.53}
      />
    </Canvas>
  );
}
