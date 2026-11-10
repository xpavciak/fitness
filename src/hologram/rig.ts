import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Euler,
  Group,
  Mesh,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { limbDirection, type Clip, type FullPose } from './pose';

/**
 * Procedural humanoid built from capsules and spheres (no external assets).
 * Dimensions are in metres; the figure is ~1.8 m tall and faces +z.
 */
const DIM = {
  hipX: 0.095,
  hipY: -0.05,
  thigh: 0.44,
  shin: 0.43,
  shoulderX: 0.2,
  shoulderY: 0.25,
  upperArm: 0.29,
  forearm: 0.26,
  spineLen: 0.24,
  chestLen: 0.3,
};

const DOWN = new Vector3(0, -1, 0);
const DEG = Math.PI / 180;

interface ArmParts {
  upper: Group;
  fore: Group;
  hand: Object3D;
}

interface LegParts {
  thigh: Group;
  shin: Group;
  foot: Group;
  ankle: Object3D;
}

export interface Rig {
  /** Add this to the scene. */
  container: Group;
  body: Group;
  spine: Group;
  chest: Group;
  neck: Group;
  arms: [ArmParts, ArmParts];
  legs: [LegParts, LegParts];
  groundAnchors: Object3D[];
  props: { barbell: Object3D; dumbbells: Object3D[]; bench: Object3D; seat: Object3D };
  dispose: () => void;
}

