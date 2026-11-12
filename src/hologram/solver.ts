import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import {
  BONE_COUNT,
  FOOT,
  HAND,
  LIMB,
  PARENT,
  REST_HEAD,
  REST_TAIL,
  boneIndex,
  type BodyPoint,
  type BoneName,
  type Side,
} from './skeleton';

/**
 * Full-body pose solver (framework-free apart from three's math classes).
 *
 * Clips describe *what the body should do* - hip placement, spine flexion,
 * where the hands grip and where the feet stand - and the solver turns that
 * into world rotations for every bone using forward kinematics for the trunk
 * and analytic two-bone IK for arms and legs. Hands and feet therefore land
 * exactly on their targets (bar, handles, floor) whenever they are reachable.
 *
 * Conventions: metres, y up, the body faces +z in its rest pose, angles in
 * degrees. Pitch + = forward flexion (top towards +z), side + = lean to the
 * figure's left (+x), twist/yaw + = turn towards the figure's left.
 */
export type Vec = readonly [number, number, number];
/** Limb direction: [pitch, side] in the parent frame (see limbDirection). */
export type Dir2 = readonly [pitch: number, side: number];

export interface HipsTarget {
  pos: Vec;
  /** Pelvis tilt, + = hinge forward. */
  pitch?: number;
  yaw?: number;
  roll?: number;
}

export interface Bend {
  pitch?: number;
  side?: number;
  twist?: number;
}

export interface FootTarget {
  /** World position of the pivot point (for ball/heel/toe: on the sole). */
  at: Vec;
  pivot?: 'ball' | 'heel' | 'toe' | 'ankle';
  /** Foot pitch, + = toes down / heel up. */
  pitch?: number;
  /** Toe-out angle (mirrored per side). */
  out?: number;
  /** Toe extension relative to the foot; by default toes stay flat on the floor. */
  toes?: number;
}

export interface LegIK {
  foot: FootTarget;
  /** World direction the knee points to. */
  knee: Vec;
}

export interface LegFK {
  /** Directions in the hips frame. */
  fk: { thigh: Dir2; shin: Dir2; foot?: number; toes?: number };
}

export type LegTarget = LegIK | LegFK;

export interface ArmIK {
  /** Target for the bar axis inside the fist (or the palm skin with `point: 'palm'`). */
  grip: Vec;
  /** When set, grip/elbow/across/hand/palm are rest coordinates carried by this bone. */
  frame?: BoneName;
  point?: 'grip' | 'palm' | 'wrist';
  /** World direction the elbow points to. */
  elbow: Vec;
  /** Bar axis through the fist, index -> little finger. */
  across?: Vec;
  /** Direction the palm faces (used when `across` is not given). */
  palm?: Vec;
  /** Wrist -> knuckles direction; defaults to a neutral wrist (forearm line). */
  hand?: Vec;
  /** Extra wrist extension when `hand` is not given. */
  wrist?: number;
  /** Finger flexion 0 (open) .. 1 (closed fist). */
  fingers?: number;
}

export interface ArmFK {
  /** Directions in the chest frame. */
  fk: { upper: Dir2; fore: Dir2 };
  /** World direction the palm faces. */
  palm?: Vec;
  fingers?: number;
}

export type ArmTarget = ArmIK | ArmFK;

export interface BodyTargets {
  hips: HipsTarget;
  /** Distributed over the four spine bones. */
  spine?: Bend;
  /** Extra bend of the upper thoracic (chest) bone, e.g. bench-press arch. */
  chest?: Bend;
  /** Neck + head rotation relative to the chest. */
  head?: { pitch?: number; yaw?: number; roll?: number };
  /** World point to look at (adds to `head`). */
  gaze?: Vec;
  /** Shoulder blade elevation (shrug) on top of the automatic scapular rhythm. */
  shrug?: number;
  /** Shoulder blade retraction (+) / protraction (-). */
  retract?: number;
  arms: Record<Side, ArmTarget>;
  legs: Record<Side, LegTarget>;
  /** Lower the hips if needed so that IK legs reach their feet targets. */
  reach?: boolean;
}

export interface BodyPose {
  /** World rotation of every bone (rest rotations are identity). */
  rot: Quaternion[];
  /** World position of every bone head. */
  pos: Vector3[];
}

const DEG = Math.PI / 180;
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

