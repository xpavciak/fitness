import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

/**
 * iOS/Android: writes the JSON document to a cache file and opens the system share sheet with
 * that file (so it can be saved to Files, mailed, etc.). The web build uses `share-json.web.ts`.
 */
export async function shareJson(fileName: string, json: string): Promise<string> {
  if (!(await isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(json);
  await shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: fileName,
  });
  return `Shared ${fileName}.`;
}