export function createRig(bodyMaterial: Material, propMaterial: Material): Rig {
  const geometries: BufferGeometry[] = [];
  const track = <T extends BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };

  /** Capsule hanging down from the parent origin. */
  const limb = (parent: Object3D, radius: number, length: number): void => {
    const mesh = new Mesh(
      track(new CapsuleGeometry(radius, length - radius * 2, 6, 14)),
      bodyMaterial,
    );
    mesh.position.y = -length / 2;
    parent.add(mesh);
  };
  const ball = (parent: Object3D, radius: number, pos: [number, number, number]) => {
    const mesh = new Mesh(track(new SphereGeometry(radius, 20, 14)), bodyMaterial);
    mesh.position.set(...pos);
    parent.add(mesh);
    return mesh;
  };
  /** Invisible marker; `radius` is the body surface distance used for grounding. */
  const anchor = (parent: Object3D, pos: [number, number, number], radius = 0) => {
    const o = new Object3D();
    o.position.set(...pos);
    o.userData.radius = radius;
    parent.add(o);
    return o;
  };

  const container = new Group();
  const body = new Group();
  container.add(body);

  // Pelvis.
  const pelvis = ball(body, 1, [0, 0, 0]);
  pelvis.scale.set(0.16, 0.1, 0.115);

  // Torso.
  const spine = new Group();
  spine.position.y = 0.03;
  body.add(spine);
  const abdomen = new Mesh(track(new CapsuleGeometry(0.115, 0.1, 6, 16)), bodyMaterial);
  abdomen.position.y = 0.12;
  abdomen.scale.set(1.15, 1, 0.85);
  spine.add(abdomen);

  const chest = new Group();
  chest.position.y = DIM.spineLen;
  spine.add(chest);
  const ribcage = ball(chest, 1, [0, 0.14, 0]);
  ribcage.scale.set(0.19, 0.17, 0.125);
  const neck = new Group();
  neck.position.y = DIM.chestLen;
  chest.add(neck);
  limb(neck, 0.045, 0.1);
  const neckMesh = neck.children[0];
  if (neckMesh) neckMesh.position.y = 0.04;
  const head = ball(neck, 1, [0, 0.17, 0.01]);
  head.scale.set(0.095, 0.115, 0.105);
  const headAnchor = anchor(neck, [0, 0.29, 0]);

  const makeArm = (sign: 1 | -1): ArmParts => {
    const shoulder = new Group();
    shoulder.position.set(sign * DIM.shoulderX, DIM.shoulderY, 0);
    chest.add(shoulder);
    ball(shoulder, 0.06, [0, 0, 0]);
    const upper = new Group();
    shoulder.add(upper);
    limb(upper, 0.052, DIM.upperArm);
    const fore = new Group();
    fore.position.y = -DIM.upperArm;
    upper.add(fore);
    ball(fore, 0.045, [0, 0, 0]);
    limb(fore, 0.042, DIM.forearm);
    const hand = anchor(fore, [0, -DIM.forearm - 0.04, 0], 0.048);
    ball(hand, 0.048, [0, 0, 0]);
    return { upper, fore, hand };
  };

  const makeLeg = (sign: 1 | -1): LegParts => {
    const thigh = new Group();
    thigh.position.set(sign * DIM.hipX, DIM.hipY, 0);
    body.add(thigh);
    limb(thigh, 0.075, DIM.thigh);
    const shin = new Group();
    shin.position.y = -DIM.thigh;
    thigh.add(shin);
    ball(shin, 0.06, [0, 0, 0]);
    limb(shin, 0.056, DIM.shin);
    const ankle = anchor(shin, [0, -DIM.shin, 0]);
    const foot = new Group();
    ankle.add(foot);
    const footMesh = new Mesh(track(new BoxGeometry(0.09, 0.06, 0.24)), bodyMaterial);
    footMesh.position.set(0, -0.04, 0.06);
    foot.add(footMesh);
    anchor(foot, [0, -0.07, -0.06]);
    anchor(foot, [0, -0.07, 0.18]);
    return { thigh, shin, foot, ankle };
  };

  const arms: [ArmParts, ArmParts] = [makeArm(1), makeArm(-1)];
  const legs: [LegParts, LegParts] = [makeLeg(1), makeLeg(-1)];

  legs.forEach((l) => (l.shin.userData.radius = 0.06));
  arms.forEach((a) => (a.fore.userData.radius = 0.045));
  const groundAnchors: Object3D[] = [
    // Foot children after the mesh are the heel and toe anchors.
    ...legs.flatMap((l) => [...l.foot.children.slice(1), l.shin]),
    ...arms.flatMap((a) => [a.hand, a.fore]),
    headAnchor,
  ];

  // ---------------------------------------------------------------- props
  const barbell = new Group();
  const bar = new Mesh(track(new CylinderGeometry(0.014, 0.014, 1.9, 8)), propMaterial);
  bar.rotation.z = Math.PI / 2;
  barbell.add(bar);
  for (const x of [-0.72, 0.72]) {
    const plate = new Mesh(track(new CylinderGeometry(0.2, 0.2, 0.06, 28)), propMaterial);
    plate.rotation.z = Math.PI / 2;
    plate.position.x = x;
    barbell.add(plate);
  }
  container.add(barbell);

  const dumbbells: Object3D[] = [];
  for (const arm of arms) {
    const db = new Group();
    const handle = new Mesh(track(new CylinderGeometry(0.014, 0.014, 0.26, 8)), propMaterial);
    handle.rotation.z = Math.PI / 2;
    db.add(handle);
    for (const x of [-0.1, 0.1]) {
      const bell = new Mesh(track(new CylinderGeometry(0.06, 0.06, 0.06, 16)), propMaterial);
      bell.rotation.z = Math.PI / 2;
      bell.position.x = x;
      db.add(bell);
    }
    arm.hand.add(db);
    dumbbells.push(db);
  }

  const bench = new Group();
  const benchTop = new Mesh(track(new BoxGeometry(0.32, 0.08, 1.2)), propMaterial);
  benchTop.position.set(0, 0.46, -0.3);
  bench.add(benchTop);
  for (const z of [-0.8, 0.2]) {
    const leg = new Mesh(track(new BoxGeometry(0.06, 0.42, 0.06)), propMaterial);
    leg.position.set(0, 0.21, z);
    bench.add(leg);
  }
  container.add(bench);

  const seat = new Group();
  const seatTop = new Mesh(track(new BoxGeometry(0.4, 0.06, 0.38)), propMaterial);
  seat.add(seatTop);
  const post = new Mesh(track(new CylinderGeometry(0.03, 0.03, 1, 8)), propMaterial);
  post.position.y = -0.5;
  seat.add(post);
  container.add(seat);

  return {
    container,
    body,
    spine,
    chest,
    neck,
    arms,
    legs,
    groundAnchors,
    props: { barbell, dumbbells, bench, seat },
    dispose: () => geometries.forEach((g) => g.dispose()),
  };
}

const tmpDir = new Vector3();
const tmpQ = new Quaternion();
const tmpInv = new Quaternion();
const tmpEuler = new Euler();
const tmpA = new Vector3();
const tmpB = new Vector3();

