import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { listExercises } from '../plan';
import type { AnimationId } from '../plan/types';
import { centerOfMass, type Clip, type ClipFrame } from './clipKit';
import { CLIPS, getClip } from './clips';
import { BARBELL, BENCH_RACK, FLAT_BENCH, SQUAT_RACK, STEP } from './layout';
import {
  BONE_NAMES,
  boneIndex,
  landmark,
  REST_HEAD,
  REST_TAIL,
  type BodyPoint,
  type BoneName,
} from './skeleton';
import {
  BodySolver,
  gripPoint,
  palmPoint,
  solePoints,
  worldPoint,
  type ArmIK,
  type BodyPose,
} from './solver';

const SAMPLES = 48;
const ids = Object.keys(CLIPS) as AnimationId[];
const solver = new BodySolver();

interface Sample {
  t: number;
  frame: ClipFrame;
  pose: BodyPose;
}

function sampleClip(clip: Clip, n = SAMPLES): Sample[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (clip.duration * i) / n;
    const frame = clip.frame(t, solver);
    const pose = solver.solve(frame.targets);
    // Copy: the solver reuses its pose object.
    return {
      t,
      frame,
      pose: { rot: pose.rot.map((q) => q.clone()), pos: pose.pos.map((p) => p.clone()) },
    };
  });
}

const samples = new Map(ids.map((id) => [id, sampleClip(CLIPS[id])]));

function barCenter(s: Sample): Vector3 | null {
  const bar = s.frame.bar;
  if (!bar) return null;
  const c = new Vector3(...bar.center);
  return bar.frame ? worldPoint(s.pose, { bone: boneIndex(bar.frame), rest: c }) : c;
}

function barAxis(s: Sample): Vector3 {
  const bar = s.frame.bar;
  const axis = new Vector3(1, 0, 0);
  return bar?.frame ? axis.applyQuaternion(s.pose.rot[boneIndex(bar.frame)]!) : axis;
}

/** Distance of a point from the bar's axis line. */
function distanceToBar(s: Sample, p: Vector3): number {
  const c = barCenter(s)!;
  const d = p.clone().sub(c);
  return d.sub(barAxis(s).multiplyScalar(d.dot(barAxis(s)))).length();
}

describe('clip library', () => {
  it('has a clip for every animation id used by the exercises', () => {
    for (const ex of listExercises()) expect(CLIPS[ex.animation], ex.id).toBeDefined();
  });

  it('every clip has a positive duration and produces finite poses', () => {
    for (const id of ids) {
      expect(CLIPS[id].duration, id).toBeGreaterThan(0);
      for (const s of samples.get(id)!) {
        for (const p of s.pose.pos) expect(Number.isFinite(p.x + p.y + p.z), id).toBe(true);
        for (const q of s.pose.rot) {
          expect(Number.isFinite(q.x + q.y + q.z + q.w), id).toBe(true);
          expect(q.length(), id).toBeCloseTo(1, 4);
        }
        expect(s.frame.breath, id).toBeGreaterThanOrEqual(0);
        expect(s.frame.breath, id).toBeLessThanOrEqual(1);
      }
    }
  });

  it('every clip actually moves', () => {
    for (const id of ids) {
      const all = samples.get(id)!;
      // Holds (planks) only breathe, so a smaller threshold applies to them.
      const breathes = Math.max(...all.map((s) => s.frame.breath)) > 0.6;
      const limit = (breathes && id.includes('plank') ? 0.5 : 3) * (Math.PI / 180);
      const moved = all.some((s) =>
        s.pose.rot.some((q, i) => q.angleTo(all[0]!.pose.rot[i]!) > limit),
      );
      expect(moved, `${id} should animate`).toBe(true);
    }
  });

  it('loops without a visible jump (except clips that fade out and back in)', () => {
    for (const id of ids) {
      const clip = CLIPS[id];
      const end = clip.frame(clip.duration - 1e-3, solver);
      if ((end.opacity ?? 1) < 0.05) continue;
      const a = solver.solve(end.targets);
      const endPos = a.pos.map((p) => p.clone());
      const b = solver.solve(clip.frame(0, solver).targets);
      const jump = Math.max(...endPos.map((p, i) => p.distanceTo(b.pos[i]!)));
      expect(jump, id).toBeLessThan(0.02);
    }
  });
});

