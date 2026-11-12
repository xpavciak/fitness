import { Vector3 } from 'three';
import type { AnimationId } from '../plan/types';
import {
  balance,
  breathing,
  flatFoot,
  handLoad,
  handsLoad,
  kneeOverToes,
  plantedLeg,
  shoulders,
  solveMonotonic,
  soles,
  sx,
  type Clip,
  type Contact,
  type Load,
} from './clipKit';
import {
  BIKE,
  FLAT_BENCH,
  INCLINE_BENCH,
  PULLDOWN,
  ROW_BENCH,
  SPLIT_BENCH,
  STEP,
  TREADMILL,
} from './layout';
import { ease, loopSpline, mix, track, wrapTime, type Ease } from './motion';
import { ARM_REACH, LIMB, boneIndex, landmark, type Side } from './skeleton';
import {
  worldPoint,
  type ArmTarget,
  type BodyPose,
  type BodySolver,
  type BodyTargets,
  type LegTarget,
  type Vec,
} from './solver';

/**
 * Exercise clips. Each clip describes the body per frame (hips, spine, where
 * hands grip and feet stand); the solver turns that into bone rotations.
 * Tempos follow the coaching cues in the exercise library (e.g. 3 s eccentric,
 * pause, explosive concentric, short rest at the top between reps).
 */

const tmp = new Vector3();
const tmp2 = new Vector3();
const CHEST = boneIndex('chest');
const both = <T>(f: (s: Side) => T): Record<Side, T> => ({ l: f('l'), r: f('r') });

/** Phase-shaped track: list of [seconds, value, ease] tuples. */
function keys(duration: number, ...k: [number, number, Ease?][]): (t: number) => number {
  return track(
    duration,
    k.map(([at, value, e]) => ({ at, value, ease: e })),
  );
}

// ------------------------------------------------------------------ arms
/** Relaxed arms hanging under the shoulders; `incline` = trunk pitch. */
function hangingArm(s: Side, incline = 0, abduct = 7, bend = 10, palm?: Vec): ArmTarget {
  return {
    fk: { upper: [incline - 2, abduct], fore: [incline + bend, abduct - 1] },
    palm: palm ?? [sx(s, -1), 0, 0.15],
    fingers: 0.3,
  };
}

/** Arm holding a dumbbell hanging at the side (neutral grip). */
function dumbbellArm(s: Side, incline = 0, abduct = 9, palm?: Vec): ArmTarget {
  return { ...hangingArm(s, incline, abduct, 6, palm), fingers: 1 };
}

const standingLegs = (x = 0.13, z = 0.1, out = 8): Record<Side, LegTarget> =>
  both((s) => plantedLeg(s, x, z, out));

/** Mid-foot z for a flat foot whose ball is at `ballZ`. */
const midfoot = (ballZ: number) => ballZ - 0.1;

// ------------------------------------------------------------- squats
const TRAPS = landmark('traps').rest;
const HIGH_BAR: Vec = [0, TRAPS.y + 0.006, TRAPS.z - 0.024];
const barOnBack = (mass: number): Load => ({
  mass,
  at: (pose, out) => worldPoint(pose, { bone: CHEST, rest: out.set(...HIGH_BAR) }, out),
});

/** Back squat with a barbell or dumbbells resting on the shoulders. */
function squat(kind: 'barbell' | 'dumbbells'): Clip {
  // 0.6 s brace at the top, 3 s down, 1 s pause, explosive up, exhale.
  const duration = 6.4;
  const depth = keys(
    duration,
    [0, 0],
    [0.6, 0],
    [3.6, 1, 'controlled'],
    [4.6, 1],
    [5.5, 0, 'explosive'],
  );
  const breath = keys(duration, [0, 0.15], [0.6, 1], [4.6, 0.85], [5.9, 0.1]);
  const out = 18;
  const ballZ = 0.1;
  const barbell = kind === 'barbell';
  const arms: Record<Side, ArmTarget> = barbell
    ? both((s) => ({
        frame: 'chest',
        grip: [sx(s, 0.4), HIGH_BAR[1], HIGH_BAR[2]],
        across: [sx(s, 1), 0, 0],
        elbow: [sx(s, 0.35), -1, -0.45],
        fingers: 1,
      }))
    : both((s) => ({
        frame: 'chest',
        grip: [sx(s, 0.19), 1.45, 0.1],
        across: [0, 0.25, 1],
        elbow: [sx(s, 0.45), -0.5, 1],
        fingers: 1,
      }));
  return {
    duration,
    props: barbell ? ['barbell', 'squat-rack'] : ['dumbbells'],
    frame: (t, solver) => {
      const d = depth(t);
      const targets: BodyTargets = {
        hips: { pos: [0, mix(1.0, 0.47, d), mix(-0.02, -0.22, d)], pitch: mix(4, 44, d) },
        spine: { pitch: mix(0, 8, d) },
        chest: { pitch: mix(-3, -9, d) - breath(t) * 2 },
        gaze: [0, 0.6, 3],
        legs: both((s) => ({
          foot: flatFoot(s, 0.2, ballZ, out),
          knee: kneeOverToes(s, out + 4),
        })),
        arms,
        retract: 6,
        reach: true,
      };
      // Barbell: the bar stays over the mid-foot; dumbbells: combined centre of mass.
      if (barbell) balance(solver, targets, midfoot(ballZ), [], null, barOnBack(1).at);
      else balance(solver, targets, midfoot(ballZ), [handsLoad(0.35)]);
      return {
        targets,
        bar: barbell ? { center: HIGH_BAR, frame: 'chest' } : undefined,
        breath: breath(t),
        contacts: soles(),
      };
    },
  };
}

/** Deep bodyweight squat hold, elbows pushing the knees out, slow breathing. */
function squatHold(): Clip {
  const duration = 5;
  const out = 24;
  return {
    duration,
    props: [],
    frame: (t, solver) => {
      const b = breathing(t, duration);
      const targets: BodyTargets = {
        hips: { pos: [0, 0.37 - (1 - b) * 0.015, -0.12], pitch: 28 - b * 2 },
        spine: { pitch: 14 - b * 4 },
        chest: { pitch: -8 - b * 3 },
        gaze: [0, 0.9, 3],
        legs: both((s) => ({ foot: flatFoot(s, 0.24, 0.12, out), knee: kneeOverToes(s, out + 6) })),
        arms: both((s) => ({
          grip: [sx(s, 0.012), 0.58, 0.3],
          point: 'palm',
          palm: [sx(s, -1), 0, 0],
          hand: [0, 1, 0.15],
          elbow: [sx(s, 0.7), -0.7, 0.1],
          fingers: 0.05,
        })),
        reach: true,
      };
      balance(solver, targets, midfoot(0.12));
      return { targets, breath: b, contacts: soles() };
    },
  };
}

