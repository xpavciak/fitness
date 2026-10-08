import { randomUUID } from 'expo-crypto';
import type { IdGenerator } from '@fitness/engine';

/** Client-generated entity ids (UUID v4), as the engine and Supabase schema expect. */
export const newId: IdGenerator = () => randomUUID();