describe('joint continuity and orientation', () => {
  const STEP_S = 1 / 120;
  const MAX_STEP_DEG = 15;

  /** World rotation change of every bone between consecutive 120 Hz frames. */
  it('no bone rotates more than 15° between two frames at 120 fps (no IK flips)', () => {
    const angle = (a: Quaternion, b: Quaternion) =>
      (2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180) / Math.PI;
    for (const id of ids) {
      const clip = CLIPS[id];
      const steps = Math.round(clip.duration / STEP_S);
      let prev: Quaternion[] | null = null;
      let prevVisible = false;
      for (let i = 0; i <= steps; i++) {
        // The last step wraps around to the start of the loop.
        const t = (i * STEP_S) % clip.duration;
        const frame = clip.frame(t, solver);
        const rot = solver.solve(frame.targets).rot.map((q) => q.clone());
        // Clips that fade out and back in may jump while invisible.
        const visible = (frame.opacity ?? 1) > 0.99;
        if (prev && visible && prevVisible) {
          rot.forEach((q, b) => {
            const d = angle(q, prev![b]!);
            if (d > MAX_STEP_DEG) {
              expect.fail(`${id} ${BONE_NAMES[b]} turns ${d.toFixed(1)}° at ${t.toFixed(3)} s`);
            }
          });
        }
        prev = rot;
        prevVisible = visible;
      }
    }
  });

  /** Bend (degrees) of a hinge joint and the direction its front/back faces. */
  function hinge(s: Sample, root: BoneName, mid: BoneName, end: BoneName) {
    const a = s.pose.pos[boneIndex(root)]!;
    const b = s.pose.pos[boneIndex(mid)]!;
    const c = s.pose.pos[boneIndex(end)]!;
    const upper = b.clone().sub(a).normalize();
    const lower = c.clone().sub(b).normalize();
    // Points away from the inside of the bend (where kneecap / olecranon go).
    const outside = upper.clone().sub(lower).normalize();
    // Direction of a landmark on the lower bone, seen across the bone (its
    // offset along the bone says nothing about where the joint faces).
    const facing = (p: BodyPoint) => {
      const d = worldPoint(s.pose, p).sub(b);
      return d.addScaledVector(lower, -d.dot(lower)).normalize();
    };
    return { bend: (upper.angleTo(lower) * 180) / Math.PI, outside, facing };
  }

  it('bent knees point forward, never backwards', () => {
    for (const id of ids) {
      for (const s of samples.get(id)!) {
        const hipsForward = new Vector3(0, 0, 1).applyQuaternion(s.pose.rot[0]!);
        for (const side of ['l', 'r'] as const) {
          const k = hinge(s, `${side}Thigh`, `${side}Shin`, `${side}Foot`);
          if (k.bend < 20) continue;
          const front = k.facing(landmark(`${side}KneeFront`));
          const where = `${id} ${side} knee at ${s.t.toFixed(2)} s`;
          expect(front.dot(k.outside), `${where} (outside)`).toBeGreaterThan(0);
          // Straight down is fine (rear knee of a lunge), backwards is not.
          expect(front.dot(hipsForward), where).toBeGreaterThan(-0.3);
        }
      }
    }
  });

  it('bent elbows bend the anatomical way (upper arm not twisted around)', () => {
    // Where the rest elbow sticks out from the shoulder-wrist line, carried by
    // the upper arm (the forearm also pronates, so its landmarks can't tell).
    const restOut = (side: 'l' | 'r') => {
      const sh = REST_HEAD[boneIndex(`${side}UpperArm`)]!;
      const el = REST_HEAD[boneIndex(`${side}ForeArm`)]!.clone().sub(sh);
      const line = REST_HEAD[boneIndex(`${side}Hand`)]!.clone().sub(sh).normalize();
      return el.addScaledVector(line, -el.dot(line)).normalize();
    };
    for (const id of ids) {
      for (const s of samples.get(id)!) {
        for (const side of ['l', 'r'] as const) {
          const e = hinge(s, `${side}UpperArm`, `${side}ForeArm`, `${side}Hand`);
          if (e.bend < 20) continue;
          const back = restOut(side).applyQuaternion(s.pose.rot[boneIndex(`${side}UpperArm`)]!);
          expect(back.dot(e.outside), `${id} ${side} elbow at ${s.t.toFixed(2)} s`).toBeGreaterThan(
            0,
          );
        }
      }
    }
  });
});