// --------------------------------------------------------------- hinges
/** Romanian deadlift: hips back, soft knees, bar sliding down the thighs. */
function hinge(kind: 'barbell' | 'dumbbells'): Clip {
  const duration = 6.2;
  const h = keys(duration, [0, 0], [0.7, 0], [3.7, 1, 'controlled'], [4.2, 1], [5.6, 0, 'inOut']);
  const breath = keys(duration, [0, 0.2], [0.7, 1], [4.2, 0.8], [5.9, 0.1]);
  const ballZ = 0.1;
  const barZ = midfoot(ballZ) + 0.03;
  const gripX = kind === 'barbell' ? 0.24 : 0.16;
  return {
    duration,
    props: kind === 'barbell' ? ['barbell'] : ['dumbbells'],
    frame: (t, solver) => {
      const k = h(t);
      const pitch = mix(2, 70, k);
      const targets: BodyTargets = {
        hips: { pos: [0, mix(0.93, 0.885, k), mix(-0.04, -0.2, k)], pitch },
        spine: { pitch: mix(0, 5, k) },
        chest: { pitch: -3 },
        head: { pitch: mix(-4, -16, k) },
        legs: standingLegs(0.12, ballZ, 6),
        arms: both((s) => hangingArm(s, pitch + 2, 8, 2)),
        retract: 8,
        reach: true,
      };
      // Centre of mass (bar over the mid-foot) and arms hanging to the bar.
      balance(solver, targets, midfoot(ballZ));
      const sh = shoulders(solver.solve(targets), tmp);
      const dz = sh.z - barZ;
      const barY = sh.y - Math.sqrt(Math.max(0.01, (ARM_REACH * 0.985) ** 2 - dz * dz - 0.02));
      targets.arms = both((s) => ({
        grip: [sx(s, gripX), barY, barZ],
        across: [sx(s, 1), 0, 0],
        elbow: [sx(s, 0.4), 0, -1],
        fingers: 1,
      }));
      return {
        targets,
        bar: kind === 'barbell' ? { center: [0, barY, barZ] } : undefined,
        breath: breath(t),
        contacts: soles(),
      };
    },
  };
}

/** Bent-over row (barbell or dumbbells): bar from hang to the lower belly. */
function row(kind: 'barbell' | 'dumbbells'): Clip {
  const duration = 3.8;
  const pull = keys(duration, [0, 0], [0.9, 1, 'explosive'], [1.4, 1], [3.4, 0, 'controlled']);
  const ballZ = 0.1;
  const pitch = 40;
  const gripX = kind === 'barbell' ? 0.25 : 0.2;
  return {
    duration,
    props: kind === 'barbell' ? ['barbell'] : ['dumbbells'],
    frame: (t, solver) => {
      const k = pull(t);
      const targets: BodyTargets = {
        hips: { pos: [0, 0.86, -0.16], pitch },
        spine: { pitch: 6 - k * 3 },
        chest: { pitch: -4 },
        head: { pitch: -18 },
        legs: standingLegs(0.13, ballZ, 8),
        arms: both((s) => hangingArm(s, pitch + 6, 8, 2)),
        retract: mix(-4, 12, k),
        reach: true,
      };
      balance(solver, targets, midfoot(ballZ), [handsLoad(0.45)]);
      const pose = solver.solve(targets);
      const sh = shoulders(pose, tmp);
      // Hang: straight arms under the shoulders. Top: bar at the lower belly.
      const hang = tmp2.set(0, sh.y - ARM_REACH * 0.97, sh.z + 0.05);
      const belly = worldPoint(
        pose,
        { bone: boneIndex('spine1'), rest: new Vector3(0, 1.0, 0.16) },
        new Vector3(),
      );
      const c: Vec = [
        0,
        mix(hang.y, belly.y - 0.02, k),
        mix(hang.z, belly.z, ease('out', k)) + Math.sin(k * Math.PI) * 0.03,
      ];
      targets.arms = both((s) =>
        kind === 'barbell'
          ? {
              grip: [sx(s, gripX), c[1], c[2]],
              across: [sx(s, 1), 0, 0],
              elbow: [sx(s, 0.35), 0.3, -1],
              fingers: 1,
            }
          : {
              grip: [sx(s, mix(gripX, 0.2, k)), c[1], c[2] - 0.04 * k],
              across: [sx(s, 0.25), 0, -1],
              elbow: [sx(s, 0.2), 0.3, -1],
              fingers: 1,
            },
      );
      return {
        targets,
        bar: kind === 'barbell' ? { center: c } : undefined,
        breath: 1 - k * 0.7,
        contacts: soles(),
      };
    },
  };
}

// ------------------------------------------------------- lying presses
const STERNUM = landmark('sternum');
const UPPER_BACK = landmark('upperBack');
const GLUTES = landmark('glutes');

/**
 * Lowers/tilts the body until the glutes and upper back rest on a plane
 * (bench pad). `pitch` rotation tilts the trunk about the hips.
 */
function restOnPlane(
  solver: BodySolver,
  targets: BodyTargets,
  point: Vec,
  normal: Vec,
): BodyTargets {
  const n = new Vector3(...normal).normalize();
  const p0 = new Vector3(...point);
  const dist = (pose: BodyPose, l: typeof GLUTES) => worldPoint(pose, l, tmp).sub(p0).dot(n);
  for (let k = 0; k < 4; k++) {
    const pose = solver.solve(targets);
    const g = dist(pose, GLUTES);
    const b = dist(pose, UPPER_BACK);
    const span = worldPoint(pose, GLUTES, tmp2).distanceTo(worldPoint(pose, UPPER_BACK, tmp));
    const p = targets.hips.pos;
    targets.hips = {
      ...targets.hips,
      pos: [p[0] - n.x * g, p[1] - n.y * g, p[2] - n.z * g],
      pitch: (targets.hips.pitch ?? 0) - (Math.atan2(b - g, span) * 180) / Math.PI,
    };
  }
  return targets;
}

