import type { AnimationId } from '../plan/types';
import type { Clip, Pose } from './pose';

/**
 * Keyframed hologram clips, one per animation id. Pure data (no three.js) so
 * it can be tested and reused. Angle conventions are documented in pose.ts.
 */

interface Limbs {
  armP?: number;
  armS?: number;
  foreP?: number;
  foreS?: number;
  thighP?: number;
  thighS?: number;
  shinP?: number;
  shinS?: number;
  footP?: number;
}

/** Mirrors limb angles to both sides. */
function both(l: Limbs): Pose {
  const pose: Pose = {};
  for (const side of ['l', 'r'] as const) {
    if (l.armP !== undefined) pose[`${side}ArmP`] = l.armP;
    if (l.armS !== undefined) pose[`${side}ArmS`] = l.armS;
    if (l.foreP !== undefined) pose[`${side}ForeP`] = l.foreP;
    if (l.foreS !== undefined) pose[`${side}ForeS`] = l.foreS;
    if (l.thighP !== undefined) pose[`${side}ThighP`] = l.thighP;
    if (l.thighS !== undefined) pose[`${side}ThighS`] = l.thighS;
    if (l.shinP !== undefined) pose[`${side}ShinP`] = l.shinP;
    if (l.shinS !== undefined) pose[`${side}ShinS`] = l.shinS;
    if (l.footP !== undefined) pose[`${side}FootP`] = l.footP;
  }
  return pose;
}

/** Relaxed stance: arms slightly away from the body, legs hip-width. */
const STAND: Pose = both({ armS: 7, foreS: 7, thighS: 4, shinS: 4 });

function pose(...parts: Pose[]): Pose {
  return Object.assign({}, STAND, ...parts);
}

/** Standard rep: hold, move, hold, return. `down` is the bottom/end position. */
function rep(up: Pose, down: Pose, downAt = 0.4, holdUntil = 0.55, upAt = 0.9) {
  return [
    { t: 0, pose: up },
    { t: downAt, pose: down },
    { t: holdUntil, pose: down },
    { t: upAt, pose: up },
  ];
}

// Back squat: bar on upper back, hands beside the shoulders.
const squatArms = both({ armP: -25, armS: 62, foreP: 165, foreS: 25 });
const squatTop = pose(squatArms, { spineP: 6 });
const squatBottom = pose(squatArms, {
  spineP: 42,
  neckP: -30,
  ...both({ thighP: 96, thighS: 14, shinP: -34, shinS: 6 }),
});

// Romanian deadlift: hips back, arms hang vertically, bar slides down thighs.
const hingeTop = pose(both({ armP: 3, armS: 8, foreP: 3, foreS: 8 }));
const hingeBottom = pose({
  spineP: 78,
  neckP: -25,
  ...both({ armP: 78, armS: 8, foreP: 78, foreS: 8, thighP: 18, shinP: -6 }),
});

// Bench press: lying face up on a bench, feet on the floor.
const benchBase: Pose = {
  rootP: -90,
  rootY: 0.64,
  ...both({ thighP: -12, thighS: 10, shinP: -88, shinS: 8, footP: 88 }),
};
const benchTop = { ...benchBase, ...both({ armP: 90, armS: 22, foreP: 90, foreS: 22 }) };
const benchBottom = { ...benchBase, ...both({ armP: 18, armS: 58, foreP: 92, foreS: 2 }) };

// Overhead press: from front rack to locked out above the head.
const pressRack = pose(both({ armP: 40, armS: 30, foreP: 170, foreS: 12 }));
const pressTop = pose(both({ armP: 176, armS: 14, foreP: 178, foreS: 12 }), { neckP: -5 });

// Bent-over row.
const rowBase: Pose = { spineP: 50, neckP: -25, ...both({ thighP: 22, shinP: -10 }) };
const rowDown = pose(rowBase, both({ armP: 50, armS: 10, foreP: 52, foreS: 10 }));
const rowUp = pose(rowBase, both({ armP: -25, armS: 18, foreP: 45, foreS: 6 }));

// Lat pulldown, seated.
const seated: Pose = { spineP: -10, ...both({ thighP: 90, thighS: 10, shinP: 0, shinS: 6 }) };
const pulldownTop = pose(seated, both({ armP: 172, armS: 28, foreP: 176, foreS: 30 }));
const pulldownBottom = pose(
  seated,
  { neckP: -10 },
  both({ armP: 8, armS: 52, foreP: 172, foreS: 22 }),
);

// Split squat / lunge: left leg in front, right leg behind.
const lungeArms = both({ armP: 0, armS: 8, foreP: 0, foreS: 8 });
const lungeTop = pose(lungeArms, {
  spineP: 8,
  lThighP: 28,
  lShinP: -6,
  rThighP: -26,
  rShinP: -32,
  rFootP: 50,
});
const lungeBottom = pose(lungeArms, {
  spineP: 12,
  lThighP: 86,
  lShinP: -12,
  rThighP: -8,
  rShinP: -84,
  rFootP: 70,
});

