/** Formats 16 random bytes as an RFC 4122 version 4 UUID. */
export function uuidV4FromBytes(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new RangeError(`Expected 16 random bytes, got ${bytes.length}`);
  }
  const b = Uint8Array.from(bytes);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40; // version 4
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(b, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
