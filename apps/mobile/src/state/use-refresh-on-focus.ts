import { useFocusEffect } from 'expo-router';
import { useStore } from './store';

/** Recomputes "today" whenever the screen gains focus (e.g. switching tabs after midnight). */
export function useRefreshOnFocus(): void {
  const { controller } = useStore();
  useFocusEffect(controller.refreshClock);
}
