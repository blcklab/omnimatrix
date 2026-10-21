import { OmniMatrixError } from './errors.js';
/** Independently cloned binary input; protects callers from accidental mutation. */
export function toBytes(input: string | Uint8Array): Uint8Array {
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return new Uint8Array(input);
  throw new OmniMatrixError('INVALID_INPUT', 'Expected a UTF-8 string or Uint8Array');
}

/** Strict, lossless UTF-8 decoding. Invalid UTF-8 is rejected rather than replaced. */
export function fromUtf8(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) throw new OmniMatrixError('INVALID_INPUT', 'Expected Uint8Array');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new OmniMatrixError('INVALID_INPUT', 'Invalid UTF-8 data'); }
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) {
    if (!(part instanceof Uint8Array)) throw new OmniMatrixError('INVALID_INPUT', 'Expected Uint8Array');
    total += part.length;
    if (!Number.isSafeInteger(total)) throw new OmniMatrixError('INVALID_SIZE', 'Concatenated byte length too large');
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

export function writeU32BE(buffer: Uint8Array, offset: number, value: number): void {
  assertSpan(buffer, offset, 4);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new OmniMatrixError('INVALID_INPUT', 'Expected uint32');
  }
  buffer[offset] = (value >>> 24) & 255;
  buffer[offset + 1] = (value >>> 16) & 255;
  buffer[offset + 2] = (value >>> 8) & 255;
  buffer[offset + 3] = value & 255;
}

export function readU32BE(buffer: Uint8Array, offset: number): number {
  assertSpan(buffer, offset, 4);
  return ((buffer[offset]! * 2 ** 24) + (buffer[offset + 1]! << 16) + (buffer[offset + 2]! << 8) + buffer[offset + 3]!) >>> 0;
}

function assertSpan(buffer: Uint8Array, offset: number, length: number): void {
  if (!(buffer instanceof Uint8Array) || !Number.isSafeInteger(offset) || offset < 0) {
    throw new OmniMatrixError('INVALID_INPUT', 'Invalid byte buffer or offset');
  }
  if (offset > buffer.length - length) throw new OmniMatrixError('UNEXPECTED_EOF', 'Not enough bytes available');
}
