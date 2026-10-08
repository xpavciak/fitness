import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStore } from './key-value-store';

/** AsyncStorage-backed store (SQLite/files on native, `localStorage` on web). */
export const asyncStorageStore: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};
