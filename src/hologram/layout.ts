/**
 * Real-world placement and dimensions of the equipment (metres). Shared by
 * the clips (where the body goes) and the props (what is drawn) so hands,
 * feet and backs meet the equipment exactly.
 */

/** Olympic barbell: 2.2 m, 28 mm shaft, 50 mm sleeves, 450 mm plates. */
export const BARBELL = {
  length: 2.2,
  shaftRadius: 0.014,
  sleeveRadius: 0.025,
  /** Inner collar position from the centre. */
  collar: 0.66,
  plateRadius: 0.225,
} as const;

export const DUMBBELL = {
  handle: 0.13,
  handleRadius: 0.016,
  headRadius: 0.07,
  headLength: 0.11,
} as const;

/** Flat bench, lifter's head towards -z. */
export const FLAT_BENCH = { top: 0.44, width: 0.29, zHead: -1.02, zFoot: 0.18 } as const;

/** Incline bench at 30°: seat front at +z, back pad rising towards -z. */
export const INCLINE_BENCH = {
  seatTop: 0.46,
  seatFront: 0.22,
  seatBack: -0.12,
  angle: 30,
  backLength: 0.86,
  width: 0.29,
} as const;

/** Bench for one-arm rows: along z on the figure's left (+x). */
export const ROW_BENCH = { top: 0.44, width: 0.29, x: 0.16, z0: -0.62, z1: 0.48 } as const;

/** Box/bench for the rear foot of the Bulgarian split squat. */
export const SPLIT_BENCH = { top: 0.44, z: -0.66, depth: 0.32, width: 0.4 } as const;

/** Half rack behind a squatter at the origin: uprights, J-hooks, safety arms. */
export const SQUAT_RACK = {
  halfWidth: 0.62,
  zFront: 0.5,
  zBack: -0.42,
  height: 1.95,
  hook: 1.36,
  safety: 0.9,
} as const;

/** Upright J-hooks at the head end of the flat bench. */
export const BENCH_RACK = { halfWidth: 0.56, z: -0.86, height: 1.14 } as const;

/** Lat pulldown station. */
export const PULLDOWN = {
  seatTop: 0.5,
  seatZ: -0.02,
  padY: 0.71,
  padZ: 0.2,
  pulley: [0, 2.42, 0.12] as const,
  columnZ: -0.55,
} as const;

/** Cable column behind the lifter for overhead triceps extensions. */
export const CABLE = { pulley: [0, 1.32, -0.82] as const, columnZ: -0.92 } as const;

/** Step for calf raises: balls of the feet on the back edge. */
export const STEP = { top: 0.14, edgeZ: 0.0, depth: 0.36, width: 0.7 } as const;

/** Treadmill deck for running in place. */
export const TREADMILL = { deck: 0.16, length: 1.7, width: 0.55, z: 0.05 } as const;

/** Stationary bike. */
export const BIKE = {
  crankCentre: [0, 0.3, 0.12] as const,
  crank: 0.17,
  pedalHalfWidth: 0.12,
  saddle: [0, 0.94, -0.17] as const,
  bars: [0, 1.06, 0.52] as const,
  barHalfWidth: 0.24,
} as const;

/** Exercise mat. */
export const MAT = { length: 1.85, width: 0.62, thickness: 0.008 } as const;