export function createPose(): BodyPose {
  return {
    rot: Array.from({ length: BONE_COUNT }, () => new Quaternion()),
    pos: REST_HEAD.map((p) => p.clone()),
  };
}

export function copyPose(from: BodyPose, to: BodyPose): BodyPose {
  from.rot.forEach((q, i) => to.rot[i]!.copy(q));
  from.pos.forEach((p, i) => to.pos[i]!.copy(p));
  return to;
}

/** World position of a body point (rest coordinates attached to a bone). */
export function worldPoint(pose: BodyPose, p: BodyPoint, out = new Vector3()): Vector3 {
  return out
    .copy(p.rest)
    .sub(REST_HEAD[p.bone]!)
    .applyQuaternion(pose.rot[p.bone]!)
    .add(pose.pos[p.bone]!);
}

/** Unit direction for pitch/side angles (0/0 = down, pitch 90 = forward). */
export function limbDirection(pitch: number, side: number, sign: 1 | -1, out = new Vector3()) {
  const p = pitch * DEG;
  const s = side * DEG;
  return out.set(sign * Math.sin(s), -Math.cos(s) * Math.cos(p), Math.cos(s) * Math.sin(p));
}

// ----------------------------------------------------------------- helpers
const m1 = new Matrix4();
const m2 = new Matrix4();
const qa = new Quaternion();
const qb = new Quaternion();

/**
 * Rotation that maps the frame (a0 primary, b0 secondary) onto (a1, b1).
 * Secondary vectors are orthogonalised against the primary ones.
 */
function frameRotation(out: Quaternion, a0: Vector3, b0: Vector3, a1: Vector3, b1: Vector3) {
  basis(m1, a0, b0);
  basis(m2, a1, b1);
  qa.setFromRotationMatrix(m1);
  qb.setFromRotationMatrix(m2);
  return out.copy(qb).multiply(qa.invert());
}

const bx = new Vector3();
const by = new Vector3();
const bz = new Vector3();
function basis(m: Matrix4, a: Vector3, b: Vector3) {
  bx.copy(a).normalize();
  by.copy(b).addScaledVector(bx, -b.dot(bx));
  if (by.lengthSq() < 1e-10) by.copy(Math.abs(bx.y) < 0.9 ? Y : Z).addScaledVector(bx, -bx.y);
  by.normalize();
  bz.crossVectors(bx, by);
  m.makeBasis(bx, by, bz);
}

function setV(out: Vector3, v: Vec): Vector3 {
  return out.set(v[0], v[1], v[2]);
}

const tmpE = new Euler();
function eulerQ(out: Quaternion, x: number, y: number, z: number, order: 'XYZ' | 'YXZ') {
  return out.setFromEuler(tmpE.set(x * DEG, y * DEG, z * DEG, order));
}

// -------------------------------------------------------- skeleton indices
const I = {
  hips: boneIndex('hips'),
  spine: [boneIndex('spine1'), boneIndex('spine2'), boneIndex('spine3'), boneIndex('chest')],
  chest: boneIndex('chest'),
  neck: boneIndex('neck'),
  head: boneIndex('head'),
};
const SPINE_SHARE = [0.28, 0.24, 0.24, 0.24];
const THUMB_OPPOSE = -35;

interface ArmIdx {
  clavicle: number;
  upper: number;
  fore: number;
  twist: number;
  hand: number;
  thumb1: number;
  thumb2: number;
  fingers1: number;
  fingers2: number;
  sign: 1 | -1;
  restUpper: Vector3;
  restFore: Vector3;
  restHinge: Vector3;
  restHandDir: Vector3;
  fingerAxis: Vector3;
  thumbAxis: Vector3;
}
interface LegIdx {
  thigh: number;
  shin: number;
  foot: number;
  toes: number;
  sign: 1 | -1;
  restThigh: Vector3;
  restShin: Vector3;
  restHinge: Vector3;
  /** Toe tip relative to the toe joint (sagittal plane): radius and angle. */
  toeRadius: number;
  toeAngle: number;
}

function dirOf(i: number) {
  return REST_TAIL[i]!.clone().sub(REST_HEAD[i]!).normalize();
}

