/**
 * Timing helpers for authoring motion: eased keyframe tracks in seconds,
 * periodic splines for cyclic trajectories (gait, pedalling) and small
 * vector utilities. Framework-free.
 */
export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'controlled' | 'explosive';

const EASES: Record<Ease, (x: number) => number> = {
  linear: (x) => x,
  in: (x) => x * x,
  out: (x) => 1 - (1 - x) * (1 - x),
  inOut: (x) => x * x * (3 - 2 * x),
  // Slow, even eccentric: short ramps, constant speed in between.
  controlled: (x) => {
    const r = 0.25;
    if (x < r) return (x * x) / (2 * r) / (1 - r);
    if (x > 1 - r) return (1 - r - ((1 - x) * (1 - x)) / (2 * r)) / (1 - r);
    return (r / 2 + x - r) / (1 - r);
  },
  // Concentric drive: fast acceleration, long deceleration into lockout.
  explosive: (x) => 1 - Math.pow(1 - x, 3) * (1 + 3 * x),
};

export function ease(kind: Ease, x: number): number {
  return EASES[kind](Math.min(1, Math.max(0, x)));
}

export interface Key {
  /** Seconds from the start of the loop. */
  at: number;
  value: number;
  /** Easing of the segment that ends at this key (default inOut). */
  ease?: Ease;
}

/** Wraps time into [0, duration). */
export function wrapTime(t: number, duration: number): number {
  return ((t % duration) + duration) % duration;
}

/**
 * Looping keyframe track. The segment after the last key returns to the first
 * key (using the first key's easing) at `duration + keys[0].at`.
 */
export function track(duration: number, keys: readonly Key[]): (t: number) => number {
  if (keys.length === 0) throw new Error('Track needs at least one key');
  for (let i = 1; i < keys.length; i++) {
    if (keys[i]!.at <= keys[i - 1]!.at) throw new Error('Track keys must be sorted');
  }
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (last.at >= duration + first.at) throw new Error('Track keys exceed the loop');
  return (time: number) => {
    let t = wrapTime(time, duration);
    if (t < first.at) t += duration;
    for (let i = 0; i < keys.length; i++) {
      const a = keys[i]!;
      const b = keys[i + 1] ?? { ...first, at: first.at + duration };
      if (t >= a.at && t <= b.at) {
        const span = b.at - a.at;
        const k = span > 0 ? ease(b.ease ?? 'inOut', (t - a.at) / span) : 1;
        return a.value + (b.value - a.value) * k;
      }
    }
    return first.value;
  };
}

/** Linear interpolation. */
export const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Hermite smoothstep: 0 below `edge0`, 1 above `edge1`, smooth in between. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const k = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return k * k * (3 - 2 * k);
}

/**
 * Periodic Catmull-Rom spline through `points` (each a tuple of numbers)
 * placed at the given phases in [0, 1). Returns a smooth closed curve. The
 * returned array is reused between calls (no per-frame allocation): read it
 * before calling the curve again.
 */
export function loopSpline(
  phases: readonly number[],
  points: readonly (readonly number[])[],
): (phase: number) => number[] {
  const n = points.length;
  if (n < 3 || phases.length !== n) throw new Error('loopSpline needs >= 3 matching points');
  const out: number[] = new Array<number>(points[0]!.length).fill(0);
  return (phase: number) => {
    const p = ((phase % 1) + 1) % 1;
    let i = n - 1;
    for (let k = 0; k < n; k++) {
      const next = k + 1 < n ? phases[k + 1]! : phases[0]! + 1;
      const start = phases[k]!;
      const q = p < start ? p + 1 : p;
      if (q >= start && q < next) {
        i = k;
        break;
      }
    }
    const t0 = phases[i]!;
    const t1 = i + 1 < n ? phases[i + 1]! : phases[0]! + 1;
    const q = p < t0 ? p + 1 : p;
    const u = (q - t0) / (t1 - t0);
    const P0 = points[(i - 1 + n) % n]!;
    const P1 = points[i]!;
    const P2 = points[(i + 1) % n]!;
    const P3 = points[(i + 2) % n]!;
    const u2 = u * u;
    const u3 = u2 * u;
    for (let c = 0; c < out.length; c++) {
      const a = P0[c]!;
      const b = P1[c]!;
      const d = P2[c]!;
      const e = P3[c]!;
      out[c] =
        0.5 *
        (2 * b + (-a + d) * u + (2 * a - 5 * b + 4 * d - e) * u2 + (-a + 3 * b - 3 * d + e) * u3);
    }
    return out;
  };
}
