import { isValidTimeZone } from '@fitness/engine';
import { getCalendars } from 'expo-localization';

/** The device's IANA time zone, falling back to `Intl`, then UTC. */
export function deviceTimeZone(): string {
  const candidates = [
    ...getCalendars().map((calendar) => calendar.timeZone),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ];
  return candidates.find((zone): zone is string => !!zone && isValidTimeZone(zone)) ?? 'UTC';
}
