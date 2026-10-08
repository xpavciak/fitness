/** Delay before the object URL is revoked; some browsers start the download asynchronously. */
export const REVOKE_DELAY_MS = 10_000;

/** Web: downloads the JSON document as a file. */
export function shareJson(fileName: string, json: string): Promise<string> {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_DELAY_MS);
  return Promise.resolve(`Downloaded ${fileName}.`);
}