/** Flat barbell or dumbbell bench press, incline dumbbell press. */
function press(kind: 'bench' | 'bench-dumbbells' | 'incline'): Clip {
  // 2.4 s lowering, light touch, explosive press, lockout.
  const duration = 4.6;
  const down = keys(
    duration,
    [0, 0],
    [0.5, 0],
    [2.9, 1, 'controlled'],
    [3.2, 1],
    [4.1, 0, 'explosive'],
  );
  const breath = keys(duration, [0, 0.3], [0.5, 1], [3.2, 0.9], [4.4, 0.2]);
  const incline = kind === 'incline';
  const barbell = kind === 'bench';
  const angle = incline ? INCLINE_BENCH.angle : 0;
  const rad = (angle * Math.PI) / 180;
  // Pad plane through the seat/back corner (incline) or the flat bench top.
  const padPoint: Vec = incline
    ? [0, INCLINE_BENCH.seatTop, INCLINE_BENCH.seatBack]
    : [0, FLAT_BENCH.top, 0];
  const padNormal: Vec = [0, Math.cos(rad), Math.sin(rad)];
  const hipsZ = incline ? -0.04 : -0.2;
  const feetZ = incline ? 0.62 : 0.4;
  return {
    duration,
    props: barbell
      ? ['bench', 'bench-rack', 'barbell']
      : incline
        ? ['incline-bench', 'dumbbells']
        : ['bench', 'dumbbells'],
    frame: (t, solver) => {
      const k = down(t);
      const legs: Record<Side, LegTarget> = both((s) => ({
        foot: flatFoot(s, incline ? 0.24 : 0.3, feetZ, 22),
        knee: [sx(s, 0.5), 0.8, 0.5],
      }));
      const targets: BodyTargets = {
        hips: { pos: [0, 0.6, hipsZ], pitch: -90 + angle },
        spine: { pitch: incline ? -4 : -8 },
        chest: { pitch: (incline ? -4 : -10) - breath(t) * 2 },
        head: { pitch: incline ? 6 : 2 },
        legs,
        arms: both((s) => hangingArm(s)),
        retract: 12,
      };
      restOnPlane(solver, targets, padPoint, padNormal);
      const pose = solver.solve(targets);
      const sh = shoulders(pose, new Vector3());
      const sternum = worldPoint(pose, STERNUM, new Vector3());
      const up = new Vector3(0, 1, 0);
      const gripX = barbell ? 0.29 : mix(0.15, 0.25, k);
      // Lockout: bar over the shoulders, arms nearly straight.
      const topY = sh.y + Math.sqrt((ARM_REACH * 0.985) ** 2 - (gripX - 0.19) ** 2);
      // Touch point: lower chest (dumbbells slightly higher, beside the chest).
      const chestTouch = sternum.clone().addScaledVector(up, barbell ? 0.03 : 0.06);
      if (incline) chestTouch.z -= 0.05;
      const yK = ease('inOut', k);
      // J-curve: the bar drifts from over the shoulders to the lower chest.
      const c: Vec = [0, mix(topY, chestTouch.y, yK), mix(sh.z, chestTouch.z, Math.pow(k, 0.7))];
      targets.arms = both((s) => ({
        grip: [sx(s, gripX), c[1], c[2]],
        across: [sx(s, 1), 0, incline ? -0.05 : 0],
        elbow: [sx(s, 0.6), -0.5, 0.7],
        wrist: 12,
        fingers: 1,
      }));
      targets.gaze = [0, c[1] + 1, c[2]];
      return {
        targets,
        bar: barbell ? { center: c } : undefined,
        breath: breath(t),
        contacts: soles(),
      };
    },
  };
}

// --------------------------------------------------------- overhead press
function overheadPress(kind: 'barbell' | 'dumbbells'): Clip {
  const duration = 4.4;
  const up = keys(
    duration,
    [0, 0],
    [0.4, 0],
    [1.6, 1, 'explosive'],
    [2.2, 1],
    [4.2, 0, 'controlled'],
  );
  const breath = keys(duration, [0, 0.4], [0.4, 1], [2.2, 0.5], [4.3, 0.4]);
  const ballZ = 0.1;
  const barbell = kind === 'barbell';
  return {
    duration,
    props: barbell ? ['barbell'] : ['dumbbells'],
    frame: (t, solver) => {
      const k = up(t);
      // Head moves back while the bar passes the face, then "through" at lockout.
      const pass = Math.sin(Math.min(1, k / 0.6) * Math.PI);
      const targets: BodyTargets = {
        hips: { pos: [0, 1.0, 0], pitch: -2 - pass * 2 },
        spine: { pitch: -2 - pass * 2 },
        chest: { pitch: -2 },
        head: { pitch: -pass * 14 + k * 6 },
        legs: standingLegs(0.14, ballZ, 8),
        arms: both((s) => hangingArm(s)),
        reach: true,
      };
      const pose = solver.solve(targets);
      const sh = shoulders(pose, new Vector3());
      const rack = worldPoint(pose, { bone: CHEST, rest: new Vector3(0, 1.425, 0.115) }, tmp);
      const gripX = barbell ? 0.26 : mix(0.24, 0.15, k);
      const topY = sh.y + Math.sqrt((ARM_REACH * 0.985) ** 2 - (gripX - 0.2) ** 2);
      const bottomY = barbell ? rack.y : sh.y + 0.08;
      const bottomZ = barbell ? rack.z : sh.z + 0.06;
      const c: Vec = [
        0,
        mix(bottomY, topY, k),
        mix(bottomZ, sh.z - 0.02, ease('inOut', Math.min(1, k * 1.4))),
      ];
      targets.arms = both((s) => ({
        grip: [sx(s, gripX), c[1], c[2]],
        across: [sx(s, 1), 0, 0],
        elbow: [sx(s, mix(0.4, 1, k)), -1, mix(0.9, 0, k)],
        wrist: 10,
        fingers: 1,
      }));
      balance(solver, targets, midfoot(ballZ), [handsLoad(barbell ? 0.5 : 0.3)]);
      return {
        targets,
        bar: barbell ? { center: c } : undefined,
        breath: breath(t),
        contacts: soles(),
      };
    },
  };
}

// --------------------------------------------------------------- pulldown
function pulldown(): Clip {
  const duration = 4.2;
  const pull = keys(duration, [0, 0], [1.0, 1, 'explosive'], [1.6, 1], [3.6, 0, 'controlled']);
  const seat = PULLDOWN.seatTop;
  return {
    duration,
    props: ['pulldown'],
    frame: (t, solver) => {
      const k = pull(t);
      const targets: BodyTargets = {
        hips: { pos: [0, seat + 0.095, PULLDOWN.seatZ], pitch: mix(-8, -16, k) },
        spine: { pitch: 2 },
        chest: { pitch: mix(-4, -12, k) },
        legs: both((s) => ({
          foot: flatFoot(s, 0.17, 0.5, 10),
          knee: [sx(s, 0.15), 0.3, 1],
        })),
        arms: both((s) => hangingArm(s)),
        shrug: mix(8, -6, k),
        retract: mix(-4, 10, k),
      };
      const pose = solver.solve(targets);
      const sh = shoulders(pose, new Vector3());
      const sternum = worldPoint(pose, STERNUM, new Vector3());
      const gripX = 0.4;
      const topY = sh.y + Math.sqrt((ARM_REACH * 0.99) ** 2 - (gripX - 0.19) ** 2);
      const c: Vec = [
        0,
        mix(topY, sternum.y + 0.13, k),
        mix(sh.z + 0.06, sternum.z + 0.07, k) + Math.sin(k * Math.PI) * 0.05,
      ];
      targets.arms = both((s) => ({
        grip: [sx(s, gripX), c[1], c[2]],
        across: [sx(s, 1), 0, 0],
        elbow: [sx(s, 0.7), -1, -0.25],
        fingers: 1,
      }));
      targets.gaze = [0, mix(1.9, 1.5, k), 1.5];
      return { targets, bar: { center: c }, breath: 1 - k * 0.6, contacts: soles() };
    },
  };
}

// ------------------------------------------------------------ lunges
const FOOT_GAP = 0.11;

