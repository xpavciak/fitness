import { describe, expect, it } from 'vitest';
import { listExercises } from '../plan';
import type { AnimationId } from '../plan/types';
import { CLIPS, getClip } from './clips';
import { CHANNELS, limbDirection, samplePose, smoothstep, wrapPhase, type Clip } from './pose';

const clip: Clip = {
  duration: 2,
  keyframes: [
    { t: 0, pose: { lArmP: 0 } },
    { t: 0.5, pose: { lArmP: 100, spineP: 40 } },
  ],
  grounded: true,
  pinFeetZ: 0,
  props: [],
};

describe('samplePose', () => {
  it('returns keyframe values exactly at keyframe times', () => {
    expect(samplePose(clip, 0).lArmP).toBe(0);
    expect(samplePose(clip, 0.5).lArmP).toBe(100);
    expect(samplePose(clip, 0.5).spineP).toBe(40);
  });

  it('eases between keyframes and defaults missing channels to 0', () => {
    const mid = samplePose(clip, 0.25);
    expect(mid.lArmP).toBeCloseTo(50);
    expect(mid.spineP).toBeCloseTo(20);
    expect(mid.rThighP).toBe(0);
    expect(samplePose(clip, 0.1).lArmP).toBeLessThan(20); // ease-in, not linear
  });

  it('loops from the last keyframe back to the first', () => {
    expect(samplePose(clip, 0.75).lArmP).toBeCloseTo(50);
    expect(samplePose(clip, 1).lArmP).toBe(0);
    expect(samplePose(clip, 3.25).lArmP).toBeCloseTo(samplePose(clip, 0.25).lArmP);
    expect(samplePose(clip, -0.75).lArmP).toBeCloseTo(50);
  });

  it('throws for an empty clip', () => {
    expect(() => samplePose({ ...clip, keyframes: [] }, 0)).toThrow(/no keyframes/);
  });
});

describe('helpers', () => {
  it('smoothstep and wrapPhase stay in range', () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(2)).toBe(1);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(wrapPhase(1.25)).toBeCloseTo(0.25);
    expect(wrapPhase(-0.25)).toBeCloseTo(0.75);
  });

  it('limbDirection maps pitch/side to unit vectors', () => {
    const near = (v: number[], e: number[]) => v.forEach((x, i) => expect(x).toBeCloseTo(e[i]!));
    near(limbDirection(0, 0, 1), [0, -1, 0]);
    near(limbDirection(90, 0, 1), [0, 0, 1]);
    near(limbDirection(180, 0, 1), [0, 1, 0]);
    near(limbDirection(0, 90, 1), [1, 0, 0]);
    near(limbDirection(0, 90, -1), [-1, 0, 0]);
  });
});

describe('clip library', () => {
  it('has a valid clip for every animation id used by exercises', () => {
    const ids = new Set<AnimationId>(listExercises().map((e) => e.animation));
    for (const id of ids) expect(CLIPS[id], id).toBeDefined();
  });

  it('every clip is well-formed and actually moves', () => {
    for (const [id, c] of Object.entries(CLIPS)) {
      expect(c.duration, id).toBeGreaterThan(0);
      expect(c.keyframes[0]?.t, id).toBe(0);
      c.keyframes.forEach((k, i) => {
        expect(k.t, id).toBeGreaterThanOrEqual(0);
        expect(k.t, id).toBeLessThan(1);
        if (i > 0) expect(k.t, id).toBeGreaterThan(c.keyframes[i - 1]!.t);
        for (const key of Object.keys(k.pose)) expect(CHANNELS, id).toContain(key);
      });
      const a = samplePose(c, 0);
      const moved = c.keyframes.some((k) => {
        const b = samplePose(c, k.t);
        return CHANNELS.some((ch) => Math.abs(a[ch] - b[ch]) > 2);
      });
      expect(moved, `${id} should animate`).toBe(true);
    }
  });

  it('maps key exercises to recognisable patterns', () => {
    expect(getClip('squat').props).toContain('barbell');
    expect(getClip('bench-press').props).toContain('bench');
    expect(getClip('bench-press').keyframes[0]?.pose.rootP).toBe(-90);
    expect(getClip('plank').keyframes[0]?.pose.rootP).toBe(90);
  });
});
