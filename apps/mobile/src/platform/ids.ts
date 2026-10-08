import type { IdGenerator } from '@fitness/engine';
import { getRandomValues, randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';
import { uuidV4FromBytes } from './uuid';

/**
 * On web, `crypto.randomUUID` (used by expo-crypto) only exists in secure contexts (https or
 * localhost). Elsewhere `crypto.getRandomValues`, which is always available, builds the UUID.
 */
function hasRandomUUID(): boolean {
  return Platform.OS !== 'web' || typeof globalThis.crypto.randomUUID === 'function';
}

/** Client-generated entity ids (UUID v4), as the engine and Supabase schema expect. */
export const newId: IdGenerator = () =>
  hasRandomUUID() ? randomUUID() : uuidV4FromBytes(getRandomValues(new Uint8Array(16)));
