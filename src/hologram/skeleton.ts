import { Vector3 } from 'three';
import { FOOT_CONTACTS, HANDS, HUMAN_BONES, LANDMARKS, type HumanBoneName } from './humanSkeleton';

/**
 * Typed access to the rest pose of the human model (see humanSkeleton.ts).
 * Every bone has an identity rest rotation, so a bone's world rotation is the
 * rotation applied to its rest geometry.
 */
export type BoneName = HumanBoneName;
export type Side = 'l' | 'r';
export const SIDES: readonly Side[] = ['l', 'r'];

export const BONE_COUNT = HUMAN_BONES.length;
export const BONE_NAMES: readonly BoneName[] = HUMAN_BONES.map((b) => b.name);

const indexByName = new Map<string, number>(BONE_NAMES.map((n, i) => [n, i]));

export function boneIndex(name: BoneName): number {
  const i = indexByName.get(name);
  if (i === undefined) throw new Error(`Unknown bone ${name}`);
  return i;
}

export const PARENT: readonly number[] = HUMAN_BONES.map((b) =>
  b.parent === null ? -1 : boneIndex(b.parent as BoneName),
);
export const REST_HEAD: readonly Vector3[] = HUMAN_BONES.map((b) => new Vector3(...b.head));
export const REST_TAIL: readonly Vector3[] = HUMAN_BONES.map((b) => new Vector3(...b.tail));

export function restVector(name: BoneName): Vector3 {
  const i = boneIndex(name);
  return REST_TAIL[i]!.clone().sub(REST_HEAD[i]!);
}

export const vec = (v: readonly number[]): Vector3 => new Vector3(v[0], v[1], v[2]);

export type LandmarkName = keyof typeof LANDMARKS;
export interface BodyPoint {
  bone: number;
  /** Point in rest-pose world coordinates. */
  rest: Vector3;
}

export function landmark(name: LandmarkName): BodyPoint {
  const l = LANDMARKS[name];
  return { bone: boneIndex(l.bone as BoneName), rest: vec(l.pos) };
}

export function bodyPoint(bone: BoneName, rest: readonly number[]): BodyPoint {
  return { bone: boneIndex(bone), rest: vec(rest) };
}

/**
 * Bar axis when pressing: low in the palm, over the heel of the hand and the
 * forearm bones (5 cm past the wrist joint, palm skin + bar radius off the
 * hand's axis), as coached for bench and overhead presses.
 */
function palmHeel(s: 'l' | 'r'): Vector3 {
  const b = HUMAN_BONES.find((x) => x.name === `${s}Hand`)!;
  const wrist = vec(b.head);
  const dir = vec(b.tail).sub(wrist).normalize();
  return wrist.addScaledVector(dir, 0.05).addScaledVector(vec(HANDS[s].palm), 0.042);
}

export const HAND = {
  l: {
    across: vec(HANDS.l.across),
    palm: vec(HANDS.l.palm),
    /** Bar axis in a full grip (fingers wrapped, bar at the base of the fingers). */
    grip: vec(HANDS.l.grip),
    heel: palmHeel('l'),
    palmSkin: vec(HANDS.l.palmSkin),
  },
  r: {
    across: vec(HANDS.r.across),
    palm: vec(HANDS.r.palm),
    grip: vec(HANDS.r.grip),
    heel: palmHeel('r'),
    palmSkin: vec(HANDS.r.palmSkin),
  },
};

export const FOOT = {
  l: {
    heel: vec(FOOT_CONTACTS.l.heel),
    ball: vec(FOOT_CONTACTS.l.ball),
    toe: vec(FOOT_CONTACTS.l.toe),
  },
  r: {
    heel: vec(FOOT_CONTACTS.r.heel),
    ball: vec(FOOT_CONTACTS.r.ball),
    toe: vec(FOOT_CONTACTS.r.toe),
  },
};

const length = (a: BoneName, b: BoneName) =>
  REST_HEAD[boneIndex(a)]!.distanceTo(REST_HEAD[boneIndex(b)]!);

/** Segment lengths in metres. */
export const LIMB = {
  upperArm: length('lUpperArm', 'lForeArm'),
  foreArm: length('lForeArm', 'lHand'),
  thigh: length('lThigh', 'lShin'),
  shin: length('lShin', 'lFoot'),
  /** Ankle joint height above the floor with the foot flat. */
  ankleHeight: REST_HEAD[boneIndex('lFoot')]!.y,
};

/** Shoulder joint -> bar axis in the fist with a straight arm. */
export const ARM_REACH =
  LIMB.upperArm + LIMB.foreArm + HAND.l.grip.distanceTo(REST_HEAD[boneIndex('lHand')]!);
/** Shoulder joint -> bar in the palm heel (presses) with a straight arm. */
export const ARM_REACH_HEEL =
  LIMB.upperArm + LIMB.foreArm + HAND.l.heel.distanceTo(REST_HEAD[boneIndex('lHand')]!);
/** Shoulder joint -> palm skin with a straight arm and a flat hand. */
export const ARM_REACH_PALM =
  LIMB.upperArm + LIMB.foreArm + HAND.l.palmSkin.distanceTo(REST_HEAD[boneIndex('lHand')]!);