function armIdx(s: Side): ArmIdx {
  const n = (b: string) => boneIndex(`${s}${b}` as BoneName);
  const upper = n('UpperArm');
  const fore = n('ForeArm');
  const hand = n('Hand');
  const shoulder = REST_HEAD[upper]!;
  const elbow = REST_HEAD[fore]!;
  const wrist = REST_HEAD[hand]!;
  const line = wrist.clone().sub(shoulder).normalize();
  const elbowOut = elbow
    .clone()
    .sub(shoulder)
    .addScaledVector(line, -elbow.clone().sub(shoulder).dot(line))
    .normalize();
  const restUpper = elbow.clone().sub(shoulder).normalize();
  const restHandDir = dirOf(hand);
  const thumbDir = dirOf(n('Thumb2'));
  return {
    clavicle: n('Clavicle'),
    upper,
    fore,
    twist: n('ForeArmTwist'),
    hand,
    thumb1: n('Thumb1'),
    thumb2: n('Thumb2'),
    fingers1: n('Fingers1'),
    fingers2: n('Fingers2'),
    sign: s === 'l' ? 1 : -1,
    restUpper,
    restFore: wrist.clone().sub(elbow).normalize(),
    restHinge: new Vector3().crossVectors(elbowOut, restUpper).normalize(),
    restHandDir,
    fingerAxis: new Vector3().crossVectors(restHandDir, HAND[s].palm).normalize(),
    thumbAxis: new Vector3().crossVectors(thumbDir, HAND[s].palm).normalize(),
  };
}

function legIdx(s: Side): LegIdx {
  const n = (b: string) => boneIndex(`${s}${b}` as BoneName);
  const thigh = n('Thigh');
  const shin = n('Shin');
  const foot = n('Foot');
  const restThigh = REST_HEAD[shin]!.clone().sub(REST_HEAD[thigh]!).normalize();
  const joint = REST_HEAD[n('Toes')]!;
  const tip = FOOT[s].toe;
  return {
    thigh,
    shin,
    foot,
    toes: n('Toes'),
    sign: s === 'l' ? 1 : -1,
    restThigh,
    restShin: REST_HEAD[foot]!.clone().sub(REST_HEAD[shin]!).normalize(),
    restHinge: new Vector3().crossVectors(Z, restThigh).normalize(),
    toeRadius: Math.hypot(tip.y - joint.y, tip.z - joint.z),
    toeAngle: Math.atan2(tip.z - joint.z, joint.y - tip.y) / DEG,
  };
}

const ARMS: Record<Side, ArmIdx> = { l: armIdx('l'), r: armIdx('r') };
const LEGS: Record<Side, LegIdx> = { l: legIdx('l'), r: legIdx('r') };

// ------------------------------------------------------------------ solver
const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();
const v4 = new Vector3();
const vTarget = new Vector3();
const vPole = new Vector3();
const vJoint = new Vector3();
const vWrist = new Vector3();
const pull = new Vector3();
const vU = new Vector3();
const vL = new Vector3();
const vN = new Vector3();
const q1 = new Quaternion();
const q2 = new Quaternion();
const qHand = new Quaternion();

/** Places a bone's head from its parent's pose (rest offsets are rigid). */
function place(pose: BodyPose, i: number) {
  const p = PARENT[i]!;
  pose.pos[i]!.copy(REST_HEAD[i]!)
    .sub(REST_HEAD[p]!)
    .applyQuaternion(pose.rot[p]!)
    .add(pose.pos[p]!);
}

/** Sets a child bone's world rotation as parent rotation * local rotation. */
function local(pose: BodyPose, i: number, q: Quaternion) {
  pose.rot[i]!.copy(pose.rot[PARENT[i]!]!).multiply(q);
  place(pose, i);
}

/**
 * Two-bone IK in world space. Writes the middle joint into `joint` and
 * returns the reached distance ratio (1 = target reached).
 */
function twoBone(
  root: Vector3,
  target: Vector3,
  a: number,
  b: number,
  pole: Vector3,
  joint: Vector3,
): void {
  v1.copy(target).sub(root);
  const d = Math.min(Math.max(v1.length(), Math.abs(a - b) + 1e-4), a + b - 1e-5);
  v1.normalize();
  v2.copy(pole).addScaledVector(v1, -pole.dot(v1));
  if (v2.lengthSq() < 1e-8) v2.copy(Math.abs(v1.y) < 0.9 ? Y : Z).addScaledVector(v1, -v1.y);
  v2.normalize();
  const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  joint
    .copy(root)
    .addScaledVector(v1, a * cosA)
    .addScaledVector(v2, a * sinA);
}