describe('contacts (IK keeps hands and feet where they belong)', () => {
  it('soles stay on their support surface (within 1 cm) and never sink into it', () => {
    for (const id of ids) {
      for (const s of samples.get(id)!) {
        for (const c of s.frame.contacts) {
          if (c.kind !== 'sole') continue;
          const [heel, ball, toe] = solePoints(s.pose, c.side).map((p) => p.y) as [
            number,
            number,
            number,
          ];
          const label = `${id} ${c.side} sole @${s.t.toFixed(2)}s`;
          // Some part of the sole touches the surface...
          const gap = Math.min(...[heel, ball, toe].map((y) => Math.abs(y - c.y)));
          expect(gap, label).toBeLessThan(0.01);
          // ...and the forefoot never sinks into it (a heel may hang off a step edge).
          expect(Math.min(ball, toe), label).toBeGreaterThan(c.y - 0.01);
        }
        // No foot may go through the floor in any frame.
        for (const side of ['l', 'r'] as const) {
          const ys = solePoints(s.pose, side).map((p) => p.y);
          expect(Math.min(...ys), `${id} ${side} below floor`).toBeGreaterThan(-0.01);
        }
      }
    }
  });

  it('planted feet do not slide', () => {
    const planted: AnimationId[] = [
      'squat',
      'squat-dumbbells',
      'squat-hold',
      'hinge',
      'hinge-dumbbells',
      'overhead-press',
      'overhead-press-dumbbells',
      'row',
      'row-dumbbells',
      'curl',
      'lateral-raise',
      'rear-delt-fly',
      'mobility',
      'bench-press',
      'bench-press-dumbbells',
      'incline-press',
      'pulldown',
    ];
    for (const id of planted) {
      const all = samples.get(id)!;
      for (const side of ['l', 'r'] as const) {
        const ref = solePoints(all[0]!.pose, side)[1];
        for (const s of all) {
          const ball = solePoints(s.pose, side)[1];
          expect(Math.hypot(ball.x - ref.x, ball.z - ref.z), `${id} ${side}`).toBeLessThan(0.01);
        }
      }
    }
  });

  it('every IK hand target is reached within 2 cm', () => {
    for (const id of ids) {
      for (const s of samples.get(id)!) {
        for (const side of ['l', 'r'] as const) {
          const arm = s.frame.targets.arms[side];
          if ('fk' in arm) continue;
          const ik = arm as ArmIK;
          const target = new Vector3(...ik.grip);
          if (ik.frame) {
            const b = boneIndex(ik.frame);
            target.sub(REST_HEAD[b]!).applyQuaternion(s.pose.rot[b]!).add(s.pose.pos[b]!);
          }
          const reached =
            ik.point === 'palm'
              ? palmPoint(s.pose, side)
              : ik.point === 'wrist'
                ? s.pose.pos[boneIndex(`${side}Hand` as BoneName)]!
                : gripPoint(s.pose, side, undefined, ik.point === 'heel' ? 'heel' : 'grip');
          expect(reached.distanceTo(target), `${id} ${side} hand @${s.t.toFixed(2)}s`).toBeLessThan(
            0.02,
          );
        }
      }
    }
  });

  it('both hands stay on the bar in every barbell and cable-bar clip', () => {
    for (const id of [
      'squat',
      'hinge',
      'bench-press',
      'overhead-press',
      'row',
      'pulldown',
    ] as const) {
      for (const s of samples.get(id)!) {
        expect(barCenter(s), id).not.toBeNull();
        for (const side of ['l', 'r'] as const) {
          const arm = s.frame.targets.arms[side] as ArmIK;
          const hand = gripPoint(s.pose, side, undefined, arm.point === 'heel' ? 'heel' : 'grip');
          expect(distanceToBar(s, hand), `${id} ${side}`).toBeLessThan(0.02);
        }
      }
    }
  });

  it('flat hands and knees rest on the floor in floor exercises', () => {
    for (const id of ['push-up', 'high-plank', 'cat-cow', 'lunge-rotation'] as const) {
      for (const s of samples.get(id)!) {
        for (const side of ['l', 'r'] as const) {
          const arm = s.frame.targets.arms[side];
          if ('fk' in arm || arm.point !== 'palm') continue;
          expect(Math.abs(palmPoint(s.pose, side).y), `${id} ${side} palm`).toBeLessThan(0.01);
        }
      }
    }
    for (const s of samples.get('cat-cow')!) {
      for (const name of ['lKneeFront', 'rKneeFront'] as const) {
        expect(worldPoint(s.pose, landmark(name)).y, name).toBeLessThan(0.05);
        expect(worldPoint(s.pose, landmark(name)).y, name).toBeGreaterThan(-0.01);
      }
    }
  });
});

