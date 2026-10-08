import { describe, expect, it } from 'vitest';
import { onboardedPlan } from '../test/fixtures';
import { explainPlan, toCoachText } from './engine-service';

describe('coach texts (D5, template provider only)', () => {
  it('normalizes both provider shapes', () => {
    expect(toCoachText('Hello')).toEqual({ text: 'Hello', source: 'template' });
    expect(toCoachText({ text: 'Hi', source: 'ai' })).toEqual({ text: 'Hi', source: 'ai' });
    expect(() => toCoachText({ text: 'x', source: 'llm' })).toThrow(TypeError);
    expect(() => toCoachText(null)).toThrow(TypeError);
  });

  it('explains a plan from the template, with the disclaimer', () => {
    const { plan, outcome } = onboardedPlan();
    const explanation = explainPlan(plan, outcome.profile);
    expect(explanation.source).toBe('template');
    expect(explanation.text).toMatch(/6-week plan/);
    expect(explanation.text).toMatch(/not medical advice/);
  });
});
