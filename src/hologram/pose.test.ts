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
  it('writes into a provided output object (no per-frame allocation)', () => {
    const out = samplePose(clip, 0);
    expect(samplePose(clip, 0.5, out)).toBe(out);
    expect(out.lArmP).toBe(100);
  });

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

  it('shows props that match each exercise’s equipment', () => {
    for (const ex of listExercises()) {
      const props = getClip(ex.animation).props;
      // Check the primary option, e.g. "Veľká činka alebo jednoručky" -> barbell.
      const equipment = (ex.equipment.toLowerCase().split(' alebo ')[0] ?? '').trim();
      if (equipment.startsWith('bez náradia')) expect(props, ex.id).toEqual([]);
      if (equipment.startsWith('veľká činka')) expect(props, ex.id).toContain('barbell');
      if (/jednoručk/.test(equipment)) {
        expect(
          props.some((p) => p === 'dumbbells' || p === 'dumbbell-right'),
          ex.id,
        ).toBe(true);
      }
      if (/lavic/.test(equipment)) {
        expect(
          props.some((p) => p.endsWith('bench')),
          ex.id,
        ).toBe(true);
      }
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

  it('maps key exercises to recognisable patterns', () => {
    expect(getClip('squat').props).toContain('barbell');
    expect(getClip('bench-press').props).toContain('bench');
    expect(getClip('bench-press').keyframes[0]?.pose.rootP).toBe(-90);
    expect(getClip('plank').keyframes[0]?.pose.rootP).toBe(90);
  });
});
