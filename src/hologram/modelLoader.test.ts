/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelLoadError, ModelMismatchError } from './modelError';
import { loadHumanModel, MODEL_URL } from './modelLoader';

const glb = () => {
  const buf = readFileSync(resolve(__dirname, '../../public/models/human.glb'));
  // A fresh ArrayBuffer of the test realm (GLTFLoader checks instanceof).
  const data = new ArrayBuffer(buf.byteLength);
  new Uint8Array(data).set(buf);
  return data;
};

const respond = (body: ArrayBuffer | string, status = 200, type = 'model/gltf-binary') =>
  Promise.resolve(new Response(body, { status, headers: { 'content-type': type } }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadHumanModel', () => {
  it('rejects an HTML page served instead of the model, then retries on the next call', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => respond('<!doctype html><html></html>', 200, 'text/html'))
      .mockImplementationOnce(() => respond(glb()));
    vi.stubGlobal('fetch', fetchMock);

    const failed = loadHumanModel();
    await expect(failed).rejects.toBeInstanceOf(ModelLoadError);
    await expect(failed).rejects.toThrow(/not a binary glTF \(text\/html\)/);

    const scene = await loadHumanModel();
    expect(scene.getObjectByName('lShin')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(MODEL_URL);
    // Success is cached: no third request.
    await loadHumanModel();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('wraps HTTP and network errors in ModelLoadError', async () => {
    vi.resetModules();
    const { loadHumanModel: load } = await import('./modelLoader');
    const { ModelLoadError: LoadError } = await import('./modelError');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() => respond('missing', 404, 'text/plain'))
        .mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(load()).rejects.toThrow(/HTTP 404/);
    const error = await load().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LoadError);
    expect((error as Error).cause).toBeInstanceOf(TypeError);
  });

  it('counts a skeleton mismatch as a model failure', () => {
    expect(new ModelMismatchError('bad bone')).toBeInstanceOf(ModelLoadError);
  });
});
