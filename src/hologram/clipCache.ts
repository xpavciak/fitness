import { Quaternion } from 'three';
import type { BarState, Clip, ClipFrame } from './clipKit';
import { BONE_COUNT } from './skeleton';
import type { BodyPose, BodySolver } from './solver';

/** Cached samples per second of clip time. */
export const CACHE_RATE = 60;

interface Sample {
  frame: ClipFrame;
  rot: number[];
  pos: number[];
}

/**
 * Lazily caches a clip's solved poses at a fixed rate and interpolates between
 * them. Clips balance and bisect (several full solves per frame); with the
 * cache each sample is solved once, on the first loop, and every later frame
 * only blends two cached samples - no solver work and no allocations.
 *
 * Sample `n` is the clip evaluated at `duration` (not wrapped to 0), so values
 * that grow with time inside a loop (belt travel) interpolate correctly into
 * the wrap.
 */
export class ClipCache {
  private readonly count: number;
  private readonly samples: (Sample | undefined)[];
  private readonly scratch: ClipFrame;
  private readonly barCenter: [number, number, number] = [0, 0, 0];
  private readonly bar: BarState = { center: this.barCenter };
  private readonly rotBuf = [0, 0, 0, 1];

  constructor(readonly clip: Clip) {
    this.count = Math.max(2, Math.round(clip.duration * CACHE_RATE));
    this.samples = new Array<Sample | undefined>(this.count + 1);
    // Placeholder targets; overwritten by the first evaluate().
    this.scratch = {
      targets: undefined as unknown as ClipFrame['targets'],
      breath: 0,
      contacts: [],
    };
  }

  /** Number of samples solved so far (for tests). */
  get solved(): number {
    return this.samples.reduce((n, s) => n + (s ? 1 : 0), 0);
  }

  /**
   * Writes the interpolated pose at `time` (wrapped into the loop) into `out`
   * and returns the interpolated frame. The returned frame object is reused.
   */
  evaluate(time: number, solver: BodySolver, out: BodyPose): ClipFrame {
    const d = this.clip.duration;
    const t = ((time % d) + d) % d;
    const x = (t / d) * this.count;
    const i = Math.min(this.count - 1, Math.floor(x));
    const k = x - i;
    const a = this.sample(i, solver);
    const b = this.sample(i + 1, solver);

    const q = this.rotBuf;
    for (let bone = 0; bone < BONE_COUNT; bone++) {
      Quaternion.slerpFlat(q, 0, a.rot, bone * 4, b.rot, bone * 4, k);
      out.rot[bone]!.set(q[0]!, q[1]!, q[2]!, q[3]!);
      const o = bone * 3;
      out.pos[bone]!.set(
        a.pos[o]! + (b.pos[o]! - a.pos[o]!) * k,
        a.pos[o + 1]! + (b.pos[o + 1]! - a.pos[o + 1]!) * k,
        a.pos[o + 2]! + (b.pos[o + 2]! - a.pos[o + 2]!) * k,
      );
    }
    return this.blendFrames(a.frame, b.frame, k);
  }

  private sample(i: number, solver: BodySolver): Sample {
    const cached = this.samples[i];
    if (cached) return cached;
    const frame = this.clip.frame((i / this.count) * this.clip.duration, solver);
    const pose = solver.solve(frame.targets);
    const rot = new Array<number>(BONE_COUNT * 4);
    const pos = new Array<number>(BONE_COUNT * 3);
    for (let bone = 0; bone < BONE_COUNT; bone++) {
      pose.rot[bone]!.toArray(rot, bone * 4);
      pose.pos[bone]!.toArray(pos, bone * 3);
    }
    const s = { frame, rot, pos };
    this.samples[i] = s;
    return s;
  }

  private blendFrames(a: ClipFrame, b: ClipFrame, k: number): ClipFrame {
    const f = this.scratch;
    // Discrete data (targets, contacts, bar frame) comes from the nearer sample.
    const near = k < 0.5 ? a : b;
    f.targets = near.targets;
    f.contacts = near.contacts;
    f.breath = lerp(a.breath, b.breath, k);
    f.opacity = a.opacity === undefined ? undefined : lerp(a.opacity, b.opacity ?? 1, k);
    f.belt = a.belt === undefined ? undefined : lerp(a.belt, b.belt ?? a.belt, k);
    if (a.crank === undefined) f.crank = undefined;
    else {
      const turn = (b.crank ?? a.crank) - a.crank;
      f.crank = a.crank + Math.atan2(Math.sin(turn), Math.cos(turn)) * k;
    }
    if (a.bar) {
      const c = this.barCenter;
      const bc = b.bar?.center ?? a.bar.center;
      for (let j = 0; j < 3; j++) c[j] = lerp(a.bar.center[j]!, bc[j]!, k);
      this.bar.frame = near.bar?.frame ?? a.bar.frame;
      f.bar = this.bar;
    } else {
      f.bar = undefined;
    }
    return f;
  }
}

function lerp(x: number, y: number, k: number): number {
  return x + (y - x) * k;
}
