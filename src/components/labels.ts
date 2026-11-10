import type { DayType, SectionKind } from '../plan';

export const APP_NAME = 'Tréningový plán';

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  gym: 'Posilňovňa',
  cardio: 'Beh',
  rest: 'Odpočinok',
};

export const DAY_TYPE_DESCRIPTIONS: Record<DayType, string> = {
  gym: 'silový tréning – nohy, tlak alebo ťah',
  cardio: 'beh alebo iné kardio',
  rest: 'regenerácia alebo mobilita',
};

export const SECTION_ICONS: Record<SectionKind, string> = {
  warmup: '1',
  main: '2',
  mobility: '+',
  cooldown: '3',
};

export function minutesLabel(minutes: number): string {
  return `${minutes} min`;
}
