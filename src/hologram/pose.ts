/**
 * Framework-free pose model for the hologram figure.
 *
 * Limbs are posed by *direction* rather than by joint Euler angles, which keeps
 * keyframes readable:
 *   - pitch (P): angle in the sagittal plane, 0 = pointing down, 90 = forward,
 *     180 = up, negative = backwards.
 *   - side (S): angle out of the sagittal plane, positive = away from the body.
 * Arm directions are expressed in the chest frame, leg directions in the pelvis
 * (root) frame. Foot pitch 0 = flat, positive = toes down.
 * All angles are in degrees; missing channels default to 0.
 */

export const CHANNELS = [
  'rootX',
  'rootY',
  'rootZ',
  'rootP',
  'rootYaw',
  'spineP',
  'spineT',
  'spineS',
  'chestP',
  'neckP',
  'lArmP',
  'lArmS',
  'lForeP',
  'lForeS',
  'rArmP',
  'rArmS',
  'rForeP',
  'rForeS',
  'lThighP',
  'lThighS',
  'lShinP',
  'lShinS',
  'lFootP',
  'rThighP',
  'rThighS',
  'rShinP',
  'rShinS',
  'rFootP',
] as const;

export type Channel = (typeof CHANNELS)[number];
export type Pose = Partial<Record<Channel, number>>;
export type FullPose = Record<Channel, number>;

export interface Keyframe {
  /** Normalised time in [0, 1]. */
  t: number;
  pose: Pose;
}

export type PropKind = 'barbell' | 'dumbbells' | 'bench' | 'seat';

export interface Clip {
  /** Loop length in seconds. */
  duration: number;
  keyframes: Keyframe[];
  /** Lift/lower the body so its lowest point touches the floor. */
  grounded: boolean;
  /**
   * Keep the ankles at this world z (hips move instead), or null to let the
   * feet move freely (gait cycles). Horizontal exercises use a negative value
   * so the whole body is centred over the projector disc.
   */
  pinFeetZ: number | null;
  props: PropKind[];
}

export function fullPose(pose: Pose): FullPose {
  const out = {} as FullPose;
  for (const c of CHANNELS) out[c] = pose[c] ?? 0;
  return out;
}

/** Smooth ease-in-out so movements accelerate and decelerate naturally. */
export function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Wrap any time value into [0, 1). */
export function wrapPhase(phase: number): number {
  return ((phase % 1) + 1) % 1;
}

/**
 * Samples a clip at a normalised phase. Keyframes must be sorted and should
 * start at t = 0; the clip loops from the last keyframe back to the first.
 */
export function samplePose(clip: Clip, phase: number): FullPose {
  const frames = clip.keyframes;
  const first = frames[0];
  if (!first) throw new Error('Clip has no keyframes');
  const p = wrapPhase(phase);

  let prev = first;
  let next = first;
  let span = 1;
  let local = 0;
  for (let i = 0; i < frames.length; i++) {
    const a = frames[i]!;
    const b = frames[i + 1];
    if (b === undefined) {
      // Last segment loops back to the first keyframe.
      prev = a;
      next = first;
      span = 1 - a.t + first.t;
      local = p >= a.t ? p - a.t : p + 1 - a.t;
      break;
    }
    if (p >= a.t && p < b.t) {
      prev = a;
      next = b;
      span = b.t - a.t;
      local = p - a.t;
      break;
    }
  }
  const k = span > 0 ? smoothstep(local / span) : 0;
  const from = fullPose(prev.pose);
  const to = fullPose(next.pose);
  const out = {} as FullPose;
  for (const c of CHANNELS) out[c] = from[c] + (to[c] - from[c]) * k;
  return out;
}

const DEG = Math.PI / 180;

/**
 * Unit direction vector for a limb, in its parent frame.
 * `sideSign` is +1 for the left limb (+x) and -1 for the right limb.
 */
export function limbDirection(
  pitchDeg: number,
  sideDeg: number,
  sideSign: 1 | -1,
): [number, number, number] {
  const p = pitchDeg * DEG;
  const s = sideDeg * DEG;
  return [sideSign * Math.sin(s), -Math.cos(s) * Math.cos(p), Math.cos(s) * Math.sin(p)];
}
