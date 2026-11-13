import { Vector3 } from 'three';
import { REST_HEAD, REST_TAIL, boneIndex, landmark, type BoneName, type Side } from './skeleton';
import {
  gripPoint,
  type BodyPose,
  type BodySolver,
  type BodyTargets,
  type FootTarget,
  type LegIK,
  type Vec,
} from './solver';

/**
 * Building blocks shared by the clips: clip/frame types, stances, balance
 * (centre of mass over the mid-foot) and contact bookkeeping for tests.
 */
export type PropKind =
  | 'barbell'
  | 'dumbbells'
  | 'dumbbell-right'
  | 'bench'
  | 'bench-rack'
  | 'incline-bench'
  | 'row-bench'
  | 'split-bench'
  | 'squat-rack'
  | 'pulldown'
  | 'cable-rope'
  | 'step'
  | 'treadmill'
  | 'bike'
  | 'mat';

/** A point that must touch a support surface at height `y` in this frame. */
export type Contact =
  | { kind: 'sole'; side: Side; y: number }
  | { kind: 'landmark'; name: Parameters<typeof landmark>[0]; y: number; radius?: number };

export interface BarState {
  /** Bar centre; with `frame`, rest coordinates carried by that bone. */
  center: Vec;
  frame?: BoneName;
}

export interface ClipFrame {
  targets: BodyTargets;
  /** Barbell / pulldown bar / rope centre. */
  bar?: BarState;
  /** Bike crank angle (radians). */
  crank?: number;
  /** Treadmill belt travel (metres). */
  belt?: number;
  /** Breathing 0 (exhaled) .. 1 (full breath). */
  breath: number;
  /** Fade for clips that travel and re-materialise at the start (0..1). */
  opacity?: number;
  contacts: Contact[];
}

export interface Clip {
  /** Loop length in seconds. */
  duration: number;
  props: PropKind[];
  /** Describes the body at `t` seconds; may pre-solve with `solver` for balance. */
  frame: (t: number, solver: BodySolver) => ClipFrame;
}

// ------------------------------------------------------------------ stance
export const SOLE: Contact[] = [
  { kind: 'sole', side: 'l', y: 0 },
  { kind: 'sole', side: 'r', y: 0 },
];

export function soles(y = 0, sides: Side[] = ['l', 'r']): Contact[] {
  return sides.map((side) => ({ kind: 'sole', side, y }));
}

/** Mirrors an x coordinate for the right side. */
export const sx = (s: Side, x: number): number => (s === 'l' ? x : -x);

/** Flat foot with the ball of the foot at (±x, y, z). */
export function flatFoot(s: Side, x: number, z: number, out = 0, y = 0): FootTarget {
  return { at: [sx(s, x), y, z], pivot: 'ball', pitch: 0, out };
}

/** Knee direction tracking the toes: forward, rotated outwards by `out` degrees. */
export function kneeOverToes(s: Side, out: number, down = 0): Vec {
  const a = (out * Math.PI) / 180;
  return [sx(s, Math.sin(a)), -down, Math.cos(a)];
}

export function plantedLeg(s: Side, x: number, z: number, out = 8, y = 0): LegIK {
  return { foot: flatFoot(s, x, z, out, y), knee: kneeOverToes(s, out) };
}

// --------------------------------------------------------- centre of mass
/** Segment mass fractions (Dempster/Winter), assigned to the skeleton bones. */
const MASS: Partial<Record<BoneName, number>> = {
  hips: 0.142,
  spine1: 0.1,
  spine2: 0.07,
  spine3: 0.08,
  chest: 0.105,
  neck: 0.0,
  head: 0.081,
  lUpperArm: 0.028,
  rUpperArm: 0.028,
  lForeArm: 0.016,
  rForeArm: 0.016,
  lHand: 0.006,
  rHand: 0.006,
  lThigh: 0.1,
  rThigh: 0.1,
  lShin: 0.0465,
  rShin: 0.0465,
  lFoot: 0.0145,
  rFoot: 0.0145,
};
const MASS_LIST = Object.entries(MASS).map(([name, m]) => {
  const i = boneIndex(name as BoneName);
  return { i, m: m!, half: REST_TAIL[i]!.clone().sub(REST_HEAD[i]!).multiplyScalar(0.5) };
});
const segment = new Vector3();
const comAcc = new Vector3();

export interface Load {
  /** Extra mass relative to body mass (e.g. 0.6 for a 48 kg bar on 80 kg). */
  mass: number;
  at: (pose: BodyPose, out: Vector3) => Vector3;
}

export function centerOfMass(pose: BodyPose, loads: readonly Load[] = [], out = new Vector3()) {
  comAcc.set(0, 0, 0);
  let total = 0;
  for (const { i, m, half } of MASS_LIST) {
    segment.copy(half).applyQuaternion(pose.rot[i]!).add(pose.pos[i]!);
    comAcc.addScaledVector(segment, m);
    total += m;
  }
  for (const l of loads) {
    comAcc.addScaledVector(l.at(pose, segment), l.mass);
    total += l.mass;
  }
  return out.copy(comAcc).divideScalar(total);
}

/** Load held in both hands (bar or a pair of dumbbells). */
export const handsLoad = (mass: number): Load => ({
  mass,
  at: (pose, out) =>
    gripPoint(pose, 'l', out)
      .add(gripPoint(pose, 'r', segment2))
      .multiplyScalar(0.5),
});
const segment2 = new Vector3();

export const handLoad = (s: Side, mass: number): Load => ({
  mass,
  at: (pose, out) => gripPoint(pose, s, out),
});

const com = new Vector3();
/**
 * Shifts the hips horizontally until the centre of mass (body + loads) is over
 * (x, z) - e.g. the mid-foot. Legs are IK so the feet stay planted.
 */
export function balance(
  solver: BodySolver,
  targets: BodyTargets,
  z: number,
  loads: readonly Load[] = [],
  x: number | null = null,
  /** Balance this point instead of the centre of mass (e.g. the bar). */
  point?: Load['at'],
): BodyTargets {
  // Work on a private copy of the hips position (clips may share the array).
  const pos: [number, number, number] = [...targets.hips.pos];
  targets.hips = { ...targets.hips, pos };
  for (let k = 0; k < 3; k++) {
    const pose = solver.solve(targets);
    if (point) point(pose, com);
    else centerOfMass(pose, loads, com);
    if (x !== null) pos[0] += x - com.x;
    pos[2] += z - com.z;
  }
  return targets;
}

/** Mid-point of the two shoulder joints in a solved pose. */
export function shoulders(pose: BodyPose, out = new Vector3()): Vector3 {
  return out
    .copy(pose.pos[boneIndex('lUpperArm')]!)
    .add(pose.pos[boneIndex('rUpperArm')]!)
    .multiplyScalar(0.5);
}

/** Simple bisection for monotonic f(x) = target on [lo, hi]. */
export function solveMonotonic(
  f: (x: number) => number,
  target: number,
  lo: number,
  hi: number,
  iterations = 18,
): number {
  let a = lo;
  let b = hi;
  const increasing = f(hi) > f(lo);
  for (let i = 0; i < iterations; i++) {
    const m = (a + b) / 2;
    if (f(m) < target === increasing) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** Breathing helper: smooth 0..1 cycle with the given period. */
export function breathing(t: number, period: number, phase = 0): number {
  return 0.5 - 0.5 * Math.cos(((t / period + phase) % 1) * 2 * Math.PI);
}
