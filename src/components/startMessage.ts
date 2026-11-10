import { daysBetween, type TrainingPlan } from '../plan';

/** Slovak plural for days: 2–4 "dni", 5+ "dní". */
function daysWord(n: number): string {
  return n >= 2 && n <= 4 ? 'dni' : 'dní';
}

export function startMessage(plan: TrainingPlan, today: string): string {
  const until = daysBetween(today, plan.startDate);
  if (until > 1) return `Plán začína o ${until} ${daysWord(until)}.`;
  if (until === 1) return 'Plán začína zajtra.';
  if (until === 0) return 'Plán začína dnes. Veľa šťastia!';
  if (today > plan.endDate) return 'Plán skončil. Môžeš začať nový.';
  return `Prebieha ${Math.floor(-until / 7) + 1}. týždeň plánu.`;
}