function directionQuaternion(out: Quaternion, pitch: number, side: number, sign: 1 | -1) {
  const [x, y, z] = limbDirection(pitch, side, sign);
  return out.setFromUnitVectors(DOWN, tmpDir.set(x, y, z));
}

/** Two-segment limb: upper direction in parent frame, lower direction in the same frame. */
function poseLimb(
  upper: Object3D,
  lower: Object3D,
  upperP: number,
  upperS: number,
  lowerP: number,
  lowerS: number,
  sign: 1 | -1,
): Quaternion {
  directionQuaternion(upper.quaternion, upperP, upperS, sign);
  const lowerAbs = directionQuaternion(new Quaternion(), lowerP, lowerS, sign);
  tmpInv.copy(upper.quaternion).invert();
  lower.quaternion.copy(tmpInv).multiply(lowerAbs);
  return lowerAbs;
}

export function applyPose(rig: Rig, pose: FullPose, clip: Clip): void {
  const { body } = rig;
  body.position.set(pose.rootX, clip.grounded ? 1 : pose.rootY, pose.rootZ);
  body.rotation.set(pose.rootP * DEG, pose.rootYaw * DEG, 0, 'YXZ');
  rig.spine.rotation.set(pose.spineP * DEG, pose.spineT * DEG, pose.spineS * DEG);
  rig.chest.rotation.set(pose.chestP * DEG, 0, 0);
  rig.neck.rotation.set(pose.neckP * DEG, 0, 0);

  const [lArm, rArm] = rig.arms;
  poseLimb(lArm.upper, lArm.fore, pose.lArmP, pose.lArmS, pose.lForeP, pose.lForeS, 1);
  poseLimb(rArm.upper, rArm.fore, pose.rArmP, pose.rArmS, pose.rForeP, pose.rForeS, -1);

  const [lLeg, rLeg] = rig.legs;
  const legs: Array<[LegParts, number, number, number, number, number, 1 | -1]> = [
    [lLeg, pose.lThighP, pose.lThighS, pose.lShinP, pose.lShinS, pose.lFootP, 1],
    [rLeg, pose.rThighP, pose.rThighS, pose.rShinP, pose.rShinS, pose.rFootP, -1],
  ];
  for (const [leg, tp, ts, sp, ss, fp, sign] of legs) {
    const shinAbs = poseLimb(leg.thigh, leg.shin, tp, ts, sp, ss, sign);
    tmpQ.setFromEuler(tmpEuler.set(fp * DEG, 0, 0));
    leg.foot.quaternion.copy(shinAbs.invert()).multiply(tmpQ);
  }

  rig.container.updateMatrixWorld(true);

  if (clip.grounded) {
    let minY = Infinity;
    for (const a of rig.groundAnchors) {
      const radius = typeof a.userData.radius === 'number' ? a.userData.radius : 0;
      minY = Math.min(minY, a.getWorldPosition(tmpA).y - radius);
    }
    body.position.y -= minY;
  }
  if (clip.pinFeetZ !== null) {
    const z = (lLeg.ankle.getWorldPosition(tmpA).z + rLeg.ankle.getWorldPosition(tmpB).z) / 2;
    body.position.z += clip.pinFeetZ - z;
  }
  rig.container.updateMatrixWorld(true);

  updateProps(rig, clip);
}

function updateProps(rig: Rig, clip: Clip): void {
  const { props } = rig;
  const active = new Set(clip.props);
  props.barbell.visible = active.has('barbell');
  props.bench.visible = active.has('bench');
  props.seat.visible = active.has('seat');
  const showDumbbells = active.has('dumbbells');
  props.dumbbells.forEach((db) => (db.visible = showDumbbells));

  if (props.barbell.visible) {
    const l = rig.arms[0].hand.getWorldPosition(tmpA);
    const r = rig.arms[1].hand.getWorldPosition(tmpB);
    props.barbell.position.copy(l).add(r).multiplyScalar(0.5);
    const dir = l.sub(r).normalize();
    props.barbell.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), dir);
  }
  if (props.seat.visible) {
    const p = rig.body.getWorldPosition(tmpA);
    props.seat.position.set(p.x, p.y - 0.13, p.z - 0.02);
  }
}
