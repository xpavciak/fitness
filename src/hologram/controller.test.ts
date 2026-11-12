/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Box3, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AnimationId } from '../plan/types';
import { CLIPS } from './clips';
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

  it('rejects a model whose skeleton does not match', () => {
    const broken = cloneSkinned(model);
    const bone = broken.getObjectByName('lShin')!;
    bone.name = 'renamed';
    expect(() => new HologramController('squat', broken)).toThrow(/lShin/);
  });
});