// Plank on forearms: body face down.
const plankBase: Pose = {
  rootP: 90,
  neckP: -10,
  ...both({ armP: 90, armS: 12, foreP: 178, foreS: 4, thighS: 3, shinS: 3 }),
};

// Push-up: body straight, hands under shoulders.
const pushTop: Pose = {
  rootP: 74,
  neckP: -12,
  ...both({ armP: 74, armS: 14, foreP: 74, foreS: 14, thighS: 3, shinS: 3, footP: 16 }),
};
const pushBottom: Pose = {
  rootP: 86,
  neckP: -14,
  ...both({ armP: 30, armS: 48, foreP: 86, foreS: 6, thighS: 3, shinS: 3, footP: 4 }),
};

// Biceps curl.
const curlDown = pose(both({ armP: 0, armS: 7, foreP: 0, foreS: 7 }));
const curlUp = pose(both({ armP: 10, armS: 7, foreP: 150, foreS: 4 }));

// Overhead triceps extension (forearms fold behind the head).
const triTop = pose(both({ armP: 172, armS: 10, foreP: 176, foreS: 10 }));
const triBottom = pose(both({ armP: 165, armS: 12, foreP: 300, foreS: 6 }));

// Calf raise.
const calfDown = pose();
const calfUp = pose(both({ footP: 38 }));

// Rear-delt fly, hinged torso.
const flyBase: Pose = { spineP: 68, neckP: -25, ...both({ thighP: 16, shinP: -8 }) };
const flyDown = pose(flyBase, both({ armP: 68, armS: 6, foreP: 72, foreS: 6 }));
const flyUp = pose(flyBase, both({ armP: 68, armS: 84, foreP: 70, foreS: 88 }));

// Lateral raise.
const latDown = pose(both({ armP: 2, armS: 8, foreP: 6, foreS: 8 }));
const latUp = pose(both({ armP: 8, armS: 84, foreP: 12, foreS: 86 }));

// Gait helpers: phase A = left leg forward.
function stride(
  leftThigh: number,
  leftShin: number,
  rightThigh: number,
  rightShin: number,
  armSwing: number,
  foreBend: number,
  extra: Pose = {},
): Pose {
  return pose(
    {
      lThighP: leftThigh,
      lShinP: leftShin,
      rThighP: rightThigh,
      rShinP: rightShin,
      lArmP: -armSwing,
      lForeP: -armSwing + foreBend,
      rArmP: armSwing,
      rForeP: armSwing + foreBend,
    },
    extra,
  );
}

// Seated cycling: pedals 180° out of phase.
function pedal(angleDeg: number): Pose {
  const a = (angleDeg * Math.PI) / 180;
  const b = a + Math.PI;
  return pose(both({ armP: 62, armS: 10, foreP: 70, foreS: 6 }), {
    rootY: 0.95,
    spineP: 38,
    neckP: -30,
    lThighP: 72 + 22 * Math.sin(a),
    lShinP: -6 + 26 * Math.sin(a - Math.PI / 2),
    rThighP: 72 + 22 * Math.sin(b),
    rShinP: -6 + 26 * Math.sin(b - Math.PI / 2),
    lFootP: 10,
    rFootP: 10,
  });
}

// Cat-cow on all fours.
const allFours: Pose = {
  rootP: 90,
  ...both({ thighP: 90, thighS: 6, shinP: 0, shinS: 6, footP: 90, armS: 10, foreS: 6 }),
};
const cow = { ...allFours, spineP: -10, chestP: -14, neckP: -28, ...both({ armP: 66, foreP: 66 }) };
const cat = { ...allFours, spineP: 12, chestP: 18, neckP: 40, ...both({ armP: 120, foreP: 120 }) };

// Thoracic rotation with arms held in front.
const rotArms = both({ armP: 88, armS: 4, foreP: 92, foreS: -6 });