export class BodySolver {
  readonly pose: BodyPose = createPose();

  solve(t: BodyTargets): BodyPose {
    const pose = this.pose;
    this.placeHips(t);
    if (t.reach) this.lowerHipsToReach(t);
    this.solveTrunk(t);
    for (const s of ['l', 'r'] as const) this.solveLeg(s, t.legs[s]);
    for (const s of ['l', 'r'] as const) this.solveArm(s, t);
    return pose;
  }

  private placeHips(t: BodyTargets) {
    const h = t.hips;
    setV(this.pose.pos[I.hips]!, h.pos);
    eulerQ(this.pose.rot[I.hips]!, h.pitch ?? 0, h.yaw ?? 0, -(h.roll ?? 0), 'YXZ');
  }

  /** Lowers the pelvis until every IK leg can reach its ankle target. */
  private lowerHipsToReach(t: BodyTargets) {
    const pose = this.pose;
    let drop = 0;
    const max = (LIMB.thigh + LIMB.shin) * 0.9992;
    for (const s of ['l', 'r'] as const) {
      const leg = t.legs[s];
      if (!('foot' in leg)) continue;
      const hip = v3
        .copy(REST_HEAD[LEGS[s].thigh]!)
        .sub(REST_HEAD[I.hips]!)
        .applyQuaternion(pose.rot[I.hips]!)
        .add(pose.pos[I.hips]!);
      const ankle = this.ankleTarget(s, leg.foot, v4, q1);
      const dx = hip.x - ankle.x;
      const dz = hip.z - ankle.z;
      const horiz = dx * dx + dz * dz;
      if (horiz >= max * max * 0.98) {
        // Leg nearly horizontal (planks): pull the hips towards the foot instead.
        const d = v3.sub(ankle);
        const excess = d.length() - max;
        if (excess > 0) pull.addScaledVector(d.normalize(), -excess);
        continue;
      }
      const maxY = ankle.y + Math.sqrt(max * max - horiz);
      drop = Math.max(drop, hip.y - maxY);
    }
    if (drop > 0) pose.pos[I.hips]!.y -= drop;
    pose.pos[I.hips]!.add(pull);
    pull.set(0, 0, 0);
  }

  private solveTrunk(t: BodyTargets) {
    const pose = this.pose;
    const sp = t.spine ?? {};
    const ch = t.chest ?? {};
    I.spine.forEach((i, k) => {
      const w = SPINE_SHARE[k]!;
      const extra = i === I.chest ? ch : {};
      eulerQ(
        q1,
        (sp.pitch ?? 0) * w + (extra.pitch ?? 0),
        (sp.twist ?? 0) * w + (extra.twist ?? 0),
        -((sp.side ?? 0) * w + (extra.side ?? 0)),
        'XYZ',
      );
      local(pose, i, q1);
    });

    let pitch = t.head?.pitch ?? 0;
    let yaw = t.head?.yaw ?? 0;
    const roll = t.head?.roll ?? 0;
    if (t.gaze) {
      // Direction to the gaze point in the chest frame (eyes ~ 9 cm above the head joint).
      const eyes = v1.set(0, 0.09, 0.08).applyQuaternion(pose.rot[I.chest]!);
      eyes.add(
        v2
          .copy(REST_HEAD[I.head]!)
          .sub(REST_HEAD[I.chest]!)
          .applyQuaternion(pose.rot[I.chest]!)
          .add(pose.pos[I.chest]!),
      );
      const d = setV(v2, t.gaze).sub(eyes).applyQuaternion(q2.copy(pose.rot[I.chest]!).invert());
      yaw += Math.atan2(d.x, d.z) / DEG;
      pitch += Math.atan2(-d.y, Math.hypot(d.x, d.z)) / DEG;
    }
    pitch = Math.min(60, Math.max(-55, pitch));
    yaw = Math.min(75, Math.max(-75, yaw));
    eulerQ(q1, pitch * 0.45, yaw * 0.5, -roll * 0.5, 'YXZ');
    local(pose, I.neck, q1);
    eulerQ(q1, pitch * 0.55, yaw * 0.5, -roll * 0.5, 'YXZ');
    local(pose, I.head, q1);
  }

