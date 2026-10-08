/**
 * Minimal async key-value storage. The app uses AsyncStorage (`async-storage-store.ts`, which
 * falls back to `localStorage` on web); tests use `MemoryKeyValueStore`.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly items = new Map<string, string>();

  getItem(key: string): Promise<string | null> {
    return Promise.resolve(this.items.get(key) ?? null);
  }

  setItem(key: string, value: string): Promise<void> {
    this.items.set(key, value);
    return Promise.resolve();
  }

  removeItem(key: string): Promise<void> {
    this.items.delete(key);
    return Promise.resolve();
  }

  /** Test helper: the raw stored keys. */
  keys(): string[] {
    return [...this.items.keys()];
  }
}
