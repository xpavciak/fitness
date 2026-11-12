import type { Mesh, Object3D, ShaderMaterial } from 'three';
import type { AnimationId } from '../plan/types';
import type { ClipFrame } from './clipKit';
import { ClipCache } from './clipCache';
import { getClip } from './clips';
import {
  createBeamMaterial,
  createDepthMaterial,
  createDiscMaterial,
  createHoloMaterial,
} from './materials';
import { createProps, type Props } from './props';
import { applyPose, createRig, type Rig } from './rig';
import { boneIndex } from './skeleton';
import { BodySolver, createPose } from './solver';

const CYAN = '#38e8ff';
/** Clamp large frame gaps (e.g. after a background tab) to avoid jumps. */
const MAX_DELTA = 0.1;

/**
 * Owns the three.js objects of the hologram and advances the animation.
 * Kept outside React so per-frame mutation stays imperative.
 */
export class HologramController {
  readonly bodyMaterial: ShaderMaterial = createHoloMaterial(CYAN, {
    contours: true,
    chestBone: boneIndex('chest'),
    spineBone: boneIndex('spine3'),
  });
  readonly bodyDepthMaterial: ShaderMaterial = createDepthMaterial();
  readonly propMaterial: ShaderMaterial = createHoloMaterial('#9ffcff', { opacity: 0.55 });
  readonly propDepthMaterial: ShaderMaterial = createDepthMaterial();
  readonly discMaterial: ShaderMaterial = createDiscMaterial(CYAN);
  readonly beamMaterial: ShaderMaterial = createBeamMaterial(CYAN);
  readonly rig: Rig;
  readonly props: Props;
  readonly root: Object3D;

  private animationTime = 0;
  private effectsTime = 0;
  private ring: Mesh | null = null;
  private readonly solver = new BodySolver();
  private readonly pose = createPose();
  private cache: ClipCache;
  private readonly glowMaterials: readonly ShaderMaterial[] = [
    this.bodyMaterial,
    this.propMaterial,
  ];

  constructor(
    private animation: AnimationId,
    model: Object3D,
  ) {
    // The depth pass must deform exactly like the visible body (breathing).
    const u = this.bodyMaterial.uniforms;
    const d = this.bodyDepthMaterial.uniforms;
    d.uBreath = u.uBreath!;
    d.uChestBone = u.uChestBone!;
    d.uSpineBone = u.uSpineBone!;
    this.rig = createRig(model, this.bodyMaterial, this.bodyDepthMaterial);
    this.props = createProps(this.propMaterial, this.propDepthMaterial);
    this.rig.container.add(this.props.root);
    this.root = this.rig.container;
    this.cache = new ClipCache(getClip(animation));
  }

  setAnimation(id: AnimationId): void {
    if (id !== this.animation) {
      this.animation = id;
      this.animationTime = 0;
      this.cache = new ClipCache(getClip(id));
    }
  }

  setRing(ring: Mesh | null): void {
    this.ring = ring;
  }

  /**
   * Poses the figure and props at `time` (exposed for tests and debugging).
   * Poses come from the clip's sample cache; the returned frame is reused.
   */
  evaluate(time: number): ClipFrame {
    const frame = this.cache.evaluate(time, this.solver, this.pose);
    applyPose(this.rig, this.pose);
    this.props.update(this.cache.clip.props, frame, this.pose);
    return frame;
  }

  update(delta: number, playing: boolean, reducedMotion: boolean): void {
    const dt = Math.min(Math.max(delta, 0), MAX_DELTA);
    if (playing) this.animationTime += dt;
    if (!reducedMotion) this.effectsTime += dt;

    const frame = this.evaluate(this.animationTime);

    const t = this.effectsTime;
    const flicker = reducedMotion ? 1 : 0.92 + 0.08 * Math.sin(t * 31) * Math.sin(t * 7.3);
    for (const m of this.glowMaterials) {
      setUniform(m, 'uTime', t);
      setUniform(m, 'uFlicker', flicker);
      setUniform(m, 'uFade', frame.opacity ?? 1);
    }
    setUniform(this.bodyMaterial, 'uBreath', frame.breath);
    setUniform(this.discMaterial, 'uTime', t);
    if (this.ring) this.ring.rotation.z = t * 0.4;
  }

  dispose(): void {
    this.rig.dispose();
    this.props.dispose();
    [
      this.bodyMaterial,
      this.bodyDepthMaterial,
      this.propMaterial,
      this.propDepthMaterial,
      this.discMaterial,
      this.beamMaterial,
    ].forEach((m) => m.dispose());
  }
}

function setUniform(material: ShaderMaterial, name: string, value: number): void {
  const uniform = material.uniforms[name];
  if (!uniform) throw new Error(`Missing uniform ${name}`);
  uniform.value = value;
}
