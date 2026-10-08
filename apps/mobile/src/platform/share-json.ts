import { Platform, Share } from 'react-native';

/**
 * Hands a JSON document to the user: a file download on web, the system share sheet on
 * iOS/Android. Returns a short description of what happened.
 */
export async function shareJson(fileName: string, json: string): Promise<string> {
  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return `Downloaded ${fileName}.`;
  }
  const result = await Share.share({ title: fileName, message: json });
  return result.action === Share.dismissedAction ? 'Export cancelled.' : 'Export shared.';
}
