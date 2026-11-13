import {
  Group,
  Quaternion,
  SkinnedMesh,
  type Bone,
  type Object3D,
  type ShaderMaterial,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BONE_NAMES, PARENT, REST_HEAD } from './skeleton';
import type { BodyPose } from './solver';
import { ModelMismatchError } from './modelError';

/**
 * The human figure: the skinned mesh from public/models/human.glb (CC0,
 * derived from MakeHuman, see docs/ASSETS.md) plus a depth-only twin that
 * shares its geometry and skeleton.
 */
export interface Rig {
  container: Group;
  /** The visible skinned body (shares geometry and skeleton with its depth twin). */
  mesh: SkinnedMesh;
  bones: Bone[];
  dispose: () => void;
}

export function createRig(
  modelScene: Object3D,
  bodyMaterial: ShaderMaterial,
  depthMaterial: ShaderMaterial,
): Rig {
  // The loader caches the parsed scene; clone so every stage owns its bones.
  const scene = cloneSkinned(modelScene);
  let mesh: SkinnedMesh | null = null;
  scene.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
  });
  const body = mesh as SkinnedMesh | null;
  if (!body) throw new ModelMismatchError('Human model has no skinned mesh');

  const bones = BONE_NAMES.map((name, i) => {
    const bone = body.skeleton.bones.find((b) => b.name === name);
    if (!bone) throw new ModelMismatchError(`Human model is missing bone ${name}`);
    const parent = PARENT[i]!;
    const expected = parent < 0 ? REST_HEAD[i]! : REST_HEAD[i]!.clone().sub(REST_HEAD[parent]!);
    if (bone.position.distanceTo(expected) > 1e-3) {
      throw new ModelMismatchError(`Bone ${name} does not match the skeleton data`);
    }
    return bone;
  });

  body.material = bodyMaterial;
  body.frustumCulled = false;
  body.renderOrder = 2;
  const depth = new SkinnedMesh(body.geometry, depthMaterial);
  depth.bind(body.skeleton, body.bindMatrix);
  depth.frustumCulled = false;
  depth.renderOrder = 1;
  body.parent?.add(depth);

  const container = new Group();
  container.add(scene);
  return {
    container,
    mesh: body,
    bones,
    dispose: () => {
      body.geometry.dispose();
      body.skeleton.dispose();
    },
  };
}

const inv = new Quaternion();

/** Writes a solved pose into the skeleton (rest rotations are identity). */
export function applyPose(rig: Rig, pose: BodyPose): void {
  const bones = rig.bones;
  for (let i = 0; i < bones.length; i++) {
    const bone = bones[i]!;
    const parent = PARENT[i]!;
    if (parent < 0) {
      bone.position.copy(pose.pos[i]!);
      bone.quaternion.copy(pose.rot[i]!);
    } else {
      bone.quaternion.copy(inv.copy(pose.rot[parent]!).invert().multiply(pose.rot[i]!));
    }
  }
}
