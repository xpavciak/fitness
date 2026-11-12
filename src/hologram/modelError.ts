/**
 * The human model could not be fetched or decoded (network error, missing
 * file served as HTML, corrupt download). Unlike a WebGL failure this may be
 * temporary, so the UI offers a retry instead of disabling 3D.
 *
 * Kept free of three.js imports: the error boundary in the main bundle checks
 * for it without pulling in the 3D chunk.
 */
export class ModelLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ModelLoadError';
  }
}

/** The model loaded but does not match the generated skeleton data (a bad deploy). */
export class ModelMismatchError extends ModelLoadError {
  constructor(message: string) {
    super(message);
    this.name = 'ModelMismatchError';
  }
}

export function isModelLoadError(error: unknown): error is ModelLoadError {
  return error instanceof ModelLoadError;
}
