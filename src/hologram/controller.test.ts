/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Box3, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AnimationId } from '../plan/types';
import { CLIPS } from './clips';
import { FLAT_BENCH, INCLINE_BENCH } from './layout';
import { HologramController } from './controller';
import { boneIndex } from './skeleton';

let model: Object3D;

beforeAll(async () => {
  const buf = readFileSync(resolve(__dirname, '../../public/models/human.glb'));
  // Copy into an ArrayBuffer of the test realm (GLTFLoader checks instanceof).
  const data = new ArrayBuffer(buf.byteLength);
  new Uint8Array(data).set(buf);
  model = await new Promise<Object3D>((ok, fail) =>
    new GLTFLoader().parse(data, '', (gltf) => ok(gltf.scene), fail),
  );
});

describe('HologramController with the real model', () => {
  it('poses the skinned skeleton for every clip', () => {
    for (const id of Object.keys(CLIPS) as AnimationId[]) {
      const c = new HologramController(id, model);
      c.update(0.05, true, false);
      const hips = c.rig.bones[0]!;
      expect(Number.isFinite(hips.position.y), id).toBe(true);
      // The figure stands on (or above) the floor and fits a gym-sized box.
      c.root.updateMatrixWorld(true);
      const box = new Box3();
      for (const b of c.rig.bones) box.expandByPoint(b.getWorldPosition(new Vector3()));
      expect(box.min.y, id).toBeGreaterThan(-0.02);
      expect(box.max.y, id).toBeLessThan(2.6);
      c.dispose();
    }
  });

  it('moves the dumbbells with the hands and shows only the clip’s equipment', () => {
    const c = new HologramController('curl', model);
    for (const t of [0, 1.5, 3]) {
      c.evaluate(t);
      c.root.updateMatrixWorld(true);
      const dumbbell = c.props.root.getObjectByName('dumbbell-l')!;
      const hand = c.rig.bones[boneIndex('lHand')]!;
      const d = dumbbell
        .getWorldPosition(new Vector3())
        .distanceTo(hand.getWorldPosition(new Vector3()));
      expect(d).toBeLessThan(0.2);
    }
    expect(c.props.root.getObjectByName('dumbbells')!.visible).toBe(true);
    expect(c.props.root.getObjectByName('barbell')!.visible).toBe(false);
    expect(c.props.root.getObjectByName('bench')!.visible).toBe(false);
    c.dispose();
  });

  it('keeps time while paused and switches clips from the start', () => {
    const c = new HologramController('squat', model);
    c.update(0.1, false, true);
    const hipsY = c.rig.bones[0]!.position.y;
    c.update(0.1, false, true);
    expect(c.rig.bones[0]!.position.y).toBe(hipsY);
    c.setAnimation('bench-press');
    c.update(0, false, true);
    // Lying on the bench: hips at bench height, hands above the chest.
    expect(c.rig.bones[0]!.position.y).toBeLessThan(0.7);
    c.dispose();
  });

  it('feeds breathing and fade into the shader uniforms', () => {
    const c = new HologramController('carry', model);
    c.update(0, true, false);
    expect(c.bodyMaterial.uniforms.uFade!.value).toBeLessThan(0.1); // re-materialising
    c.update(0.1, true, false);
    c.update(0.1, true, false);
    c.update(0.1, true, false);
    expect(c.bodyMaterial.uniforms.uFade!.value).toBe(1);
    expect(c.bodyDepthMaterial.uniforms.uBreath).toBe(c.bodyMaterial.uniforms.uBreath);
    c.dispose();
  });

  it('the skinned head rests on the bench pad without sinking in or hanging off', () => {
    const head = boneIndex('head');
    const cases = [
      { id: 'bench-press', point: [0, FLAT_BENCH.top, 0], normal: [0, 1, 0] },
      { id: 'bench-press-dumbbells', point: [0, FLAT_BENCH.top, 0], normal: [0, 1, 0] },
      {
        id: 'incline-press',
        point: [0, INCLINE_BENCH.seatTop, INCLINE_BENCH.seatBack],
        normal: [0, Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)],
      },
    ] as const;
    for (const { id, point, normal } of cases) {
      const c = new HologramController(id, model);
      const mesh = c.rig.mesh;
      const idx = mesh.geometry.getAttribute('skinIndex');
      const wgt = mesh.geometry.getAttribute('skinWeight');
      const n = new Vector3(...normal);
      const p0 = new Vector3(...point);
      for (const t of [0.2, 2.9]) {
        c.evaluate(t);
        c.root.updateMatrixWorld(true);
        mesh.skeleton.update();
        let lowest = Infinity;
        let headEnd = Infinity;
        const v = new Vector3();
        for (let i = 0; i < idx.count; i++) {
          let w = 0;
          for (let k = 0; k < 4; k++)
            if (idx.getComponent(i, k) === head) w += wgt.getComponent(i, k);
          if (w < 0.5) continue;
          mesh.getVertexPosition(i, v);
          mesh.localToWorld(v);
          lowest = Math.min(lowest, v.clone().sub(p0).dot(n));
          headEnd = Math.min(headEnd, v.z);
        }
        expect(lowest, `${id} @${t}`).toBeGreaterThan(-0.01);
        expect(lowest, `${id} @${t}`).toBeLessThan(0.02);
        if (id !== 'incline-press') expect(headEnd - FLAT_BENCH.zHead, id).toBeGreaterThan(0.02);
      }
      c.dispose();
    }
  });

  it('rejects a model whose skeleton does not match', () => {
    const broken = cloneSkinned(model);
    const bone = broken.getObjectByName('lShin')!;
    bone.name = 'renamed';
    expect(() => new HologramController('squat', broken)).toThrow(/lShin/);
  });
});
