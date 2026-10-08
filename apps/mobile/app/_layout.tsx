import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { newId } from '../src/platform/ids';
import { deleteExportFiles } from '../src/platform/share-json';
import { deviceTimeZone } from '../src/platform/timezone';
import { StoreProvider, type Services } from '../src/state/store';
import { asyncStorageStore } from '../src/storage/async-storage-store';
import { LocalRepository } from '../src/storage/repository';
import { NoopSyncAdapter } from '../src/sync/sync-adapter';

const services: Services = {
  repository: new LocalRepository(asyncStorageStore),
  // Local-first (D4): swap in a Supabase adapter once a project and credentials exist.
  sync: new NoopSyncAdapter(),
  newId,
  timezone: deviceTimeZone,
  now: () => new Date().toISOString(),
  deleteExportFiles,
};

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider services={services}>
        <StatusBar style="dark" />
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ title: 'Set up your plan' }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="workout/[sessionId]" options={{ title: 'Workout' }} />
        </Stack>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
