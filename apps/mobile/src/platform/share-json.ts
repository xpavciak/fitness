import { Directory, File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

/** Export file names (`fitness-data-YYYY-MM-DD.json`). */
const EXPORT_FILE = /^fitness-data-.*\.json$/;

/**
 * iOS/Android: writes the JSON document to a cache file, opens the system share sheet with that
 * file (so it can be saved to Files, mailed, etc.) and deletes the cache copy afterwards. The web
 * build uses `share-json.web.ts`.
 */
export async function shareJson(fileName: string, json: string): Promise<string> {
  if (!(await isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  try {
    file.write(json);
    await shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: fileName,
    });
  } finally {
    // The health data must not linger in the cache once it has been handed over.
    if (file.exists) {
      file.delete();
    }
  }
  return `Shared ${fileName}.`;
}

/** Removes any export files left in the cache (e.g. after a crash during sharing). */
export function deleteExportFiles(): Promise<void> {
  for (const entry of new Directory(Paths.cache).list()) {
    if (entry instanceof File && EXPORT_FILE.test(entry.name)) {
      entry.delete();
    }
  }
  return Promise.resolve();
}