/** Walking lunges with dumbbells: two reps travelling forward, then re-materialise. */
function walkingLunge(): Clip {
  const duration = 6.4;
  const stride = 0.78;
  const z0 = -0.78;
  // Foot travel (z) per side; swing segments lift the foot.
  const lz = keys(
    duration,
    [0, z0],
    [0.4, z0],
    [1.0, z0 + stride, 'inOut'],
    [4.9, z0 + stride],
    [5.8, z0 + 2 * stride, 'inOut'],
    [6.39, z0 + 2 * stride],
  );
  const rz = keys(
    duration,
    [0, z0],
    [2.3, z0],
    [3.2, z0 + 2 * stride, 'inOut'],
    [6.39, z0 + 2 * stride],
  );
  // Lunge depth: rep 1 (left forward), rep 2 (right forward).
  const depth = keys(
    duration,
    [0, 0],
    [1.0, 0],
    [2.0, 1, 'controlled'],
    [2.3, 1],
    [3.2, 0, 'inOut'],
    [3.5, 0],
    [4.6, 1, 'controlled'],
    [4.9, 1],
    [5.8, 0, 'inOut'],
  );
  // Weight on the left foot (0..1).
  const wl = keys(
    duration,
    [0, 0.5],
    [0.4, 0.15],
    [1.0, 0.6],
    [2.3, 0.6],
    [2.6, 1],
    [3.2, 0.85],
    [3.5, 0.4],
    [4.9, 0.4],
    [5.2, 0],
    [5.8, 0.15],
    [6.1, 0.5],
  );
  const fade = (t: number) => Math.min(1, t / 0.25, (duration - t) / 0.25);
  const lift = (z: (t: number) => number, t: number) => {
    const dz = z(t + 0.02) - z(t - 0.02);
    return Math.min(0.09, Math.abs(dz) * 1.4);
  };
  return {
    duration,
    props: ['dumbbells'],
    frame: (t, solver) => {
      const d = depth(t);
      const zl = lz(t);
      const zr = rz(t);
      const front: Side = zl >= zr ? 'l' : 'r';
      const rear: Side = front === 'l' ? 'r' : 'l';
      const gap = Math.abs(zl - zr);
      const heel = Math.min(1, gap / 0.4) * mix(20, 48, d);
      const foot = (s: Side, z: number) => {
        const up = lift(s === 'l' ? lz : rz, t);
        const isRear = s === rear && gap > 0.1;
        return {
          foot: {
            at: [sx(s, FOOT_GAP), up, z] as Vec,
            pivot: 'ball' as const,
            pitch: isRear ? heel : up * 120,
            out: 5,
          },
          knee: kneeOverToes(s, 5, isRear ? 0.3 : 0),
        };
      };
      const targets: BodyTargets = {
        hips: { pos: [0, mix(1.0, 0.56, d), (zl + zr) / 2 - 0.1], pitch: mix(2, 10, d) },
        spine: { pitch: 2 },
        gaze: [0, 1.0, (zl + zr) / 2 + 3],
        legs: { l: foot('l', zl), r: foot('r', zr) },
        arms: both((s) => dumbbellArm(s)),
        reach: true,
      };
      const w = wl(t);
      const supportZ = mix(midfoot(zr), midfoot(zl), w);
      const supportX = mix(-FOOT_GAP, FOOT_GAP, w) * 0.5;
      balance(solver, targets, supportZ, [handsLoad(0.3)], supportX);
      const contacts: Contact[] = [];
      if (lift(lz, t) < 1e-3) contacts.push({ kind: 'sole', side: 'l', y: 0 });
      if (lift(rz, t) < 1e-3) contacts.push({ kind: 'sole', side: 'r', y: 0 });
      return { targets, breath: 1 - d * 0.6, opacity: fade(t), contacts };
    },
  };
}

/** Bulgarian split squat: rear instep on a bench, dumbbells at the sides. */
function splitSquat(): Clip {
  const duration = 4.6;
  const depth = keys(
    duration,
    [0, 0],
    [0.5, 0],
    [2.6, 1, 'controlled'],
    [2.9, 1],
    [3.9, 0, 'explosive'],
  );
  const frontZ = SPLIT_BENCH.z + 0.92;
  return {
    duration,
    props: ['split-bench', 'dumbbells'],
    frame: (t, solver) => {
      const d = depth(t);
      const targets: BodyTargets = {
        hips: { pos: [0.02, mix(0.98, 0.56, d), mix(0.2, 0.06, d)], pitch: mix(8, 22, d) },
        spine: { pitch: 4 },
        gaze: [0, 0.9, 3],
        legs: {
          l: { foot: flatFoot('l', 0.13, frontZ, 6), knee: kneeOverToes('l', 6) },
          r: {
            foot: {
              at: [-0.12, SPLIT_BENCH.top + 0.055, SPLIT_BENCH.z + 0.04],
              pivot: 'ankle',
              pitch: mix(150, 128, d),
            },
            knee: [-0.1, -1, 0.15],
          },
        },
        arms: both((s) => dumbbellArm(s, 10)),
        reach: true,
      };
      balance(solver, targets, midfoot(frontZ) - 0.06, [handsLoad(0.3)]);
      return { targets, breath: 1 - d * 0.5, contacts: soles(0, ['l']) };
    },
  };
}

/** World's greatest stretch: deep lunge, hand down, rotate the other arm up. */
function lungeRotation(): Clip {
  const duration = 5.4;
  const open = keys(duration, [0, 0], [0.6, 0], [2.3, 1, 'inOut'], [3.5, 1], [5.0, 0, 'inOut']);
  return {
    duration,
    props: [],
    frame: (t, solver) => {
      const k = open(t);
      const left = (pitch: number, side: number, fore: number): ArmTarget => ({
        fk: { upper: [pitch, side], fore: [fore, side] },
        palm: [0, 0, -1],
        fingers: 0.15,
      });
      const build = (hipY: number, handZ: number): BodyTargets => ({
        hips: { pos: [0, hipY, -0.05], pitch: 32 },
        spine: { pitch: 50, twist: k * 55 },
        chest: { twist: k * 12 },
        legs: {
          l: { foot: flatFoot('l', 0.14, 0.62, 4), knee: kneeOverToes('l', 12) },
          r: {
            foot: { at: [-0.12, 0, -0.78], pivot: 'ball', pitch: 48, out: 0 },
            knee: [0, -1, 0.3],
          },
        },
        arms: {
          l: left(mix(70, 4, k), mix(0, 88, k), mix(130, 4, k)),
          r: {
            grip: [0.0, 0, handZ],
            point: 'palm',
            palm: [0, -1, 0],
            hand: [0.1, 0, 1],
            elbow: [-0.5, 0, -1],
            fingers: 0.05,
          },
        },
        reach: true,
      });
      // Hips as high as the supporting (right) arm allows, hand under the shoulder.
      const rShoulder = boneIndex('rUpperArm');
      const shoulderY = (LIMB.upperArm + LIMB.foreArm) * 0.93 + 0.035;
      const hipY = solveMonotonic(
        (y) => solver.solve(build(y, 0.5)).pos[rShoulder]!.y,
        shoulderY,
        0.3,
        0.62,
        14,
      );
      const handZ = solver.solve(build(hipY, 0.5)).pos[rShoulder]!.z + 0.06;
      const targets = build(hipY, handZ);
      const pose = solver.solve(targets);
      const hand = pose.pos[boneIndex('lHand')]!;
      targets.gaze = [hand.x * 3, hand.y + (hand.y - 0.7) * 2, hand.z];
      return {
        targets,
        breath: 0.5 + k * 0.5,
        contacts: [...soles(0, ['l', 'r'])],
      };
    },
  };
}

// --------------------------------------------------------- floor work
/**
 * Straight body on the toes: finds the hips pitch at which the shoulders are
 * at `shoulderY` while the toes stay on their floor points.
 */
