import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  Quaternion,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { ClipFrame, PropKind } from './clipKit';
import {
  BARBELL,
  BENCH_RACK,
  BIKE,
  CABLE,
  DUMBBELL,
  FLAT_BENCH,
  INCLINE_BENCH,
  MAT,
  PULLDOWN,
  ROW_BENCH,
  SPLIT_BENCH,
  SQUAT_RACK,
  STEP,
  TREADMILL,
} from './layout';
import { boneIndex, type Side } from './skeleton';
import { gripAxis, gripPoint, worldPoint, type BodyPose } from './solver';

/**
 * Gym equipment at real-world scale, built from simple primitives that share
 * one holographic material. Static pieces are placed once (see layout.ts);
 * hand-held and moving pieces are updated from the solved pose every frame.
 */
export interface Props {
  root: Group;
  update: (kinds: readonly PropKind[], frame: ClipFrame, pose: BodyPose) => void;
  dispose: () => void;
}

const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const va = new Vector3();
const vb = new Vector3();
const vc = new Vector3();
const vd = new Vector3();
const qa = new Quaternion();

export function createProps(material: Material, depthMaterial: Material): Props {
  const geometries: BufferGeometry[] = [];
  const root = new Group();
  const kinds = new Map<PropKind, Group>();

  /** Adds a mesh plus its depth pre-pass twin. */
  const add = (parent: Object3D, g: BufferGeometry): Mesh => {
    geometries.push(g);
    // Drawn after the body: equipment never hides the figure, but the body
    // (already in the depth buffer) hides equipment behind it.
    const mesh = new Mesh(g, material);
    mesh.renderOrder = 4;
    const depth = new Mesh(g, depthMaterial);
    depth.renderOrder = 3;
    mesh.add(depth);
    parent.add(mesh);
    return mesh;
  };
  const box = (parent: Object3D, size: [number, number, number], pos: [number, number, number]) => {
    const m = add(parent, new BoxGeometry(...size));
    m.position.set(...pos);
    return m;
  };
  /** Cylinder along `axis` ('x' | 'y' | 'z') centred at pos. */
  const cyl = (
    parent: Object3D,
    radius: number,
    length: number,
    pos: [number, number, number],
    axis: 'x' | 'y' | 'z' = 'y',
    segments = 16,
  ) => {
    const m = add(parent, new CylinderGeometry(radius, radius, length, segments));
    m.position.set(...pos);
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    return m;
  };
  /** Unit-length cylinder that `stretch` places between two points. */
  const rod = (parent: Object3D, radius: number) => {
    const m = add(parent, new CylinderGeometry(radius, radius, 1, 8));
    return m;
  };
  const group = (kind: PropKind) => {
    const g = new Group();
    g.name = kind;
    g.visible = false;
    kinds.set(kind, g);
    root.add(g);
    return g;
  };
  /** Tube between two points (frames, cables). */
  const tube = (parent: Object3D, r: number, a: readonly number[], b: readonly number[]) => {
    const m = rod(parent, r);
    stretch(m, va.set(a[0]!, a[1]!, a[2]!), vb.set(b[0]!, b[1]!, b[2]!));
    return m;
  };

  // ------------------------------------------------------------ barbell
  const barbell = group('barbell');
  const bar = new Group();
  barbell.add(bar);
  cyl(bar, BARBELL.shaftRadius, BARBELL.collar * 2, [0, 0, 0], 'x', 10);
  for (const s of [1, -1]) {
    const sleeveLen = BARBELL.length / 2 - BARBELL.collar;
    cyl(
      bar,
      BARBELL.sleeveRadius,
      sleeveLen,
      [s * (BARBELL.collar + sleeveLen / 2), 0, 0],
      'x',
      12,
    );
    cyl(bar, 0.04, 0.03, [s * (BARBELL.collar + 0.015), 0, 0], 'x', 16);
    // 20 kg + 10 kg bumper plates and a small change plate.
    cyl(bar, BARBELL.plateRadius, 0.06, [s * (BARBELL.collar + 0.07), 0, 0], 'x', 32);
    cyl(bar, BARBELL.plateRadius, 0.04, [s * (BARBELL.collar + 0.12), 0, 0], 'x', 32);
    cyl(bar, 0.13, 0.025, [s * (BARBELL.collar + 0.157), 0, 0], 'x', 24);
    cyl(bar, 0.045, 0.03, [s * (BARBELL.collar + 0.185), 0, 0], 'x', 16);
  }

  // ---------------------------------------------------------- dumbbells
  const makeDumbbell = () => {
    const g = new Group();
    cyl(g, DUMBBELL.handleRadius, DUMBBELL.handle + 0.02, [0, 0, 0], 'x', 10);
    for (const s of [1, -1]) {
      const x = s * (DUMBBELL.handle / 2 + DUMBBELL.headLength / 2);
      // Hexagonal heads.
      cyl(g, DUMBBELL.headRadius, DUMBBELL.headLength, [x, 0, 0], 'x', 6);
    }
    return g;
  };
  const dumbbellGroup = group('dumbbells');
  const dumbbells: Record<Side, Group> = { l: makeDumbbell(), r: makeDumbbell() };
  dumbbells.l.name = 'dumbbell-l';
  dumbbells.r.name = 'dumbbell-r';
  dumbbellGroup.add(dumbbells.l, dumbbells.r);
  const singleGroup = group('dumbbell-right');
  const single = makeDumbbell();
  singleGroup.add(single);

  // ------------------------------------------------------------- benches
  const flatBench = (parent: Group, top: number, z0: number, z1: number, x = 0, w = 0.29) => {
    const len = z1 - z0;
    box(parent, [w, 0.06, len], [x, top - 0.03, (z0 + z1) / 2]);
    box(parent, [0.08, 0.05, len - 0.1], [x, top - 0.085, (z0 + z1) / 2]);
    for (const z of [z0 + 0.12, z1 - 0.12]) {
      box(parent, [0.06, top - 0.11, 0.06], [x, (top - 0.11) / 2, z]);
      box(parent, [0.42, 0.04, 0.06], [x, 0.02, z]);
    }
  };
  flatBench(group('bench'), FLAT_BENCH.top, FLAT_BENCH.zHead, FLAT_BENCH.zFoot);

  const benchRack = group('bench-rack');
  for (const s of [1, -1]) {
    const x = s * BENCH_RACK.halfWidth;
    box(benchRack, [0.06, BENCH_RACK.height, 0.06], [x, BENCH_RACK.height / 2, BENCH_RACK.z]);
    box(benchRack, [0.06, 0.04, 0.12], [x, BENCH_RACK.height - 0.1, BENCH_RACK.z + 0.06]);
    box(benchRack, [0.06, 0.06, 0.02], [x, BENCH_RACK.height - 0.07, BENCH_RACK.z + 0.11]);
    box(benchRack, [0.06, 0.04, 0.5], [x, 0.02, BENCH_RACK.z]);
  }

  const incline = group('incline-bench');
  {
    const ib = INCLINE_BENCH;
    const seatLen = ib.seatFront - ib.seatBack;
    box(
      incline,
      [ib.width, 0.06, seatLen],
      [0, ib.seatTop - 0.03, (ib.seatFront + ib.seatBack) / 2],
    );
    const a = (ib.angle * Math.PI) / 180;
    const back = box(incline, [ib.width, 0.06, ib.backLength], [0, 0, 0]);
    const dir = va.set(0, Math.sin(a), -Math.cos(a));
    const nrm = vb.set(0, Math.cos(a), Math.sin(a));
    back.position
      .set(0, ib.seatTop, ib.seatBack)
      .addScaledVector(dir, ib.backLength / 2 + 0.02)
      .addScaledVector(nrm, -0.03);
    back.rotation.x = a;
    box(incline, [0.06, ib.seatTop - 0.06, 0.06], [0, (ib.seatTop - 0.06) / 2, 0.02]);
    tube(incline, 0.025, [0, 0.05, ib.seatBack - 0.55], [0, ib.seatTop + 0.15, ib.seatBack - 0.3]);
    box(incline, [0.42, 0.04, 0.06], [0, 0.02, ib.seatFront]);
    box(incline, [0.42, 0.04, 0.06], [0, 0.02, ib.seatBack - 0.55]);
    box(incline, [0.06, 0.04, 0.9], [0, 0.02, ib.seatBack - 0.15]);
  }

  flatBench(group('row-bench'), ROW_BENCH.top, ROW_BENCH.z0, ROW_BENCH.z1, ROW_BENCH.x);

  const split = group('split-bench');
  {
    const b = SPLIT_BENCH;
    box(split, [b.width, 0.06, b.depth], [0, b.top - 0.03, b.z]);
    for (const x of [-0.16, 0.16])
      box(split, [0.05, b.top - 0.06, 0.05], [x, (b.top - 0.06) / 2, b.z]);
  }

  // ------------------------------------------- half rack with safety arms
  const rack = group('squat-rack');
  {
    const r = SQUAT_RACK;
    for (const x of [-r.halfWidth, r.halfWidth]) {
      box(rack, [0.07, r.height, 0.07], [x, r.height / 2, r.zBack]);
      box(rack, [0.07, 0.05, r.zFront - r.zBack + 0.25], [x, 0.025, (r.zFront + r.zBack) / 2]);
      // Safety arm just below the bottom bar position, J-hook at shoulder height.
      box(
        rack,
        [0.06, 0.06, r.zFront - r.zBack + 0.1],
        [x, r.safety, (r.zFront + r.zBack) / 2 + 0.05],
      );
      box(rack, [0.06, 0.05, 0.14], [x, r.hook, r.zBack + 0.1]);
      box(rack, [0.06, 0.08, 0.02], [x, r.hook + 0.04, r.zBack + 0.16]);
    }
    box(rack, [r.halfWidth * 2, 0.07, 0.07], [0, r.height, r.zBack]);
  }

  // ----------------------------------------------------------- pulldown
  const pull = group('pulldown');
  const pulldownCable = rod(pull, 0.005);
  const latBar = new Group();
  pull.add(latBar);
  {
    const p = PULLDOWN;
    box(pull, [0.4, 0.07, 0.38], [0, p.seatTop - 0.035, p.seatZ]);
    box(pull, [0.07, p.seatTop - 0.07, 0.07], [0, (p.seatTop - 0.07) / 2, p.seatZ]);
    box(pull, [0.08, 0.04, 1.2], [0, 0.02, p.seatZ - 0.2]);
    cyl(pull, 0.055, 0.5, [0, p.padY, p.padZ], 'x', 16);
    box(pull, [0.05, p.padY - 0.05, 0.05], [0, (p.padY - 0.05) / 2, p.padZ - 0.05]);
    // Column with the weight stack and a top beam to the pulley.
    box(pull, [0.5, 2.5, 0.1], [0, 1.25, p.columnZ]);
    for (let i = 0; i < 12; i++)
      box(pull, [0.3, 0.035, 0.08], [0, 0.12 + i * 0.045, p.columnZ + 0.1]);
    box(pull, [0.08, 0.08, p.pulley[2] - p.columnZ + 0.1], [0, 2.5, (p.pulley[2] + p.columnZ) / 2]);
    const wheel = add(pull, new TorusGeometry(0.05, 0.012, 8, 20));
    wheel.position.set(...p.pulley);
    wheel.rotation.y = Math.PI / 2;
    // Lat bar with angled ends.
    cyl(latBar, 0.014, 0.9, [0, 0, 0], 'x', 10);
    for (const s of [1, -1]) {
      const end = cyl(latBar, 0.014, 0.28, [s * 0.57, -0.04, 0], 'x', 10);
      end.rotation.z = Math.PI / 2 + s * 0.3;
    }
  }

  // --------------------------------------------------- cable with rope
  const cable = group('cable-rope');
  const cableLine = rod(cable, 0.005);
  const ropeL = rod(cable, 0.012);
  const ropeR = rod(cable, 0.012);
  {
    box(cable, [0.5, 2.3, 0.12], [0, 1.15, CABLE.columnZ]);
    for (let i = 0; i < 12; i++)
      box(cable, [0.3, 0.035, 0.08], [0, 0.12 + i * 0.045, CABLE.columnZ + 0.1]);
    box(cable, [0.1, 0.1, 0.1], [0, CABLE.pulley[1], CABLE.pulley[2] - 0.04]);
  }

  // ------------------------------------------------------------- floor kit
  const step = group('step');
  box(step, [STEP.width, STEP.top, STEP.depth], [0, STEP.top / 2, STEP.edgeZ + STEP.depth / 2]);

  const treadmill = group('treadmill');
  const slats: Mesh[] = [];
  {
    const t = TREADMILL;
    box(treadmill, [t.width + 0.12, t.deck - 0.01, t.length], [0, (t.deck - 0.01) / 2, t.z]);
    for (let i = 0; i < 10; i++) {
      const s = box(treadmill, [t.width, 0.004, 0.012], [0, t.deck, 0]);
      slats.push(s);
    }
    const front = t.z + t.length / 2;
    for (const x of [-0.36, 0.36]) {
      tube(treadmill, 0.025, [x, t.deck, front - 0.05], [x, 1.18, front + 0.05]);
      tube(treadmill, 0.02, [x, 1.0, front - 0.02], [x, 1.0, front - 0.45]);
    }
    box(treadmill, [0.75, 0.2, 0.06], [0, 1.25, front + 0.06]);
  }

  const bike = group('bike');
  const crank = new Group();
  bike.add(crank);
  {
    const [cx, cy, cz] = BIKE.crankCentre;
    crank.position.set(cx, cy, cz);
    for (const s of [1, -1]) {
      // Crank arms on opposite sides, 180° apart, with pedals.
      const arm = new Group();
      arm.rotation.x = s > 0 ? 0 : Math.PI;
      crank.add(arm);
      box(arm, [0.02, BIKE.crank, 0.03], [s * (BIKE.pedalHalfWidth - 0.04), BIKE.crank / 2, 0]);
      box(arm, [0.09, 0.02, 0.1], [s * BIKE.pedalHalfWidth, BIKE.crank, 0]);
    }
    cyl(bike, 0.25, 0.04, [0, 0.4, 0.45], 'x', 32);
    const [, sy, sz] = BIKE.saddle;
    box(bike, [0.15, 0.05, 0.26], [0, sy - 0.025, sz]);
    tube(bike, 0.022, [0, sy - 0.05, sz + 0.02], [cx, cy, cz]);
    const [, by, bz] = BIKE.bars;
    tube(bike, 0.03, [cx, cy, cz], [0, by - 0.1, bz - 0.12]);
    tube(bike, 0.022, [0, by - 0.1, bz - 0.12], [0, by, bz]);
    cyl(bike, 0.016, BIKE.barHalfWidth * 2 + 0.12, [0, by, bz], 'x', 10);
    tube(bike, 0.03, [0, 0.05, -0.45], [cx, cy, cz]);
    box(bike, [0.5, 0.05, 0.07], [0, 0.025, -0.45]);
    box(bike, [0.5, 0.05, 0.07], [0, 0.025, 0.65]);
    tube(bike, 0.03, [0, 0.05, 0.65], [0, 0.4, 0.45]);
  }

  const mat = group('mat');
  box(mat, [MAT.width, MAT.thickness, MAT.length], [0, MAT.thickness / 2, -0.05]);

  // ------------------------------------------------------------- update
  const handAt = (pose: BodyPose, s: Side, target: Object3D) => {
    gripPoint(pose, s, target.position);
    target.quaternion.setFromUnitVectors(X, gripAxis(pose, s, va));
  };

  return {
    root,
    update(active, frame, pose) {
      for (const [kind, g] of kinds) g.visible = active.includes(kind);

      if (barbell.visible && frame.bar) {
        const b = frame.bar;
        if (b.frame) {
          const i = boneIndex(b.frame);
          worldPoint(pose, { bone: i, rest: vc.set(...b.center) }, bar.position);
          bar.quaternion.copy(pose.rot[i]!);
        } else {
          bar.position.set(...b.center);
          bar.quaternion.identity();
        }
      }
      if (dumbbellGroup.visible) {
        handAt(pose, 'l', dumbbells.l);
        handAt(pose, 'r', dumbbells.r);
      }
      if (singleGroup.visible) handAt(pose, 'r', single);
      if (pull.visible && frame.bar) {
        latBar.position.set(...frame.bar.center);
        stretch(pulldownCable, va.set(...PULLDOWN.pulley), vb.set(...frame.bar.center));
      }
      if (cable.visible && frame.bar) {
        const knot = vc.set(...frame.bar.center);
        const pulley = va.set(...CABLE.pulley);
        knot.addScaledVector(vb.copy(pulley).sub(knot).normalize(), 0.18);
        stretch(cableLine, pulley, knot);
        stretch(ropeL, knot, gripPoint(pose, 'l', vb));
        stretch(ropeR, knot, gripPoint(pose, 'r', vb));
      }
      if (treadmill.visible) {
        const spacing = TREADMILL.length / slats.length;
        const offset = (((frame.belt ?? 0) % spacing) + spacing) % spacing;
        slats.forEach((s, i) => {
          s.position.z = TREADMILL.z + TREADMILL.length / 2 - i * spacing - offset;
        });
      }
      if (bike.visible) crank.rotation.x = frame.crank ?? 0;
    },
    dispose: () => geometries.forEach((g) => g.dispose()),
  };
}

/** Places a unit-height Y cylinder between two points. */
function stretch(mesh: Object3D, a: Vector3, b: Vector3) {
  const d = vd.copy(b).sub(a);
  const len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.copy(len > 1e-6 ? qa.setFromUnitVectors(Y, d.divideScalar(len)) : qa.identity());
  mesh.scale.set(1, Math.max(len, 1e-4), 1);
}
