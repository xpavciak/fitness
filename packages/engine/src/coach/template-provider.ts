import { weeklyStreak, type AdherenceStats, type WeekAdherence } from '../adherence/adherence.js';
import { EXERCISE_CATALOG } from '../catalog/index.js';
import { createCatalogLookup } from '../catalog/lookup.js';
import { weekdayIndex } from '../dates.js';
import type { Exercise, Plan, Profile } from '../schemas/index.js';

/**
 * Coach texts (decision D5): a short plan explanation and a weekly reflection. The rules engine
 * stays the source of truth; these texts only explain it. Implementations never give medical
 * advice and never blame the user.
 */
export interface CoachText {
  text: string;
  /** `ai`: written by the model via the proxy; `template`: the deterministic fallback. */
  source: 'ai' | 'template';
}

export interface CoachTextProvider {
  /** Plain-English explanation of a generated plan. */
  explainPlan(plan: Plan, profile: Profile): Promise<CoachText>;
  /** Plain-English reflection on one week (`weekIndex` is 0-based, as in `stats.weeks`). */
  weeklyReflection(stats: AdherenceStats, weekIndex: number, profile: Profile): Promise<CoachText>;
}

export const NOT_MEDICAL_ADVICE = 'This is general fitness guidance, not medical advice.';
const RATIONALE_DISCLAIMER = 'This plan is general fitness guidance, not medical advice.';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function list(items: readonly string[]): string {
  if (items.length <= 1) {
    return items.join('');
  }
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Finds a week's stats or throws a clear error. */
export function weekStats(stats: AdherenceStats, weekIndex: number): WeekAdherence {
  const week = stats.weeks.find((candidate) => candidate.week_index === weekIndex);
  if (!week) {
    throw new RangeError(`Week ${weekIndex} is not in the adherence stats`);
  }
  return week;
}

/**
 * Deterministic, template-based coach texts. Used on its own when no AI proxy is configured and
 * as the fallback for `createClaudeCoachProvider`. Only uses structured data: free text from the
 * profile (`limitation_notes`, slot locations) is never repeated.
 */
export class TemplateCoachProvider implements CoachTextProvider {
  private readonly lookup: (id: string) => Exercise;

  constructor(catalog: readonly Exercise[] = EXERCISE_CATALOG) {
    this.lookup = createCatalogLookup(catalog);
  }

  // `.then` turns a thrown error (e.g. an unknown week) into a rejected promise.
  explainPlan(plan: Plan, profile: Profile): Promise<CoachText> {
    return Promise.resolve().then(() => ({
      text: this.planText(plan, profile),
      source: 'template' as const,
    }));
  }

  weeklyReflection(stats: AdherenceStats, weekIndex: number, profile: Profile): Promise<CoachText> {
    return Promise.resolve().then(() => ({
      text: this.reflectionText(stats, weekIndex, profile),
      source: 'template' as const,
    }));
  }

  /** Synchronous version of `explainPlan` (deterministic). */
  planText(plan: Plan, profile: Profile): string {
    const firstWeek = plan.weeks[0];
    const sessions = firstWeek?.sessions ?? [];
    const days = list(sessions.map((s) => DAY_NAMES[weekdayIndex(s.scheduled_date)] ?? ''));
    const keyLifts = [
      ...new Set(
        sessions.flatMap((s) =>
          s.exercises.filter((pe) => pe.is_key).map((pe) => this.lookup(pe.exercise_id).name),
        ),
      ),
    ].slice(0, 4);
    const parts = [
      `Here is your ${plan.weeks.length}-week plan: ${plural(sessions.length, 'session')} a week${days ? ` on ${days}` : ''}, about ${profile.session_minutes} minutes each.`,
    ];
    if (keyLifts.length > 0) {
      parts.push(`The main lifts are ${list(keyLifts)}; they come first in each session.`);
    }
    if (plan.rationale_text) {
      // The generator ends its rationale with its own disclaimer; ours is appended once below.
      parts.push(plan.rationale_text.replace(RATIONALE_DISCLAIMER, '').trim());
    }
    parts.push(
      'If a session does not fit your week, you can move, shorten or skip it, and progress carries on.',
    );
    parts.push(NOT_MEDICAL_ADVICE);
    return parts.filter((part) => part !== '').join(' ');
  }

  /** Synchronous version of `weeklyReflection` (deterministic). */
  reflectionText(stats: AdherenceStats, weekIndex: number, profile: Profile): string {
    const week = weekStats(stats, weekIndex);
    const streak = weeklyStreak(stats);
    const label = `week ${weekIndex + 1}`;
    const parts: string[] = [];

    if (week.status === 'future') {
      return `Week ${weekIndex + 1} has not started yet. ${plural(week.planned, 'session')} ${week.planned === 1 ? 'is' : 'are'} planned; pick the times that suit you and you are set.`;
    }
    if (week.planned === 0) {
      parts.push(
        week.skipped > 0
          ? `You chose to skip ${label}. Rest is part of training, and your progress picks up where you left off.`
          : `Nothing was planned for ${label}, so enjoy the rest.`,
      );
    } else if (week.status === 'current' && week.upcoming > 0) {
      parts.push(
        `So far in ${label}: ${week.completed} of ${plural(week.planned, 'session')} done, ${week.upcoming} still to go.`,
      );
      if (week.missed > 0) {
        const slipped = week.missed === 1 ? 'One session' : `${week.missed} sessions`;
        parts.push(
          `${slipped} slipped, and that is fine. If time is short, a 10-15 minute minimum dose still counts. The trick is to get the next one in.`,
        );
      }
    } else if (week.completed >= week.planned) {
      parts.push(
        `You completed all ${plural(week.planned, 'planned session')} in ${label}. That is exactly how progress is built.`,
      );
    } else if (week.completed > 0) {
      parts.push(
        `You completed ${week.completed} of ${plural(week.planned, 'session')} in ${label}. Every session counts.`,
      );
      parts.push(
        'Next week, try putting the key session first; if time gets tight, a 10-15 minute minimum dose keeps the habit going.',
      );
    } else {
      parts.push(
        `${capitalize(label)} did not go to plan, and that is okay: life happens. Start next week with one session, even a 10-15 minute minimum dose.`,
      );
    }

    if (streak.current >= 2) {
      parts.push(`You are on a ${streak.current}-week streak.`);
    } else if (streak.best >= 2 && streak.current === 0) {
      parts.push(
        `Your best streak so far is ${streak.best} weeks; a new one starts with your next session.`,
      );
    }
    if (profile.experience_level === 'beginner' && week.completed > 0) {
      parts.push('Keep stopping each set with a few reps in reserve; technique first.');
    }
    return parts.join(' ');
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