function rigidBody(
  solver: BodySolver,
  build: (pitch: number) => BodyTargets,
  measure: (pose: BodyPose) => number,
  target: number,
): BodyTargets {
  const pitch = solveMonotonic((p) => measure(solver.solve(build(p))), target, 55, 100, 14);
  return build(pitch);
}

const toesLegs = (ballZ: number, pitch = 62): Record<Side, LegTarget> =>
  both((s) => ({
    foot: { at: [sx(s, 0.1), 0, ballZ], pivot: 'ball', pitch, out: 0 },
    knee: [0, -1, 0.2],
  }));

/** Hips placed along the body line so the legs are straight from the toes. */
function plankHips(pitch: number, ballZ: number, footPitch: number): Vec {
  const r = (pitch * Math.PI) / 180;
  const f = (footPitch * Math.PI) / 180;
  // Ankle above the ball of the foot (rest ball -> ankle offset rotated).
  const ankleY = 0.155 * Math.sin(f) + LIMB.ankleHeight * Math.cos(f);
  const ankleZ = ballZ - 0.14 * Math.cos(f) + LIMB.ankleHeight * Math.sin(f);
  const leg = (LIMB.thigh + LIMB.shin) * 0.985;
  return [0, ankleY + leg * Math.cos(r), ankleZ + leg * Math.sin(r)];
}

const PLANK_BALL_Z = -0.85;

function plankTargets(pitch: number, breath: number, arms: Record<Side, ArmTarget>): BodyTargets {
  return {
    hips: { pos: plankHips(pitch, PLANK_BALL_Z, 62), pitch },
    spine: { pitch: -1 + breath * 1.5 },
    chest: { pitch: breath * 1.5 },
    head: { pitch: 8 },
    legs: toesLegs(PLANK_BALL_Z),
    arms,
    reach: true,
  };
}

/** Forearm plank: elbows under the shoulders, body straight, calm breathing. */
function plank(): Clip {
  const duration = 4.5;
  const elbowH = 0.05;
  const shoulderY = elbowH + LIMB.upperArm;
  const forearmArms = (pose: BodyPose | null): Record<Side, ArmTarget> =>
    both((s) => {
      const sh = pose
        ? pose.pos[boneIndex(s === 'l' ? 'lUpperArm' : 'rUpperArm')]!
        : tmp.set(0, 0, 0);
      return {
        grip: [sh.x * 0.8, 0.035, sh.z + LIMB.foreArm * 0.98],
        point: 'wrist',
        palm: [sx(s, -0.4), -1, 0],
        hand: [sx(s, -0.25), -0.1, 1],
        elbow: [0, -1, -0.6],
        fingers: 0.35,
      };
    });
  return {
    duration,
    props: ['mat'],
    frame: (t, solver) => {
      const b = breathing(t, duration);
      const base = rigidBody(
        solver,
        (p) => plankTargets(p, b, forearmArms(null)),
        (pose) => shoulders(pose, tmp).y,
        shoulderY,
      );
      const pose = solver.solve(base);
      base.arms = forearmArms(pose);
      return { targets: base, breath: b, contacts: soles() };
    },
  };
}

/** Push-up / high plank: hands planted, body pivots on the toes. */
function pushUp(hold: boolean): Clip {
  const duration = hold ? 4.5 : 3.4;
  const depth = hold
    ? () => 0
    : keys(duration, [0, 0], [0.6, 0], [2.2, 1, 'controlled'], [2.4, 1], [3.3, 0, 'explosive']);
  const topShoulder = 0.045 + (LIMB.upperArm + LIMB.foreArm) * 0.97;
  // Hands under the shoulders at the top (solved once).
  const solver0 = new (class {
    hands: Record<Side, Vec> | null = null;
  })();
  const armsAt = (hands: Record<Side, Vec>): Record<Side, ArmTarget> =>
    both((s) => ({
      grip: hands[s],
      point: 'palm',
      palm: [0, -1, 0],
      hand: [sx(s, 0.18), 0, 1],
      elbow: [sx(s, 0.5), 0.2, -0.85],
      fingers: 0.05,
    }));
  const free: Record<Side, ArmTarget> = both((s) => hangingArm(s, 90));
  return {
    duration,
    props: hold ? ['mat'] : [],
    frame: (t, solver) => {
      if (!solver0.hands) {
        const top = rigidBody(
          solver,
          (p) => plankTargets(p, 0, free),
          (pose) => shoulders(pose, tmp).y,
          topShoulder,
        );
        const pose = solver.solve(top);
        solver0.hands = both((s) => {
          const sh = pose.pos[boneIndex(s === 'l' ? 'lUpperArm' : 'rUpperArm')]!;
          return [sx(s, 0.25), 0, sh.z + 0.07] as Vec;
        });
      }
      const d = depth(t);
      const b = hold ? breathing(t, duration) : 1 - d * 0.6;
      // Bottom: chest ~7 cm above the floor.
      const targets = rigidBody(
        solver,
        (p) => plankTargets(p, b, armsAt(solver0.hands!)),
        (pose) =>
          mix(shoulders(pose, tmp).y - topShoulder, worldPoint(pose, STERNUM, tmp2).y - 0.075, d),
        0,
      );
      return { targets, breath: b, contacts: soles() };
    },
  };
}

/** Cat-cow on all fours, moving with the breath. */
function catCow(): Clip {
  const duration = 5.2;
  const cat = keys(duration, [0, 0], [0.4, 0], [2.0, 1, 'inOut'], [2.8, 1], [4.6, 0, 'inOut']);
  const kneeZ = -0.3;
  let hands: Record<Side, Vec> | null = null;
  const build = (k: number, pitch: number, armsT: Record<Side, ArmTarget>): BodyTargets => ({
    hips: { pos: [0, 0.5, kneeZ], pitch: pitch + mix(-6, 8, k) },
    spine: { pitch: mix(-18, 26, k) },
    chest: { pitch: mix(-8, 12, k) },
    head: { pitch: mix(-34, 40, k) },
    legs: both((s) => ({
      foot: { at: [sx(s, 0.11), 0.06, kneeZ - LIMB.shin - 0.02], pivot: 'ankle', pitch: 172 },
      knee: [0, -1, 0.1],
    })),
    arms: armsT,
    retract: mix(8, -8, k),
  });
  const armsAt = (h: Record<Side, Vec>): Record<Side, ArmTarget> =>
    both((s) => ({
      grip: h[s],
      point: 'palm',
      palm: [0, -1, 0],
      hand: [sx(s, 0.12), 0, 1],
      elbow: [sx(s, 0.2), 0, -1],
      fingers: 0.05,
    }));
  return {
    duration,
    props: ['mat'],
    frame: (t, solver) => {
      if (!hands) {
        const pose = solver.solve(
          build(
            0.5,
            80,
            both((s) => hangingArm(s, 80)),
          ),
        );
        hands = both((s) => {
          const sh = pose.pos[boneIndex(s === 'l' ? 'lUpperArm' : 'rUpperArm')]!;
          return [sx(s, 0.19), 0, sh.z + 0.06] as Vec;
        });
      }
      const k = cat(t);
      const h = hands;
      // Keep the shoulders at a straight-arm height while the spine moves.
      const shoulderY = (LIMB.upperArm + LIMB.foreArm) * 0.97 + 0.035;
      const pitch = solveMonotonic(
        (p) => shoulders(solver.solve(build(k, p, armsAt(h))), tmp).y,
        shoulderY,
        40,
        125,
        14,
      );
      const targets = build(k, pitch, armsAt(h));
      return {
        targets,
        breath: 1 - k,
        contacts: [
          { kind: 'landmark', name: 'lKneeFront', y: 0, radius: 0.03 },
          { kind: 'landmark', name: 'rKneeFront', y: 0, radius: 0.03 },
        ],
      };
    },
  };
}

