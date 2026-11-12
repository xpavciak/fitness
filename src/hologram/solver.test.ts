/// <reference types="node" />
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { HUMAN_BONES, HUMAN_MODEL_HASH } from './humanSkeleton';
import { ease, loopSpline, track } from './motion';
import { BONE_NAMES, LIMB, REST_HEAD, boneIndex } from './skeleton';
import {
  BodySolver,
  gripAxis,
  gripPoint,
  limbDirection,
  palmPoint,
  solePoints,
  type BodyTargets,
} from './solver';

const near = (v: Vector3, e: [number, number, number], d = 1e-6) =>
  v.toArray().forEach((x, i) => expect(x).toBeCloseTo(e[i]!, -Math.log10(d)));

const stand = (): BodyTargets => ({
  hips: { pos: [0, 1.2, 0] },
  legs: {
    l: { foot: { at: [0.12, 0, 0.1] }, knee: [0, 0, 1] },
    r: { foot: { at: [-0.12, 0, 0.1] }, knee: [0, 0, 1] },
  },
  arms: {
    l: { fk: { upper: [0, 8], fore: [10, 8] } },
    r: { fk: { upper: [0, 8], fore: [10, 8] } },
  },
  reach: true,
});

describe('motion helpers', () => {
  it('easing curves start at 0, end at 1 and stay in range', () => {
    for (const kind of ['linear', 'in', 'out', 'inOut', 'controlled', 'explosive'] as const) {
      expect(ease(kind, 0)).toBeCloseTo(0);
      expect(ease(kind, 1)).toBeCloseTo(1);
      expect(ease(kind, -1)).toBeCloseTo(0);
      for (let x = 0; x <= 1; x += 0.05) {
        expect(ease(kind, x)).toBeGreaterThanOrEqual(-1e-9);
        expect(ease(kind, x)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
    // Explosive concentric covers most of the distance in the first half.
    expect(ease('explosive', 0.5)).toBeGreaterThan(0.65);
    // Controlled eccentric moves at an even pace in the middle.
    expect(ease('controlled', 0.5)).toBeCloseTo(0.5);
  });

  it('tracks hit their keys, hold, ease and loop', () => {
    const t = track(4, [
      { at: 0, value: 0 },
      { at: 1, value: 0 },
      { at: 2, value: 10, ease: 'linear' },
      { at: 3, value: 10 },
    ]);
    expect(t(0.5)).toBe(0);
    expect(t(1.5)).toBeCloseTo(5);
    expect(t(2.5)).toBe(10);
    expect(t(3.5)).toBeCloseTo(5); // back to the first key with inOut easing
    expect(t(5.5)).toBeCloseTo(t(1.5));
    expect(t(-0.5)).toBeCloseTo(t(3.5));
  });

  it('rejects invalid tracks', () => {
    expect(() => track(1, [])).toThrow(/at least one/);
    expect(() =>
      track(1, [
        { at: 0.5, value: 0 },
        { at: 0.2, value: 1 },
      ]),
    ).toThrow(/sorted/);
    expect(() =>
      track(1, [
        { at: 0, value: 0 },
        { at: 1, value: 1 },
      ]),
    ).toThrow(/exceed/);
  });

  it('loopSpline passes through its points and is periodic', () => {
    const f = loopSpline([0, 0.25, 0.5, 0.75], [[0], [1], [0], [-1]]);
    expect(f(0)[0]).toBeCloseTo(0);
    expect(f(0.25)[0]).toBeCloseTo(1);
    expect(f(1.25)[0]).toBeCloseTo(1);
    expect(f(0.125)[0]).toBeGreaterThan(0.5);
  });
});

describe('body solver', () => {
  it('limbDirection maps pitch/side to unit vectors', () => {
    near(limbDirection(0, 0, 1), [0, -1, 0]);
    near(limbDirection(90, 0, 1), [0, 0, 1]);
    near(limbDirection(180, 0, 1), [0, 1, 0]);
    near(limbDirection(0, 90, 1), [1, 0, 0]);
    near(limbDirection(0, 90, -1), [-1, 0, 0]);
  });

  it('the rest pose solves to the rest skeleton', () => {
    const solver = new BodySolver();
    const pose = solver.solve({
      hips: { pos: REST_HEAD[0]!.toArray() as [number, number, number] },
      legs: {
        l: { fk: { thigh: [0, 0], shin: [0, 0] } },
        r: { fk: { thigh: [0, 0], shin: [0, 0] } },
      },
      arms: {
        l: { fk: { upper: [0, 0], fore: [0, 0] } },
        r: { fk: { upper: [0, 0], fore: [0, 0] } },
      },
    });
    // Trunk bones keep their rest offsets.
    for (const name of ['spine1', 'spine2', 'spine3', 'chest', 'neck', 'head'] as const) {
      expect(pose.pos[boneIndex(name)]!.distanceTo(REST_HEAD[boneIndex(name)]!)).toBeLessThan(1e-6);
    }
  });

  it('places the feet flat on the floor and lowers the hips until the legs reach', () => {
    const solver = new BodySolver();
    const pose = solver.solve(stand());
    for (const side of ['l', 'r'] as const) {
      for (const p of solePoints(pose, side)) expect(Math.abs(p.y)).toBeLessThan(0.002);
    }
    // Hips were requested at 1.2 m, legs are only ~0.88 m long.
    expect(pose.pos[0]!.y).toBeLessThan(LIMB.thigh + LIMB.shin + LIMB.ankleHeight + 0.1);
    const thigh = pose.pos[boneIndex('lShin')]!.distanceTo(pose.pos[boneIndex('lThigh')]!);
    expect(thigh).toBeCloseTo(LIMB.thigh, 5);
  });

  it('bends the knee towards the pole and keeps bone lengths', () => {
    const solver = new BodySolver();
    const t = stand();
    t.hips = { pos: [0, 0.6, -0.2], pitch: 30 };
    t.reach = false;
    const pose = solver.solve(t);
    const hip = pose.pos[boneIndex('lThigh')]!;
    const knee = pose.pos[boneIndex('lShin')]!;
    const ankle = pose.pos[boneIndex('lFoot')]!;
    expect(knee.z).toBeGreaterThan(Math.max(hip.z, ankle.z)); // knee points forward
    expect(hip.distanceTo(knee)).toBeCloseTo(LIMB.thigh, 5);
    expect(knee.distanceTo(ankle)).toBeCloseTo(LIMB.shin, 5);
  });

  it('puts the bar axis of the fist exactly on a reachable grip target', () => {
    const solver = new BodySolver();
    const t = stand();
    t.arms = {
      l: { grip: [0.25, 1.1, 0.35], across: [1, 0, 0], elbow: [0.3, -1, 0] },
      r: { grip: [-0.25, 1.1, 0.35], across: [-1, 0, 0], elbow: [-0.3, -1, 0] },
    };
    const pose = solver.solve(t);
    near(gripPoint(pose, 'l'), [0.25, 1.1, 0.35], 1e-4);
    near(gripPoint(pose, 'r'), [-0.25, 1.1, 0.35], 1e-4);
    expect(gripAxis(pose, 'l').dot(new Vector3(1, 0, 0))).toBeGreaterThan(0.999);
    const elbow = pose.pos[boneIndex('lForeArm')]!;
    const shoulder = pose.pos[boneIndex('lUpperArm')]!;
    expect(elbow.y).toBeLessThan(shoulder.y); // elbow follows the pole (down)
  });

  it('places a flat palm on the floor', () => {
    const solver = new BodySolver();
    const t = stand();
    t.hips = { pos: [0, 0.5, 0], pitch: 80 };
    t.arms.l = {
      grip: [0.2, 0, 0.5],
      point: 'palm',
      palm: [0, -1, 0],
      hand: [0, 0, 1],
      elbow: [0, 0, -1],
    };
    const pose = solver.solve(t);
    near(palmPoint(pose, 'l'), [0.2, 0, 0.5], 1e-2);
  });

  it('keeps the toes on the floor when the heel lifts', () => {
    const solver = new BodySolver();
    const t = stand();
    t.legs.l = { foot: { at: [0.12, 0, 0.1], pitch: 40 }, knee: [0, 0, 1] };
    const pose = solver.solve(t);
    const [heel, ball, toe] = solePoints(pose, 'l');
    expect(heel.y).toBeGreaterThan(0.1);
    expect(ball.y).toBeCloseTo(0, 3);
    expect(toe.y).toBeCloseTo(0, 3);
  });

  it('returns normalised rotations', () => {
    const solver = new BodySolver();
    const pose = solver.solve(stand());
    for (const q of pose.rot) expect(q.length()).toBeCloseTo(1, 6);
    expect(pose.rot[0]!.equals(new Quaternion())).toBe(true);
  });
});

describe('human model asset', () => {
  const file = resolve(__dirname, '../../public/models/human.glb');

  it('is a compact binary glTF', () => {
    expect(statSync(file).size).toBeLessThan(1.5 * 1024 * 1024);
    const buf = readFileSync(file);
    expect(buf.toString('ascii', 0, 4)).toBe('glTF');
  });

  it('matches the generated skeleton data', () => {
    const buf = readFileSync(file);
    const jsonLength = buf.readUInt32LE(12);
    const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength)) as {
      nodes: { name: string; translation?: number[]; rotation?: number[] }[];
      skins: { joints: number[] }[];
      extensionsRequired?: string[];
    };
    const joints = gltf.skins[0]!.joints.map((j) => gltf.nodes[j]!);
    expect(joints.map((n) => n.name)).toEqual(BONE_NAMES);
    HUMAN_BONES.forEach((b, i) => {
      const parent = b.parent ? HUMAN_BONES.find((p) => p.name === b.parent)!.head : [0, 0, 0];
      const t = joints[i]!.translation ?? [0, 0, 0];
      t.forEach((v, k) => expect(v).toBeCloseTo(b.head[k]! - parent[k]!, 4));
      expect(joints[i]!.rotation).toBeUndefined();
    });
    // Only extensions three's GLTFLoader decodes without WASM.
    expect(gltf.extensionsRequired ?? []).toEqual(['KHR_mesh_quantization']);
    expect(HUMAN_MODEL_HASH).toMatch(/^[0-9a-f]{12}$/);
  });
});
