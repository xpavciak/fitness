import { describe, expect, it } from 'vitest';
import { CACHE_RATE, ClipCache } from './clipCache';
import { CLIPS } from './clips';
import { BodySolver, createPose, gripPoint } from './solver';

describe('ClipCache', () => {
  it('reproduces the clip exactly at sample times', () => {
    const solver = new BodySolver();
    const cache = new ClipCache(CLIPS.squat);
    const out = createPose();
    for (const t of [0, 1, 2.5, 4]) {
      const frame = cache.evaluate(t, solver, out);
      const direct = new BodySolver();
      const expected = direct.solve(CLIPS.squat.frame(t, direct).targets);
      for (let b = 0; b < out.rot.length; b++) {
        expect(out.rot[b]!.angleTo(expected.rot[b]!)).toBeLessThan(1e-4);
        expect(out.pos[b]!.distanceTo(expected.pos[b]!)).toBeLessThan(1e-5);
      }
      expect(frame.bar!.center[1]).toBeCloseTo(CLIPS.squat.frame(t, direct).bar!.center[1], 5);
    }
  });

  it('stays close to the clip between samples (hands within 1 cm of a fresh solve)', () => {
    const solver = new BodySolver();
    const cache = new ClipCache(CLIPS['bench-press']);
    const out = createPose();
    for (let t = 0.004; t < CLIPS['bench-press'].duration; t += 0.137) {
      cache.evaluate(t, solver, out);
      const direct = new BodySolver();
      const expected = direct.solve(CLIPS['bench-press'].frame(t, direct).targets);
      for (const s of ['l', 'r'] as const) {
        expect(gripPoint(out, s).distanceTo(gripPoint(expected, s)), `@${t}`).toBeLessThan(0.01);
      }
    }
  });

  it('solves every sample once; later loops reuse the cache', () => {
    const solver = new BodySolver();
    const clip = CLIPS.curl;
    const cache = new ClipCache(clip);
    const out = createPose();
    const step = 1 / 60;
    for (let t = 0; t < clip.duration; t += step) cache.evaluate(t, solver, out);
    const solved = cache.solved;
    expect(solved).toBeLessThanOrEqual(Math.round(clip.duration * CACHE_RATE) + 1);
    for (let t = clip.duration; t < 3 * clip.duration; t += step) cache.evaluate(t, solver, out);
    expect(cache.solved).toBe(solved);
  });

  it('interpolates time-driven values into the loop wrap without a backwards jump', () => {
    const solver = new BodySolver();
    const clip = CLIPS.run;
    const cache = new ClipCache(clip);
    const out = createPose();
    const before = cache.evaluate(clip.duration - 0.002, solver, out).belt!;
    const end = clip.frame(clip.duration, solver).belt!;
    expect(before).toBeLessThanOrEqual(end);
    expect(end - before).toBeLessThan(0.05);
  });
});
