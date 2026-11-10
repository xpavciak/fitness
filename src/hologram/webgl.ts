let cachedAvailability: boolean | undefined;

function detectWebGL(): boolean {
  if (typeof window === 'undefined' || typeof window.WebGLRenderingContext === 'undefined') {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return false;
    // Release the probe context right away; browsers cap live WebGL contexts.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch (error) {
    console.warn('WebGL detection failed', error);
    return false;
  }
}

/** True when the browser can create a WebGL context. Detected once per page. */
export function isWebGLAvailable(): boolean {
  cachedAvailability ??= detectWebGL();
  return cachedAvailability;
}

/** Test helper: forget the cached result. */
export function resetWebGLDetection(): void {
  cachedAvailability = undefined;
}