  /** Ankle target and foot rotation for a foot placement. */
  private ankleTarget(s: Side, f: FootTarget, outPos: Vector3, outRot: Quaternion): Vector3 {
    const sign = LEGS[s].sign;
    eulerQ(outRot, f.pitch ?? 0, sign * (f.out ?? 0), 0, 'YXZ');
    const pivot = f.pivot ?? 'ball';
    const restPivot = pivot === 'ankle' ? REST_HEAD[LEGS[s].foot]! : FOOT[s][pivot];
    return outPos
      .copy(REST_HEAD[LEGS[s].foot]!)
      .sub(restPivot)
      .applyQuaternion(outRot)
      .add(setV(v1, f.at));
  }

  private solveLeg(s: Side, leg: LegTarget) {
    const pose = this.pose;
    const L = LEGS[s];
    place(pose, L.thigh);
    const hip = pose.pos[L.thigh]!;
    if ('foot' in leg) {
      const ankle = this.ankleTarget(s, leg.foot, vTarget, qHand);
      setV(vPole, leg.knee);
      twoBone(hip, ankle, LIMB.thigh, LIMB.shin, vPole, vJoint);
      vU.copy(vJoint).sub(hip).normalize();
      vL.copy(ankle).sub(vJoint).normalize();
      vN.crossVectors(v2.copy(vPole).addScaledVector(vU, -vPole.dot(vU)), vU);
      if (vN.lengthSq() < 1e-8) vN.crossVectors(vU, vL);
      vN.normalize();
      frameRotation(pose.rot[L.thigh]!, L.restThigh, L.restHinge, vU, vN);
      frameRotation(pose.rot[L.shin]!, L.restShin, L.restHinge, vL, vN);
      place(pose, L.shin);
      pose.rot[L.foot]!.copy(qHand);
      place(pose, L.foot);
      const f = leg.foot;
      if (f.toes !== undefined) {
        pose.rot[L.toes]!.copy(qHand).multiply(eulerQ(q1, -f.toes, 0, 0, 'XYZ'));
      } else if ((f.pivot ?? 'ball') === 'ball') {
        // Toes bend so their tips stay on the support surface at the ball's height.
        place(pose, L.toes);
        const h = pose.pos[L.toes]!.y - f.at[1];
        const pitch = L.toeAngle - Math.acos(Math.min(1, Math.max(-1, h / L.toeRadius))) / DEG;
        eulerQ(pose.rot[L.toes]!, pitch, L.sign * (f.out ?? 0), 0, 'YXZ');
      } else {
        eulerQ(pose.rot[L.toes]!, Math.min(f.pitch ?? 0, 0), L.sign * (f.out ?? 0), 0, 'YXZ');
      }
      place(pose, L.toes);
      return;
    }
    const hipsRot = pose.rot[I.hips]!;
    limbDirection(leg.fk.thigh[0], leg.fk.thigh[1], L.sign, vU).applyQuaternion(hipsRot);
    limbDirection(leg.fk.shin[0], leg.fk.shin[1], L.sign, vL).applyQuaternion(hipsRot);
    this.fkHinge(vU, vL, v3.copy(Z).applyQuaternion(hipsRot), vN);
    frameRotation(pose.rot[L.thigh]!, L.restThigh, L.restHinge, vU, vN);
    frameRotation(pose.rot[L.shin]!, L.restShin, L.restHinge, vL, vN);
    place(pose, L.shin);
    local(pose, L.foot, eulerQ(q1, leg.fk.foot ?? 0, 0, 0, 'XYZ'));
    local(pose, L.toes, eulerQ(q1, -(leg.fk.toes ?? 0), 0, 0, 'XYZ'));
  }

  /** Hinge axis for FK limbs: from the bend, or from a pole when straight. */
  private fkHinge(u: Vector3, l: Vector3, pole: Vector3, out: Vector3) {
    out.crossVectors(u, l);
    if (out.lengthSq() < 0.02) {
      out.crossVectors(v4.copy(pole).addScaledVector(u, -pole.dot(u)), u);
    }
    return out.normalize();
  }

