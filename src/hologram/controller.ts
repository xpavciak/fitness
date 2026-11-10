import type { Mesh, ShaderMaterial } from 'three';
import type { AnimationId } from '../plan/types';
import { getClip } from './clips';
import { createBeamMaterial, createDiscMaterial, createHoloMaterial } from './materials';
import { fullPose, samplePose } from './pose';
import { applyPose, createRig, type Rig } from './rig';

const CYAN = '#38e8ff';
/** Clamp large frame gaps (e.g. after a background tab) to avoid jumps. */
const MAX_DELTA = 0.1;

/**
 * Owns the three.js objects of the hologram and advances the animation.
 * Kept outside React so per-frame mutation stays imperative.
 */
export class HologramController {
  readonly bodyMaterial: ShaderMaterial = createHoloMaterial(CYAN);
  readonly propMaterial: ShaderMaterial = createHoloMaterial('#9ffcff', 0.7);
  readonly discMaterial: ShaderMaterial = createDiscMaterial(CYAN);
  readonly beamMaterial: ShaderMaterial = createBeamMaterial(CYAN);
  readonly rig: Rig = createRig(this.bodyMaterial, this.propMaterial);

  private animationTime = 0;
  private effectsTime = 0;
  private ring: Mesh | null = null;
  /** Reused every frame to avoid per-frame allocations. */
  private readonly pose = fullPose({});
  private readonly glowMaterials: readonly ShaderMaterial[] = [
    this.bodyMaterial,
    this.propMaterial,
  ];

  constructor(private animation: AnimationId) {}

  setAnimation(id: AnimationId): void {
    if (id !== this.animation) {
      this.animation = id;
      this.animationTime = 0;
    }
  }

  setRing(ring: Mesh | null): void {
    this.ring = ring;
  }

  update(delta: number, playing: boolean, reducedMotion: boolean): void {
    const dt = Math.min(Math.max(delta, 0), MAX_DELTA);
    if (playing) this.animationTime += dt;
    if (!reducedMotion) this.effectsTime += dt;

    const clip = getClip(this.animation);
    applyPose(this.rig, samplePose(clip, this.animationTime / clip.duration, this.pose), clip);

    const t = this.effectsTime;
    const flicker = reducedMotion ? 1 : 0.9 + 0.1 * Math.sin(t * 31) * Math.sin(t * 7.3);
    for (const m of this.glowMaterials) {
      setUniform(m, 'uTime', t);
      setUniform(m, 'uFlicker', flicker);
    }
    setUniform(this.discMaterial, 'uTime', t);
    if (this.ring) this.ring.rotation.z = t * 0.4;
  }

  dispose(): void {
    this.rig.dispose();
    [this.bodyMaterial, this.propMaterial, this.discMaterial, this.beamMaterial].forEach((m) =>
      m.dispose(),
    );
  }
}

function setUniform(material: ShaderMaterial, name: string, value: number): void {
  const uniform = material.uniforms[name];
  if (!uniform) throw new Error(`Missing uniform ${name}`);
  uniform.value = value;
}
