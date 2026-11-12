import type { Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HUMAN_MODEL_HASH } from './humanSkeleton';
import { ModelLoadError } from './modelError';

/** Self-hosted CC0 human model (see docs/ASSETS.md); relative to the page. */
export const MODEL_URL = `${import.meta.env.BASE_URL}models/human.glb?v=${HUMAN_MODEL_HASH}`;

let pending: Promise<Object3D> | null = null;

/**
 * Loads the human model once and shares it (each controller clones it). A
 * failed load is not cached, so the next call - a retry or the next exercise
 * opened - fetches again.
 */
export function loadHumanModel(): Promise<Object3D> {
  pending ??= fetchModel(MODEL_URL).catch((error: unknown) => {
    pending = null;
    throw error instanceof ModelLoadError
      ? error
      : new ModelLoadError('Human model could not be loaded', { cause: error });
  });
  return pending;
}

async function fetchModel(url: string): Promise<Object3D> {
  const response = await fetch(url);
  if (!response.ok) throw new ModelLoadError(`Human model request failed: HTTP ${response.status}`);
  const data = await response.arrayBuffer();
  // A missing file on a SPA host comes back as index.html with status 200:
  // check the binary glTF magic before handing it to the parser.
  const magic = new TextDecoder().decode(new Uint8Array(data, 0, Math.min(4, data.byteLength)));
  if (magic !== 'glTF') {
    const type = response.headers.get('content-type') ?? 'unknown type';
    throw new ModelLoadError(`Human model is not a binary glTF (${type})`);
  }
  const gltf = await new GLTFLoader().parseAsync(data, '');
  return gltf.scene;
}