export const CLIPS: Record<AnimationId, Clip> = {
  squat: {
    duration: 4.4,
    keyframes: rep(squatTop, squatBottom, 0.42, 0.52, 0.82),
    grounded: true,
    pinFeetZ: 0,
    props: ['barbell'],
  },
  hinge: {
    duration: 4.2,
    keyframes: rep(hingeTop, hingeBottom, 0.42, 0.5, 0.85),
    grounded: true,
    pinFeetZ: 0,
    props: ['barbell'],
  },
  'bench-press': {
    duration: 3.6,
    keyframes: rep(benchTop, benchBottom, 0.4, 0.52, 0.82),
    grounded: false,
    pinFeetZ: null,
    props: ['bench', 'barbell'],
  },
  'overhead-press': {
    duration: 3.4,
    keyframes: [
      { t: 0, pose: pressRack },
      { t: 0.3, pose: pressTop },
      { t: 0.45, pose: pressTop },
      { t: 0.85, pose: pressRack },
    ],
    grounded: true,
    pinFeetZ: 0,
    props: ['barbell'],
  },
  row: {
    duration: 3.2,
    keyframes: [
      { t: 0, pose: rowDown },
      { t: 0.35, pose: rowUp },
      { t: 0.5, pose: rowUp },
      { t: 0.9, pose: rowDown },
    ],
    grounded: true,
    pinFeetZ: 0,
    props: ['barbell'],
  },
  pulldown: {
    duration: 3.4,
    keyframes: rep(pulldownTop, pulldownBottom, 0.38, 0.52, 0.9),
    grounded: true,
    pinFeetZ: 0,
    props: ['seat', 'barbell'],
  },
  lunge: {
    duration: 3.6,
    keyframes: rep(lungeTop, lungeBottom, 0.4, 0.5, 0.85),
    grounded: true,
    pinFeetZ: 0,
    props: ['dumbbells'],
  },
  plank: {
    duration: 4,
    keyframes: [
      { t: 0, pose: plankBase },
      { t: 0.5, pose: { ...plankBase, spineP: -3, chestP: 2 } },
    ],
    grounded: true,
    pinFeetZ: -0.8,
    props: [],
  },
  'push-up': {
    duration: 2.8,
    keyframes: rep(pushTop, pushBottom, 0.42, 0.5, 0.88),
    grounded: true,
    pinFeetZ: -0.8,
    props: [],
  },
  curl: {
    duration: 3.4,
    keyframes: [
      { t: 0, pose: curlDown },
      { t: 0.25, pose: curlUp },
      { t: 0.38, pose: curlUp },
      { t: 0.9, pose: curlDown },
    ],
    grounded: true,
    pinFeetZ: 0,
    props: ['dumbbells'],
  },
  'triceps-extension': {
    duration: 3,
    keyframes: rep(triTop, triBottom, 0.4, 0.5, 0.85),
    grounded: true,
    pinFeetZ: 0,
    props: [],
  },
  'calf-raise': {
    duration: 3,
    keyframes: [
      { t: 0, pose: calfDown },
      { t: 0.3, pose: calfUp },
      { t: 0.55, pose: calfUp },
      { t: 0.9, pose: calfDown },
    ],
    grounded: true,
    pinFeetZ: 0,
    props: [],
  },
  'rear-delt-fly': {
    duration: 3,
    keyframes: [
      { t: 0, pose: flyDown },
      { t: 0.35, pose: flyUp },
      { t: 0.5, pose: flyUp },
      { t: 0.9, pose: flyDown },
    ],
    grounded: true,
    pinFeetZ: 0,
    props: ['dumbbells'],
  },
  'lateral-raise': {
    duration: 3,
    keyframes: [
      { t: 0, pose: latDown },
      { t: 0.35, pose: latUp },
      { t: 0.5, pose: latUp },
      { t: 0.9, pose: latDown },
    ],
    grounded: true,
    pinFeetZ: 0,
    props: ['dumbbells'],
  },
  carry: {
    duration: 1.2,
    keyframes: [
      { t: 0, pose: stride(22, -8, -18, -30, 0, 0, both({ armS: 12, foreS: 12 })) },
      { t: 0.25, pose: stride(2, -25, 2, -4, 0, 0, both({ armS: 12, foreS: 12 })) },
      { t: 0.5, pose: stride(-18, -30, 22, -8, 0, 0, both({ armS: 12, foreS: 12 })) },
      { t: 0.75, pose: stride(2, -4, 2, -25, 0, 0, both({ armS: 12, foreS: 12 })) },
    ],
    grounded: true,
    pinFeetZ: null,
    props: ['dumbbells'],
  },
  run: {
    duration: 0.72,
    keyframes: [
      { t: 0, pose: stride(48, -12, -22, -70, 38, 85, { spineP: 10 }) },
      { t: 0.25, pose: stride(14, -10, 30, -105, 4, 90, { spineP: 10 }) },
      { t: 0.5, pose: stride(-22, -70, 48, -12, -38, 85, { spineP: 10 }) },
      { t: 0.75, pose: stride(30, -105, 14, -10, -4, 90, { spineP: 10 }) },
    ],
    grounded: true,
    pinFeetZ: null,
    props: [],
  },
  bike: {
    duration: 1,
    keyframes: [0, 90, 180, 270].map((deg, i) => ({ t: i / 4, pose: pedal(deg) })),
    grounded: false,
    pinFeetZ: null,
    props: ['seat'],
  },
  mobility: {
    duration: 5,
    keyframes: [
      { t: 0, pose: pose(rotArms) },
      { t: 0.25, pose: pose(rotArms, { spineT: 50, neckP: 0 }) },
      { t: 0.5, pose: pose(rotArms) },
      { t: 0.75, pose: pose(rotArms, { spineT: -50 }) },
    ],
    grounded: true,
    pinFeetZ: 0,
    props: [],
  },
  'cat-cow': {
    duration: 4.5,
    keyframes: [
      { t: 0, pose: cow },
      { t: 0.45, pose: cat },
      { t: 0.55, pose: cat },
    ],
    grounded: true,
    pinFeetZ: null,
    props: [],
  },
};

export function getClip(id: AnimationId): Clip {
  return CLIPS[id];
}
