/** True when the browser can create a WebGL context. */
export function isWebGLAvailable(): boolean {
  if (typeof window === 'undefined' || typeof window.WebGLRenderingContext === 'undefined') {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch (error) {
    console.warn('WebGL detection failed', error);
    return false;
  }
}
