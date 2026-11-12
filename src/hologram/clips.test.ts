import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { listExercises } from '../plan';
import type { AnimationId } from '../plan/types';
import { centerOfMass, type Clip, type ClipFrame } from './clipKit';
import { CLIPS, getClip } from './clips';
import { STEP } from './layout';
import { boneIndex, landmark, REST_HEAD, type BoneName } from './skeleton';
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
                : gripPoint(s.pose, side);
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
          expect(distanceToBar(s, gripPoint(s.pose, side)), `${id} ${side}`).toBeLessThan(0.02);
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

  it('bench press: elbows stay roughly 45° from the torso at the bottom', () => {
    const all = samples.get('bench-press')!;
    const bottom = all.reduce((a, b) => (barCenter(b)!.y < barCenter(a)!.y ? b : a));
    const shoulder = bottom.pose.pos[boneIndex('lUpperArm')]!;
    const elbow = bottom.pose.pos[boneIndex('lForeArm')]!;
    const upperArm = elbow.clone().sub(shoulder).setY(0).normalize();
    // Torso axis points towards the feet (+z); abduction angle seen from above.
    const angle = (Math.acos(upperArm.z) * 180) / Math.PI;
    expect(angle).toBeGreaterThan(30);
    expect(angle).toBeLessThan(75);
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
    const all = samples.get('run')!;
    const counts = all.map((s) => s.frame.contacts.length);
    expect(counts).toContain(0); // flight
    expect(Math.max(...counts)).toBe(1); // never both feet down
    const s = all[Math.round(SAMPLES * 0.15)]!;
    const lHand = s.pose.pos[boneIndex('lHand')]!.z;
    const rHand = s.pose.pos[boneIndex('rHand')]!.z;
    const lFoot = s.pose.pos[boneIndex('lFoot')]!.z;
    const rFoot = s.pose.pos[boneIndex('rFoot')]!.z;
    expect(Math.sign(lHand - rHand)).toBe(-Math.sign(lFoot - rFoot));
  });

  it('calf raises stand on the step edge and lift the heels', () => {
    const heights = samples.get('calf-raise')!.map((s) => solePoints(s.pose, 'l')[0].y);
    expect(Math.min(...heights)).toBeLessThan(STEP.top - 0.02); // heel below the step
    expect(Math.max(...heights)).toBeGreaterThan(STEP.top + 0.06);
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