// ------------------------------------------------------- single joint
function curl(): Clip {
  const duration = 4.8;
  const flex = keys(
    duration,
    [0, 0],
    [0.3, 0],
    [1.3, 1, 'explosive'],
    [1.8, 1],
    [4.8 - 0.01, 0, 'controlled'],
  );
  return {
    duration,
    props: ['dumbbells'],
    frame: (t, solver) => {
      const k = flex(t);
      const angle = mix(8, 145, k);
      const r = (angle * Math.PI) / 180;
      const targets: BodyTargets = {
        hips: { pos: [0, 1.0, 0], pitch: 0 },
        spine: { pitch: -1 },
        chest: { pitch: -3 },
        gaze: [0, 1.3, 3],
        legs: standingLegs(0.13, 0.1, 8),
        arms: both((s) => ({
          fk: { upper: [mix(-2, 10, k), 8], fore: [angle, mix(8, 3, k)] },
          palm: [sx(s, mix(-0.3, 0.15, k)), Math.sin(r), Math.cos(r)],
          fingers: 1,
        })),
        retract: 6,
        reach: true,
      };
      balance(solver, targets, midfoot(0.1), [handsLoad(0.2)]);
      return { targets, breath: 1 - k * 0.6, contacts: soles() };
    },
  };
}

function lateralRaise(): Clip {
  const duration = 4.5;
  const raise = keys(
    duration,
    [0, 0],
    [0.4, 0],
    [1.4, 1, 'inOut'],
    [2.0, 1],
    [4.4, 0, 'controlled'],
  );
  return {
    duration,
    props: ['dumbbells'],
    frame: (t, solver) => {
      const k = raise(t);
      const a = mix(8, 86, k);
      const r = (a * Math.PI) / 180;
      const targets: BodyTargets = {
        hips: { pos: [0, 1.0, 0], pitch: 2 },
        spine: { pitch: 2 },
        gaze: [0, 1.3, 3],
        legs: standingLegs(0.13, 0.1, 8),
        arms: both((s) => ({
          fk: { upper: [mix(4, 14, k), a], fore: [mix(14, 22, k), a - 6] },
          palm: [sx(s, -Math.cos(r)), -Math.sin(r), 0.1],
          fingers: 1,
        })),
        shrug: -k * 6,
        reach: true,
      };
      balance(solver, targets, midfoot(0.1), [handsLoad(0.15)]);
      return { targets, breath: 1 - k * 0.5, contacts: soles() };
    },
  };
}

function rearDeltFly(): Clip {
  const duration = 3.8;
  const raise = keys(
    duration,
    [0, 0],
    [0.3, 0],
    [1.3, 1, 'inOut'],
    [1.8, 1],
    [3.7, 0, 'controlled'],
  );
  const hipPitch = 66;
  return {
    duration,
    props: ['dumbbells'],
    frame: (t, solver) => {
      const k = raise(t);
      const incline = hipPitch + 8;
      const targets: BodyTargets = {
        hips: { pos: [0, 0.86, -0.18], pitch: hipPitch },
        spine: { pitch: 8 },
        chest: { pitch: -2 },
        head: { pitch: -24 },
        legs: standingLegs(0.13, 0.1, 8),
        arms: both((s) => ({
          fk: {
            upper: [mix(incline - 2, incline - 6, k), mix(6, 82, k)],
            fore: [mix(incline + 14, incline + 4, k), mix(4, 74, k)],
          },
          palm: [sx(s, -Math.cos(k * 1.45)), -Math.sin(k * 1.45), -0.35],
          fingers: 1,
        })),
        retract: k * 12,
        reach: true,
      };
      balance(solver, targets, midfoot(0.1), [handsLoad(0.12)]);
      return { targets, breath: 1 - k * 0.5, contacts: soles() };
    },
  };
}

/** Overhead cable rope extension, facing away from the cable column. */
function tricepsExtension(): Clip {
  const duration = 4.0;
  const ext = keys(
    duration,
    [0, 0],
    [0.4, 0],
    [1.4, 1, 'explosive'],
    [1.8, 1],
    [3.8, 0, 'controlled'],
  );
  return {
    duration,
    props: ['cable-rope'],
    frame: (t, solver) => {
      const k = ext(t);
      const upper = 150;
      const targets: BodyTargets = {
        hips: { pos: [0, 0.98, 0.02], pitch: 10 },
        spine: { pitch: 10 },
        chest: { pitch: -4 },
        gaze: [0, 1.2, 3],
        legs: {
          l: plantedLeg('l', 0.13, 0.38, 6),
          r: {
            foot: { at: [-0.13, 0, -0.24], pivot: 'ball', pitch: 18, out: 6 },
            knee: [0, -0.3, 1],
          },
        },
        arms: both((s) => ({
          fk: { upper: [upper, 14], fore: [mix(upper + 125, upper + 6, k), mix(6, 10, k)] },
          palm: [sx(s, -1), 0, 0],
          fingers: 1,
        })),
        reach: true,
      };
      balance(solver, targets, 0.1);
      const pose = solver.solve(targets);
      const c = worldPoint(
        pose,
        { bone: boneIndex('lHand'), rest: tmp.set(0, 0, 0) },
        new Vector3(),
      );
      const lg = pose.pos[boneIndex('lHand')]!;
      const rg = pose.pos[boneIndex('rHand')]!;
      c.copy(lg).add(rg).multiplyScalar(0.5);
      return {
        targets,
        bar: { center: [c.x, c.y, c.z] },
        breath: 1 - k * 0.6,
        contacts: soles(0, ['l']),
      };
    },
  };
}

function calfRaise(): Clip {
  const duration = 4.6;
  const rise = keys(
    duration,
    [0, 0],
    [1.0, 0],
    [2.0, 1, 'explosive'],
    [3.0, 1],
    [4.5, 0, 'controlled'],
  );
  const ballZ = STEP.edgeZ + 0.04;
  return {
    duration,
    props: ['step'],
    frame: (t, solver) => {
      const k = rise(t);
      const pitch = mix(-20, 32, k);
      const targets: BodyTargets = {
        hips: { pos: [0, 1.4, -0.02], pitch: 1 },
        spine: { pitch: 1 },
        gaze: [0, 1.4, 3],
        legs: both((s) => ({
          foot: { at: [sx(s, 0.12), STEP.top, ballZ], pivot: 'ball', pitch, out: 6 },
          knee: kneeOverToes(s, 6),
        })),
        arms: both((s) => hangingArm(s)),
        reach: true,
      };
      balance(solver, targets, ballZ - 0.01);
      return {
        targets,
        breath: 0.5 + k * 0.3,
        contacts: [
          { kind: 'sole', side: 'l', y: STEP.top },
          { kind: 'sole', side: 'r', y: STEP.top },
        ],
      };
    },
  };
}