  private solveArm(s: Side, t: BodyTargets) {
    const pose = this.pose;
    const A = ARMS[s];
    const arm = t.arms[s];
    const chestRot = pose.rot[I.chest]!;
    const chestInv = q2.copy(chestRot).invert();

    // Hand target (for the scapular rhythm) in world space.
    const restShoulder = REST_HEAD[A.upper]!;
    let reachDir: Vector3;
    if ('fk' in arm) {
      reachDir = limbDirection(arm.fk.upper[0], arm.fk.upper[1], A.sign, v3);
    } else {
      this.gripWorld(arm, vTarget);
      reachDir = v3
        .copy(vTarget)
        .sub(
          v4
            .copy(restShoulder)
            .sub(REST_HEAD[I.chest]!)
            .applyQuaternion(chestRot)
            .add(pose.pos[I.chest]!),
        )
        .normalize()
        .applyQuaternion(chestInv);
    }
    // Scapulohumeral rhythm: the shoulder blade elevates when the arm goes
    // overhead and protracts when reaching forward.
    const elevation = Math.acos(Math.min(1, Math.max(-1, -reachDir.y))) / DEG;
    const elev = Math.min(24, Math.max(0, (elevation - 70) * 0.3)) + (t.shrug ?? 0);
    const protract = Math.min(10, Math.max(-12, reachDir.z * 9 - (t.retract ?? 0)));
    q1.setFromEuler(tmpE.set(0, -A.sign * protract * DEG, A.sign * elev * DEG, 'YZX'));
    local(pose, A.clavicle, q1);
    place(pose, A.upper);
    const shoulder = pose.pos[A.upper]!;

    if ('fk' in arm) {
      limbDirection(arm.fk.upper[0], arm.fk.upper[1], A.sign, vU).applyQuaternion(chestRot);
      limbDirection(arm.fk.fore[0], arm.fk.fore[1], A.sign, vL).applyQuaternion(chestRot);
      this.fkHinge(vU, vL, v3.set(0, 0, -1).applyQuaternion(chestRot), vN);
      frameRotation(pose.rot[A.upper]!, A.restUpper, A.restHinge, vU, vN);
      frameRotation(pose.rot[A.fore]!, A.restFore, A.restHinge, vL, vN);
      // Hand continues the forearm, palm turned towards `palm`.
      if (arm.palm) setV(v3, arm.palm);
      else v3.copy(HAND[s].palm).applyQuaternion(pose.rot[A.fore]!);
      frameRotation(qHand, A.restHandDir, HAND[s].palm, vL, v3);
      this.finishArm(s, qHand, arm.fingers ?? 0.25);
      return;
    }

    // Two passes: the neutral-wrist hand direction depends on the forearm.
    this.frameVector(arm, arm.elbow, vPole);
    const restPoint =
      arm.point === 'palm'
        ? HAND[s].palmSkin
        : arm.point === 'wrist'
          ? REST_HEAD[A.hand]!
          : HAND[s].grip;
    const handDir = v4;
    if (arm.hand) this.frameVector(arm, arm.hand, handDir);
    else handDir.copy(vTarget).sub(shoulder).normalize();
    for (let pass = 0; pass < 2; pass++) {
      this.handRotation(s, arm, handDir, qHand);
      // Wrist position so that the grip point lands on the target.
      const wrist = vWrist
        .copy(REST_HEAD[A.hand]!)
        .sub(restPoint)
        .applyQuaternion(qHand)
        .add(vTarget);
      twoBone(shoulder, wrist, LIMB.upperArm, LIMB.foreArm, vPole, vJoint);
      vU.copy(vJoint).sub(shoulder).normalize();
      vL.copy(wrist).sub(vJoint).normalize();
      if (arm.hand) break;
      handDir.copy(vL);
      if (arm.wrist) {
        // Extend the wrist: knuckles rotate towards the back of the hand.
        const palm = v2.copy(HAND[s].palm).applyQuaternion(qHand);
        q1.setFromAxisAngle(vN.crossVectors(palm, handDir).normalize(), -arm.wrist * DEG);
        handDir.applyQuaternion(q1);
      }
    }
    vN.crossVectors(v2.copy(vPole).addScaledVector(vU, -vPole.dot(vU)), vU);
    if (vN.lengthSq() < 1e-8) vN.crossVectors(vU, vL);
    vN.normalize();
    frameRotation(pose.rot[A.upper]!, A.restUpper, A.restHinge, vU, vN);
    frameRotation(pose.rot[A.fore]!, A.restFore, A.restHinge, vL, vN);
    this.finishArm(s, qHand, arm.fingers ?? 1);
  }