describe('biomechanics', () => {
  const midfoot = (pose: BodyPose) => (solePoints(pose, 'l')[0].z + solePoints(pose, 'l')[1].z) / 2;

  it('squat: bar moves vertically over the mid-foot and reaches parallel depth', () => {
    const all = samples.get('squat')!;
    for (const s of all) {
      expect(Math.abs(barCenter(s)!.z - midfoot(s.pose)), `@${s.t}`).toBeLessThan(0.03);
    }
    const hip = (s: Sample) => s.pose.pos[boneIndex('lThigh')]!.y;
    const knee = (s: Sample) => s.pose.pos[boneIndex('lShin')]!.y;
    const bottom = all.reduce((a, b) => (hip(b) < hip(a) ? b : a));
    expect(hip(bottom)).toBeLessThan(knee(bottom) + 0.02);
  });

  it('squat: the bar clears the safety arms by 1–6 cm at the bottom', () => {
    // Fine sampling to catch the true lowest point.
    const clip = getClip('squat');
    let lowest = Infinity;
    for (let t = 0; t < clip.duration; t += 1 / 60) {
      const s = { t, frame: clip.frame(t, solver), pose: solver.pose } as Sample;
      s.pose = solver.solve(s.frame.targets);
      lowest = Math.min(lowest, barCenter(s)!.y - BARBELL.shaftRadius);
    }
    const gap = lowest - SQUAT_RACK.safetyTop;
    expect(gap).toBeGreaterThan(0.01);
    expect(gap).toBeLessThan(0.06);
  });

  it('squat: tempo is ~3 s down, a pause and a faster drive up', () => {
    const clip = getClip('squat');
    const depthAt = (t: number) => solver.solve(clip.frame(t, solver).targets).pos[0]!.y;
    const top = depthAt(0.3);
    const bottom = depthAt(4.0);
    expect(depthAt(2.1)).toBeLessThan(top - 0.1); // still descending mid-way
    expect(depthAt(2.1)).toBeGreaterThan(bottom + 0.05);
    expect(Math.abs(depthAt(3.8) - depthAt(4.4))).toBeLessThan(0.005); // pause
    expect(depthAt(5.6)).toBeGreaterThan(top - 0.02); // back up within ~0.9 s
  });

  it('bench press: bar touches the lower chest and locks out over the shoulders', () => {
    const all = samples.get('bench-press')!;
    const sternum = landmark('sternum');
    const minGap = Math.min(
      ...all.map((s) => barCenter(s)!.distanceTo(worldPoint(s.pose, sternum))),
    );
    expect(minGap).toBeLessThan(0.05);
    const top = all.reduce((a, b) => (barCenter(b)!.y > barCenter(a)!.y ? b : a));
    const shoulderZ = top.pose.pos[boneIndex('lUpperArm')]!.z;
    expect(Math.abs(barCenter(top)!.z - shoulderZ)).toBeLessThan(0.05);
  });

  it('bench press: elbows ~45° from the torso and only slightly below the bench at the bottom', () => {
    const all = samples.get('bench-press')!;
    const bottom = all.reduce((a, b) => (barCenter(b)!.y < barCenter(a)!.y ? b : a));
    for (const side of ['l', 'r'] as const) {
      const shoulder = bottom.pose.pos[boneIndex(`${side}UpperArm`)]!;
      const elbow = bottom.pose.pos[boneIndex(`${side}ForeArm`)]!;
      const upperArm = elbow.clone().sub(shoulder).normalize();
      // Torso axis points towards the feet (+z); abduction angle seen from above.
      const flat = upperArm.clone().setY(0).normalize();
      const abduction = (Math.acos(flat.z) * 180) / Math.PI;
      expect(abduction, side).toBeGreaterThan(30);
      expect(abduction, side).toBeLessThan(55);
      // Elbows dip below the bench plane, but not far (bar sits in the palm heel).
      const drop = (Math.asin(-upperArm.y) * 180) / Math.PI;
      expect(drop, side).toBeGreaterThan(5);
      expect(drop, side).toBeLessThan(40);
      // Bar low in the palm: within ~8 cm of the wrist joint.
      const wrist = bottom.pose.pos[boneIndex(`${side}Hand`)]!;
      expect(distanceToBar(bottom, wrist), side).toBeLessThan(0.08);
    }
  });

  it('bench press: the head rests fully on the pad and the eyes are under the racked bar', () => {
    const head = boneIndex('head');
    const rackedBarZ = BENCH_RACK.z + 0.06;
    for (const s of samples.get('bench-press')!) {
      const back = worldPoint(s.pose, landmark('headBack'));
      // Landmark ~1.5 cm above the lowest skin (skinned check in controller.test).
      expect(back.y - FLAT_BENCH.top, `@${s.t}`).toBeGreaterThan(0.01);
      expect(back.y - FLAT_BENCH.top, `@${s.t}`).toBeLessThan(0.025);
      const crown = worldPoint(s.pose, { bone: head, rest: REST_TAIL[head]! });
      expect(crown.z - FLAT_BENCH.zHead, `@${s.t}`).toBeGreaterThan(0.05);
      const eyes = worldPoint(s.pose, { bone: head, rest: new Vector3(0, 1.67, 0.1) });
      expect(Math.abs(eyes.z - rackedBarZ), `@${s.t}`).toBeLessThan(0.06);
    }
  });

  it('Romanian deadlift: hips hinge back while the knees stay soft', () => {
    const all = samples.get('hinge')!;
    const hipZ = all.map((s) => s.pose.pos[0]!.z);
    expect(Math.max(...hipZ) - Math.min(...hipZ)).toBeGreaterThan(0.12);
    for (const s of all) {
      const thigh = s.pose.pos[boneIndex('lShin')]!.clone().sub(s.pose.pos[boneIndex('lThigh')]!);
      const shin = s.pose.pos[boneIndex('lFoot')]!.clone().sub(s.pose.pos[boneIndex('lShin')]!);
      const knee = (thigh.angleTo(shin) * 180) / Math.PI;
      expect(knee).toBeLessThan(35);
    }
  });

  it('standing lifts keep the centre of mass over the feet', () => {
    for (const id of ['squat', 'hinge', 'overhead-press', 'curl'] as const) {
      for (const s of samples.get(id)!) {
        const com = centerOfMass(s.pose);
        const [heel] = solePoints(s.pose, 'l');
        const ball = solePoints(s.pose, 'l')[2];
        expect(com.z, id).toBeGreaterThan(heel.z - 0.08);
        expect(com.z, id).toBeLessThan(ball.z + 0.02);
      }
    }
  });

  it('running alternates feet with a flight phase and opposite arm swing', () => {
    for (const id of ['run', 'run-intervals'] as const) {
      const all = samples.get(id)!;
      const counts = all.map((s) => s.frame.contacts.length);
      expect(counts, id).toContain(0); // flight
      expect(Math.max(...counts), id).toBe(1); // never both feet down
      // Just after left touchdown: left foot forward, left hand back.
      const s = all[1]!;
      const lHand = s.pose.pos[boneIndex('lHand')]!.z;
      const rHand = s.pose.pos[boneIndex('rHand')]!.z;
      const lFoot = s.pose.pos[boneIndex('lFoot')]!.z;
      const rFoot = s.pose.pos[boneIndex('rFoot')]!.z;
      expect(lFoot - rFoot, id).toBeGreaterThan(0.2);
      expect(Math.sign(lHand - rHand), id).toBe(-1);
    }
  });

  it('interval running is faster than the easy run: higher cadence, longer stride', () => {
    const stride = (id: 'run' | 'run-intervals') => {
      const clip = CLIPS[id];
      // Belt travel per stride = stride length.
      return clip.frame(clip.duration * 0.999, solver).belt! - clip.frame(0, solver).belt!;
    };
    const cadence = (id: 'run' | 'run-intervals') => (2 * 60) / CLIPS[id].duration;
    expect(cadence('run')).toBeGreaterThan(155);
    expect(cadence('run')).toBeLessThan(172);
    expect(cadence('run-intervals')).toBeGreaterThan(cadence('run') + 10);
    expect(stride('run-intervals')).toBeGreaterThan(stride('run') * 1.3);
  });

  it('calf raises stand on the step edge and lift the heels', () => {
    const heights = samples.get('calf-raise')!.map((s) => solePoints(s.pose, 'l')[0].y);
    expect(Math.min(...heights)).toBeLessThan(STEP.top - 0.02); // heel below the step
    expect(Math.max(...heights)).toBeGreaterThan(STEP.top + 0.06);
  });
});