// ------------------------------------------------------- one-arm row
function oneArmRow(): Clip {
  const duration = 3.8;
  const pull = keys(
    duration,
    [0, 0],
    [0.3, 0],
    [1.2, 1, 'explosive'],
    [1.7, 1],
    [3.7, 0, 'controlled'],
  );
  const top = ROW_BENCH.top;
  const kneeZ = -0.2;
  const handZ = 0.38;
  return {
    duration,
    props: ['row-bench', 'dumbbell-right'],
    frame: (t, solver) => {
      const k = pull(t);
      const targets: BodyTargets = {
        hips: { pos: [0.1, top + 0.47, kneeZ], pitch: 82, roll: -4 },
        spine: { pitch: 6, twist: -k * 10 },
        chest: { pitch: -4 },
        head: { pitch: -20 },
        legs: {
          l: {
            foot: { at: [0.13, top + 0.06, kneeZ - LIMB.shin - 0.01], pivot: 'ankle', pitch: 172 },
            knee: [0, -1, 0.1],
          },
          r: { foot: flatFoot('r', 0.22, kneeZ + 0.06, 12), knee: kneeOverToes('r', 20) },
        },
        arms: {
          l: {
            grip: [0.16, top, handZ],
            point: 'palm',
            palm: [0, -1, 0],
            hand: [0, 0, 1],
            elbow: [0.3, 0, -1],
            fingers: 0.1,
          },
          r: hangingArm('r', 88),
        },
        retract: 4,
      };
      const pose = solver.solve(targets);
      const sh = pose.pos[boneIndex('rUpperArm')]!;
      const hang = new Vector3(sh.x - 0.02, sh.y - ARM_REACH * 0.97, sh.z + 0.02);
      const hip = worldPoint(
        pose,
        { bone: boneIndex('hips'), rest: tmp.set(-0.16, 0.98, 0.06) },
        tmp,
      );
      targets.arms.r = {
        grip: [mix(hang.x, hip.x, k), mix(hang.y, hip.y, k), mix(hang.z, hip.z, k)],
        across: [0, 0, -1],
        elbow: [-0.2, 0.4, -1],
        fingers: 1,
      };
      return {
        targets,
        breath: 1 - k * 0.6,
        contacts: [{ kind: 'sole', side: 'r', y: 0 }],
      };
    },
  };
}

// ------------------------------------------------------------- gait
/**
 * Loaded carry: two strides walking forward across the projector, then the
 * hologram fades and re-materialises at the start (no foot sliding).
 */
function carry(kind: 'both' | 'right'): Clip {
  const strides = 2;
  const strideTime = 1.0;
  const fadeTime = 0.3;
  const duration = strides * strideTime + 2 * fadeTime;
  const step = 0.46;
  // Centres the walk on the projector disc.
  const z0 = step / 2 + 0.1 - step * strides;
  // Foot phase: 0 = heel strike of the left foot.
  const footAt = (side: Side, time: number) => {
    const phase = time / strideTime + (side === 'r' ? 0.5 : 0);
    const cycle = Math.floor(phase);
    const p = phase - cycle;
    // Stance 62 %, swing 38 %.
    const zBase = z0 + (cycle - 1) * 2 * step + (side === 'r' ? -step : 0);
    if (p < 0.62) {
      // Heel strike -> flat -> heel off -> toe off (foot planted on the floor).
      const pitch = p < 0.08 ? mix(-14, 0, p / 0.08) : p > 0.42 ? mix(0, 34, (p - 0.42) / 0.2) : 0;
      return { z: zBase, y: 0, pitch, swing: false };
    }
    const u = (p - 0.62) / 0.38;
    return {
      z: zBase + 2 * step * ease('inOut', u),
      y: Math.sin(u * Math.PI) * 0.06,
      pitch: mix(34, -14, ease('inOut', u)),
      swing: true,
    };
  };
  return {
    duration,
    props: kind === 'both' ? ['dumbbells'] : ['dumbbell-right'],
    frame: (time, solver) => {
      const walk = Math.min(Math.max(time - fadeTime, -fadeTime), strides * strideTime + fadeTime);
      const legs = both((s): LegTarget => {
        const f = footAt(s, walk + strideTime);
        // Toes up (heel strike) pivots on the heel, heel up (toe-off) on the ball.
        const pivot = f.pitch < 0 ? 'heel' : 'ball';
        const ballZ = f.z;
        const heelZ = f.z - 0.195;
        return {
          foot: {
            at: [sx(s, 0.1), f.y, pivot === 'heel' ? heelZ : ballZ],
            pivot,
            pitch: f.pitch,
            out: 6,
          },
          knee: kneeOverToes(s, 6),
        };
      });
      const phase = (walk + strideTime) / strideTime;
      const sway = Math.sin(phase * 2 * Math.PI);
      const bob = Math.cos(phase * 4 * Math.PI);
      const comZ = z0 - step / 2 - 0.1 + (phase - 1) * 2 * step;
      const targets: BodyTargets = {
        hips: {
          pos: [0, 0.98 + bob * 0.012, comZ],
          pitch: 3,
          yaw: sway * 4,
          roll: sway * 2.5,
        },
        spine: { pitch: 1, twist: -sway * 5, side: kind === 'right' ? 2 : 0 },
        gaze: [0, 1.2, comZ + 4],
        legs,
        arms:
          kind === 'both'
            ? both((s) => dumbbellArm(s, (s === 'l' ? -1 : 1) * sway * 3, 12))
            : {
                l: { ...hangingArm('l', -sway * 10, 22, 14), fingers: 0.2 },
                r: dumbbellArm('r', sway * 3, 10),
              },
        retract: 6,
        reach: true,
      };
      balance(
        solver,
        targets,
        comZ,
        kind === 'both' ? [handsLoad(0.45)] : [handLoad('r', 0.3)],
        sway * 0.035,
      );
      const contacts: Contact[] = [];
      for (const s of ['l', 'r'] as const) {
        const f = footAt(s, walk + strideTime);
        if (!f.swing) contacts.push({ kind: 'sole', side: s, y: 0 });
      }
      const opacity = Math.min(1, time / fadeTime, (duration - time) / fadeTime);
      return { targets, breath: breathing(time, 2.6), opacity, contacts };
    },
  };
}