  /** Twist distribution, hand and fingers once upper arm and forearm are set. */
  private finishArm(s: Side, hand: Quaternion, fingers: number) {
    const pose = this.pose;
    const A = ARMS[s];
    place(pose, A.fore);
    // Forearm pronation/supination: split the hand's twist about the forearm
    // axis between the forearm (25 %) and its twist bone (80 %).
    q1.copy(pose.rot[A.fore]!).invert().multiply(hand);
    const axisDot = q1.x * A.restFore.x + q1.y * A.restFore.y + q1.z * A.restFore.z;
    const twist = 2 * Math.atan2(axisDot, q1.w);
    const wrapped = Math.atan2(Math.sin(twist), Math.cos(twist));
    const base = q2.copy(pose.rot[A.fore]!);
    pose.rot[A.fore]!.multiply(q1.setFromAxisAngle(A.restFore, wrapped * 0.25));
    pose.rot[A.twist]!.copy(base).multiply(q1.setFromAxisAngle(A.restFore, wrapped * 0.8));
    place(pose, A.twist);
    pose.rot[A.hand]!.copy(hand);
    place(pose, A.hand);
    const c = Math.min(1, Math.max(0, fingers));
    local(pose, A.fingers1, q1.setFromAxisAngle(A.fingerAxis, c * 78 * DEG));
    local(pose, A.fingers2, q1.setFromAxisAngle(A.fingerAxis, c * 92 * DEG));
    // Thumb: opposition across the palm, then flexion around the bar.
    q1.setFromAxisAngle(A.restHandDir, A.sign * c * THUMB_OPPOSE * DEG);
    local(pose, A.thumb1, q1.multiply(q2.setFromAxisAngle(A.thumbAxis, c * 18 * DEG)));
    local(pose, A.thumb2, q1.setFromAxisAngle(A.thumbAxis, c * 65 * DEG));
  }

  private frameVector(arm: ArmIK, v: Vec, out: Vector3): Vector3 {
    setV(out, v);
    if (arm.frame) out.applyQuaternion(this.pose.rot[boneIndex(arm.frame)]!);
    return out.normalize();
  }

  private gripWorld(arm: ArmIK, out: Vector3): Vector3 {
    setV(out, arm.grip);
    if (!arm.frame) return out;
    const b = boneIndex(arm.frame);
    return out.sub(REST_HEAD[b]!).applyQuaternion(this.pose.rot[b]!).add(this.pose.pos[b]!);
  }

  private handRotation(s: Side, arm: ArmIK, handDir: Vector3, out: Quaternion) {
    const A = ARMS[s];
    if (arm.across) {
      const across = this.frameVector(arm, arm.across, v2);
      return frameRotation(out, HAND[s].across, A.restHandDir, across, handDir);
    }
    const palm = arm.palm ? this.frameVector(arm, arm.palm, v2) : v2.set(0, -1, 0);
    return frameRotation(out, A.restHandDir, HAND[s].palm, handDir, palm);
  }
}

/** World position of the grip point (bar axis in the fist) of a solved hand. */
export function gripPoint(pose: BodyPose, s: Side, out = new Vector3()): Vector3 {
  return worldPoint(pose, { bone: ARMS[s].hand, rest: HAND[s].grip }, out);
}

export function palmPoint(pose: BodyPose, s: Side, out = new Vector3()): Vector3 {
  return worldPoint(pose, { bone: ARMS[s].hand, rest: HAND[s].palmSkin }, out);
}

/** Bar axis direction (index -> little finger) of a solved hand. */
export function gripAxis(pose: BodyPose, s: Side, out = new Vector3()): Vector3 {
  return out.copy(HAND[s].across).applyQuaternion(pose.rot[ARMS[s].hand]!);
}

/** Sole points (heel, ball, toe tip) of a solved foot in world space. */
export function solePoints(pose: BodyPose, s: Side): [Vector3, Vector3, Vector3] {
  const L = LEGS[s];
  return [
    worldPoint(pose, { bone: L.foot, rest: FOOT[s].heel }),
    worldPoint(pose, { bone: L.foot, rest: FOOT[s].ball }),
    worldPoint(pose, { bone: L.toes, rest: FOOT[s].toe }),
  ];
}