describe('stage', () => {
  it('the visible figure stays on the projector disc (radius 1.05 m) in every clip', () => {
    for (const id of ids) {
      for (const s of samples.get(id)!) {
        if ((s.frame.opacity ?? 1) < 0.05) continue;
        const points = [
          ...solePoints(s.pose, 'l'),
          ...solePoints(s.pose, 'r'),
          gripPoint(s.pose, 'l'),
          gripPoint(s.pose, 'r'),
          s.pose.pos[0]!,
        ];
        for (const p of points) {
          expect(Math.hypot(p.x, p.z), `${id} @${s.t.toFixed(2)}`).toBeLessThan(0.95);
        }
      }
    }
  });
});

describe('equipment', () => {
  it('shows props that match each exercise’s equipment', () => {
    for (const ex of listExercises()) {
      const props = getClip(ex.animation).props;
      const equipment = (ex.equipment.toLowerCase().split(' alebo ')[0] ?? '').trim();
      if (equipment.startsWith('bez náradia')) expect(props, ex.id).toEqual([]);
      if (equipment.startsWith('veľká činka')) expect(props, ex.id).toContain('barbell');
      if (equipment.includes('stojan')) {
        expect(props.some((p) => p.endsWith('rack'))).toBe(true);
      }
      if (/jednoručk/.test(equipment)) {
        expect(
          props.some((p) => p === 'dumbbells' || p === 'dumbbell-right'),
          ex.id,
        ).toBe(true);
      }
      if (/lavic/.test(equipment))
        expect(
          props.some((p) => p.endsWith('bench')),
          ex.id,
        ).toBe(true);
      if (/kladk/.test(equipment)) {
        expect(
          props.some((p) => p === 'pulldown' || p === 'cable-rope'),
          ex.id,
        ).toBe(true);
      }
      if (equipment.startsWith('podložka')) expect(props, ex.id).toContain('mat');
    }
  });

  it('uses dedicated clips for the reviewed mismatches', () => {
    const anim = (id: string) => listExercises().find((e) => e.id === id)?.animation;
    expect(anim('deep-squat-hold')).toBe('squat-hold');
    expect(anim('worlds-greatest-stretch')).toBe('lunge-rotation');
    expect(anim('incline-dumbbell-press')).toBe('incline-press');
    expect(anim('one-arm-dumbbell-row')).toBe('one-arm-row');
    expect(anim('bulgarian-split-squat')).toBe('split-squat-bench');
    expect(getClip('one-arm-row').props).toEqual(['row-bench', 'dumbbell-right']);
  });
});