/** Easy run on a treadmill: ~172 steps/min, mid-foot strike under the body. */
function run(): Clip {
  const duration = 0.7; // one stride = two steps
  const speed = 2.7; // m/s belt speed (~10 km/h)
  const deck = TREADMILL.deck;
  const contact = 0.36; // stance fraction of the stride
  const strikeZ = 0.2;
  const toeOffZ = strikeZ - speed * duration * contact;
  // Swing path of the ball of the foot (phase 0 = touchdown).
  const swing = loopSpline(
    [0, contact, 0.5, 0.66, 0.82, 0.94],
    [
      [strikeZ, 0, -6],
      [toeOffZ, 0, 40],
      [toeOffZ - 0.06, 0.2, 55],
      [-0.08, 0.32, 20],
      [0.3, 0.16, -4],
      [0.3, 0.035, -12],
    ],
  );
  const footAt = (phase: number) => {
    const p = ((phase % 1) + 1) % 1;
    if (p < contact) {
      const u = p / contact;
      const pitch =
        u < 0.25 ? mix(-6, 0, u / 0.25) : u > 0.55 ? mix(0, 40, ease('in', (u - 0.55) / 0.45)) : 0;
      return { z: mix(strikeZ, toeOffZ, u), y: 0, pitch, stance: true };
    }
    const [z, y, pitch] = swing(p);
    return { z: z!, y: Math.max(0, y!), pitch: pitch!, stance: false };
  };
  return {
    duration,
    props: ['treadmill'],
    frame: (t) => {
      const phase = wrapTime(t, duration) / duration;
      const legs = both((s): LegTarget => {
        const f = footAt(phase + (s === 'r' ? 0.5 : 0));
        return {
          foot: { at: [sx(s, 0.09), deck + f.y, f.z], pivot: 'ball', pitch: f.pitch, out: 4 },
          knee: kneeOverToes(s, 4),
        };
      });
      // Lowest at mid-stance, highest in flight.
      const bounce = -Math.cos(4 * Math.PI * (phase - contact / 2));
      // +1 when the left foot is forward (touchdown): pelvis turns with the
      // forward leg, the thorax counter-rotates and the opposite arm swings.
      const legPhase = Math.cos(2 * Math.PI * phase);
      const armPhase = Math.cos(2 * Math.PI * (phase - 0.04));
      const targets: BodyTargets = {
        hips: {
          pos: [0, deck + 0.94 + bounce * 0.03, -0.02],
          pitch: 6,
          yaw: -legPhase * 6,
          roll: Math.sin(4 * Math.PI * phase) * 2,
        },
        spine: { pitch: 4, twist: legPhase * 13 },
        gaze: [0, 1.5, 6],
        legs,
        arms: both((s) => {
          const a = (s === 'l' ? -1 : 1) * armPhase;
          return {
            fk: { upper: [a * 32 - 6, 10], fore: [a * 32 + 82, 4 - a * 6] },
            palm: [sx(s, -1), 0.4, 0],
            fingers: 0.6,
          };
        }),
        reach: true,
      };
      const contacts: Contact[] = [];
      for (const s of ['l', 'r'] as const) {
        if (footAt(phase + (s === 'r' ? 0.5 : 0)).stance)
          contacts.push({ kind: 'sole', side: s, y: deck });
      }
      return { targets, belt: t * speed, breath: breathing(t, 1.4), contacts };
    },
  };
}

/** Stationary bike at ~90 rpm. */
function bike(): Clip {
  const duration = 0.66;
  const [cx, cy, cz] = BIKE.crankCentre;
  return {
    duration,
    props: ['bike'],
    frame: (t) => {
      const crank = (wrapTime(t, duration) / duration) * 2 * Math.PI;
      const legs = both((s): LegTarget => {
        const a = crank + (s === 'r' ? Math.PI : 0);
        // a = 0: pedal at the top (12 o'clock), rotating forward.
        const pz = cz + Math.sin(a) * BIKE.crank;
        const py = cy + Math.cos(a) * BIKE.crank;
        return {
          foot: {
            at: [cx + sx(s, BIKE.pedalHalfWidth), py + 0.012, pz],
            pivot: 'ball',
            pitch: 8 + 14 * Math.sin(a - 0.6),
            out: 0,
          },
          knee: [sx(s, 0.08), 0.2, 1],
        };
      });
      const [, sy, sz] = BIKE.saddle;
      const rock = Math.sin(crank);
      const targets: BodyTargets = {
        hips: { pos: [rock * 0.004, sy + 0.1, sz + 0.03], pitch: 44, roll: rock * 1.5 },
        spine: { pitch: 6 },
        chest: { pitch: -4 },
        gaze: [0, 1.2, 4],
        legs,
        arms: both((s) => ({
          grip: [sx(s, BIKE.barHalfWidth), BIKE.bars[1], BIKE.bars[2]],
          across: [sx(s, 1), 0, 0],
          elbow: [sx(s, 0.5), -0.2, -1],
          fingers: 0.9,
        })),
      };
      return { targets, crank, breath: breathing(t, 2.0), contacts: [] };
    },
  };
}

/** Standing thoracic rotations, arms crossed on the chest, hips square. */
function thoracicRotation(): Clip {
  const duration = 8.4;
  const twist = keys(
    duration,
    [0, 0],
    [2.0, 1, 'inOut'],
    [2.9, 1],
    [4.2, 0, 'inOut'],
    [6.2, -1, 'inOut'],
    [7.1, -1],
  );
  return {
    duration,
    props: [],
    frame: (t, solver) => {
      const k = twist(t);
      const targets: BodyTargets = {
        hips: { pos: [0, 1.0, 0], yaw: k * 6 },
        spine: { twist: k * 34 },
        chest: { twist: k * 10 },
        head: { yaw: k * 14 },
        legs: standingLegs(0.13, 0.1, 8),
        arms: {
          l: {
            frame: 'chest',
            grip: [-0.16, 1.39, 0.11],
            point: 'palm',
            palm: [0, 0, -1],
            elbow: [0.2, -1, 0.4],
            fingers: 0.1,
          },
          r: {
            frame: 'chest',
            grip: [0.16, 1.33, 0.13],
            point: 'palm',
            palm: [0, 0, -1],
            elbow: [-0.2, -1, 0.4],
            fingers: 0.1,
          },
        },
        reach: true,
      };
      balance(solver, targets, midfoot(0.1));
      return { targets, breath: 1 - Math.abs(k) * 0.7, contacts: soles() };
    },
  };
}

const SQUAT = squat('barbell');
const HINGE = hinge('barbell');
const BENCH = press('bench');

export const CLIPS: Record<AnimationId, Clip> = {
  squat: SQUAT,
  'squat-dumbbells': squat('dumbbells'),
  'squat-hold': squatHold(),
  hinge: HINGE,
  'hinge-dumbbells': hinge('dumbbells'),
  'bench-press': BENCH,
  'bench-press-dumbbells': press('bench-dumbbells'),
  'incline-press': press('incline'),
  'overhead-press': overheadPress('barbell'),
  'overhead-press-dumbbells': overheadPress('dumbbells'),
  row: row('barbell'),
  'row-dumbbells': row('dumbbells'),
  'one-arm-row': oneArmRow(),
  pulldown: pulldown(),
  lunge: walkingLunge(),
  'split-squat-bench': splitSquat(),
  'lunge-rotation': lungeRotation(),
  plank: plank(),
  'push-up': pushUp(false),
  'high-plank': pushUp(true),
  curl: curl(),
  'triceps-extension': tricepsExtension(),
  'calf-raise': calfRaise(),
  'rear-delt-fly': rearDeltFly(),
  'lateral-raise': lateralRaise(),
  carry: carry('both'),
  'carry-one': carry('right'),
  run: run(),
  bike: bike(),
  mobility: thoracicRotation(),
  'cat-cow': catCow(),
};

export function getClip(id: AnimationId): Clip {
  return CLIPS[id];
}
