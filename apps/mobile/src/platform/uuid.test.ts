import { IdSchema } from '@fitness/engine';
import { describe, expect, it } from 'vitest';
import { uuidV4FromBytes } from './uuid';

describe('uuidV4FromBytes (getRandomValues fallback for insecure web contexts)', () => {
  it('sets the version and variant bits', () => {
    const id = uuidV4FromBytes(new Uint8Array(16).fill(0xff));
    expect(id).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(IdSchema.safeParse(id).success).toBe(true);
    expect(IdSchema.safeParse(uuidV4FromBytes(new Uint8Array(16))).success).toBe(true);
  });

  it('rejects the wrong number of bytes and does not mutate the input', () => {
    expect(() => uuidV4FromBytes(new Uint8Array(8))).toThrow(RangeError);
    const bytes = new Uint8Array(16).fill(0xff);
    uuidV4FromBytes(bytes);
    expect(bytes[6]).toBe(0xff);
  });
});
