import { OmniMatrixError } from '../core/errors.js';
import { decodePayloadFrame, encodePayloadFrame, padPayloadFrame } from './frame.js';

/** M0.1 GF(256) field: polynomial 0x11d, alpha=2, first generator root alpha^0. */
const EXP = new Uint8Array(512);
const LOG = new Int16Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  for (let i = 255; i < EXP.length; i++) EXP[i] = EXP[i - 255]!;
}

function times(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!;
}
function divide(a: number, b: number): number {
  if (b === 0) throw new OmniMatrixError('ECC_UNRECOVERABLE', 'Division by zero in GF(256)');
  if (a === 0) return 0;
  return EXP[(LOG[a]! - LOG[b]! + 255) % 255]!;
}
function polyMul(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) out[i + j] = out[i + j]! ^ times(a[i]!, b[j]!);
  }
  return out;
}
function evaluateLow(poly: readonly number[], x: number): number {
  let acc = 0;
  for (let i = poly.length - 1; i >= 0; i--) acc = times(acc, x) ^ poly[i]!;
  return acc;
}
function syndromes(codeword: Uint8Array, count: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < count; j++) {
    const root = EXP[j]!;
    let sum = 0;
    for (const value of codeword) sum = times(sum, root) ^ value;
    out.push(sum);
  }
  return out;
}
function assertBlock(data: Uint8Array, parity: number, encoding: boolean): void {
  if (!(data instanceof Uint8Array) || !Number.isInteger(parity) || parity < 1 || parity > 254) {
    throw new OmniMatrixError('INVALID_INPUT', 'Expected bytes and parity count in [1,254]');
  }
  if (data.length + (encoding ? parity : 0) > 255 || data.length <= (encoding ? 0 : parity)) {
    throw new OmniMatrixError('INVALID_SIZE', 'RS block must satisfy parity < total length <= 255');
  }
}

/** Returns systematic shortened codeword: input data followed by parity bytes. Does not mutate input. */
export function encodeRsBlock(data: Uint8Array, parityBytes: number): Uint8Array {
  assertBlock(data, parityBytes, true);
  // Polynomial coefficients are stored highest-degree first here.
  let generator = [1];
  for (let i = 0; i < parityBytes; i++) {
    // Multiplication is commutative, so this works for high-degree-first coefficients.
    generator = polyMul(generator, [1, EXP[i]!]);
  }
  const out = new Uint8Array(data.length + parityBytes);
  out.set(data);
  for (let i = 0; i < data.length; i++) {
    const lead = out[i]!;
    if (lead === 0) continue;
    for (let j = 1; j < generator.length; j++) out[i + j] = out[i + j]! ^ times(lead, generator[j]!);
  }
  out.set(data, 0);
  return out;
}

export interface CorrectedRsBlock {
  /** A fresh, full systematic codeword, including corrected parity. */
  readonly codeword: Uint8Array;
  readonly data: Uint8Array;
  readonly correctedSymbols: number;
  readonly correctedPositions: readonly number[];
}

/** Corrects up to floor(parity/2) arbitrary byte errors using Berlekamp–Massey and Forney. */
export function decodeRsBlock(codeword: Uint8Array, parityBytes: number): CorrectedRsBlock {
  assertBlock(codeword, parityBytes, false);
  const received = codeword.slice();
  const s = syndromes(received, parityBytes);
  if (s.every((v) => v === 0)) {
    return { codeword: received, data: received.slice(0, -parityBytes), correctedSymbols: 0, correctedPositions: [] };
  }

  // Locate errors using a low-degree-first connection polynomial C(z).
  let C: number[] = [1];
  let B: number[] = [1];
  let length = 0;
  let shift = 1;
  let previous = 1;
  for (let n = 0; n < s.length; n++) {
    let discrepancy = s[n]!;
    for (let i = 1; i <= length; i++) discrepancy ^= times(C[i] ?? 0, s[n - i]!);
    if (discrepancy === 0) { shift++; continue; }
    const prior = C.slice();
    const scale = divide(discrepancy, previous);
    while (C.length < B.length + shift) C.push(0);
    for (let j = 0; j < B.length; j++) C[j + shift] = C[j + shift]! ^ times(scale, B[j]!);
    if (2 * length <= n) {
      length = n + 1 - length;
      B = prior;
      previous = discrepancy;
      shift = 1;
    } else shift++;
  }
  if (length < 1 || 2 * length > parityBytes) {
    throw new OmniMatrixError('ECC_UNRECOVERABLE', 'Too many errors for RS parity');
  }
  // Solve error locations against actual shortened positions, not zero-prepended offsets.
  const errorLocations: { position: number; x: number; inverse: number }[] = [];
  for (let pos = 0; pos < received.length; pos++) {
    const x = EXP[(received.length - 1 - pos) % 255]!;
    const inverse = EXP[(255 - (received.length - 1 - pos) % 255) % 255]!;
    if (evaluateLow(C, inverse) === 0) errorLocations.push({ position: pos, x, inverse });
  }
  if (errorLocations.length !== length) {
    throw new OmniMatrixError('ECC_UNRECOVERABLE', 'Error locator has invalid roots');
  }

  // Omega = [S(z) * C(z)] mod z^P; formal derivative of C contains only odd terms in char 2.
  const omega = polyMul(s, C).slice(0, parityBytes);
  for (const location of errorLocations) {
    let derivative = 0;
    for (let i = 1; i < C.length; i += 2) {
      derivative ^= times(C[i]!, EXP[(LOG[location.inverse]! * (i - 1)) % 255]!);
    }
    // Formal derivative can also be evaluated directly via field exponentiation.
    if (derivative === 0) throw new OmniMatrixError('ECC_UNRECOVERABLE', 'Repeated error-locator root');
    const magnitude = divide(times(location.x, evaluateLow(omega, location.inverse)), derivative);
    received[location.position] = received[location.position]! ^ magnitude;
  }
  if (!syndromes(received, parityBytes).every((v) => v === 0)) {
    throw new OmniMatrixError('ECC_UNRECOVERABLE', 'RS syndromes remain after correction');
  }
  return {
    codeword: received,
    data: received.slice(0, -parityBytes),
    correctedSymbols: errorLocations.length,
    correctedPositions: errorLocations.map(({ position }) => position),
  };
}

export type EccProfile = 'LIGHT' | 'MEDIUM' | 'STRONG' | 0 | 1 | 2;
export interface RsLayout {
  readonly encodedBytes: number;
  readonly parityBytesPerBlock: number;
  readonly blockCount: number;
  readonly blockLengths: readonly number[];
  readonly dataLengths: readonly number[];
  readonly dataCapacityBytes: number;
  readonly maximumPayloadBytes: number;
}

function parityFor(profile: EccProfile): number {
  switch (profile) {
    case 0: case 'LIGHT': return 16;
    case 1: case 'MEDIUM': return 32;
    case 2: case 'STRONG': return 64;
    default: throw new OmniMatrixError('INVALID_INPUT', 'Unknown Reed–Solomon profile');
  }
}

/** Exact M0.1 block partitioning of C encoded byte slots, including shortened last blocks. */
export function getRsLayout(encodedBytes: number, profile: EccProfile = 'MEDIUM'): RsLayout {
  if (!Number.isSafeInteger(encodedBytes) || encodedBytes < 1 || encodedBytes > 2_000_000) {
    throw new OmniMatrixError('INVALID_SIZE', 'Encoded capacity must be an integer in [1,2000000]');
  }
  const parityBytesPerBlock = parityFor(profile);
  const blockCount = Math.ceil(encodedBytes / 255);
  const shortLength = Math.floor(encodedBytes / blockCount);
  const longer = encodedBytes % blockCount;
  if (shortLength <= parityBytesPerBlock) {
    throw new OmniMatrixError('CAPACITY_EXCEEDED', 'RS block too short for the selected parity profile');
  }
  const blockLengths = Array.from({ length: blockCount }, (_, i) => shortLength + (i < longer ? 1 : 0));
  const dataLengths = blockLengths.map((size) => size - parityBytesPerBlock);
  const dataCapacityBytes = encodedBytes - blockCount * parityBytesPerBlock;
  return { encodedBytes, parityBytesPerBlock, blockCount, blockLengths, dataLengths,
    dataCapacityBytes, maximumPayloadBytes: Math.max(-1, dataCapacityBytes - 20) };
}

/** Encode K_total data bytes to C column-interleaved RS bytes (strict, no implicit zero fill). */
export function encodeReedSolomon(data: Uint8Array, encodedCapacityBytes: number, profile: EccProfile = 'MEDIUM'): Uint8Array {
  const layout = getRsLayout(encodedCapacityBytes, profile);
  if (!(data instanceof Uint8Array)) throw new OmniMatrixError('INVALID_INPUT', 'Expected Uint8Array data');
  if (data.length !== layout.dataCapacityBytes) {
    throw new OmniMatrixError('INVALID_SIZE', `Expected exactly ${layout.dataCapacityBytes} input data bytes`);
  }
  let offset = 0;
  const blocks = layout.dataLengths.map((k) => {
    const block = encodeRsBlock(data.subarray(offset, offset + k), layout.parityBytesPerBlock);
    offset += k;
    return block;
  });
  const result = new Uint8Array(encodedCapacityBytes);
  let p = 0;
  const maxLength = Math.max(...layout.blockLengths);
  for (let j = 0; j < maxLength; j++) for (const block of blocks) {
    if (j < block.length) result[p++] = block[j]!;
  }
  if (p !== result.length) throw new OmniMatrixError('INVALID_FRAME', 'RS interleave length mismatch');
  return result;
}

export interface DecodedReedSolomon {
  readonly data: Uint8Array;
  readonly correctedSymbols: number;
  readonly correctedBlocks: number;
  readonly layout: RsLayout;
}

/** Deinterleave and correct arbitrary byte errors in C encoded bytes. */
export function decodeReedSolomon(encoded: Uint8Array, profile: EccProfile = 'MEDIUM'): DecodedReedSolomon {
  if (!(encoded instanceof Uint8Array)) throw new OmniMatrixError('INVALID_INPUT', 'Expected Uint8Array encoded bytes');
  const layout = getRsLayout(encoded.length, profile);
  const blocks = layout.blockLengths.map((length) => new Uint8Array(length));
  let p = 0;
  const maxLength = Math.max(...layout.blockLengths);
  for (let j = 0; j < maxLength; j++) for (const block of blocks) {
    if (j < block.length) block[j] = encoded[p++]!;
  }
  const data = new Uint8Array(layout.dataCapacityBytes);
  let correctedSymbols = 0;
  let correctedBlocks = 0;
  let offset = 0;
  for (const block of blocks) {
    const recovered = decodeRsBlock(block, layout.parityBytesPerBlock);
    data.set(recovered.data, offset);
    offset += recovered.data.length;
    correctedSymbols += recovered.correctedSymbols;
    if (recovered.correctedSymbols > 0) correctedBlocks++;
  }
  return { data, correctedSymbols, correctedBlocks, layout };
}

export interface ProtectedPayload {
  readonly encoded: Uint8Array;
  readonly layout: RsLayout;
}
/** OMD1 -> zero-filled K -> real RS codewords -> column interleaving. */
export function protectPayload(
  payload: string | Uint8Array,
  encodedCapacityBytes: number,
  profile: EccProfile = 'MEDIUM',
): ProtectedPayload {
  const layout = getRsLayout(encodedCapacityBytes, profile);
  const frame = encodePayloadFrame(payload, { maxFrameBytes: layout.dataCapacityBytes });
  const padded = padPayloadFrame(frame, layout.dataCapacityBytes);
  return { encoded: encodeReedSolomon(padded, encodedCapacityBytes, profile), layout };
}

export interface RecoveredPayload extends DecodedReedSolomon {
  readonly payload: Uint8Array;
  readonly paddingBytes: number;
}
/** Deinterleave -> correct -> OMD1/CRC32 + strict zero padding verification. */
export function recoverPayload(encoded: Uint8Array, profile: EccProfile = 'MEDIUM'): RecoveredPayload {
  const decoded = decodeReedSolomon(encoded, profile);
  const frame = decodePayloadFrame(decoded.data, {
    maxFrameBytes: decoded.layout.dataCapacityBytes, allowZeroPadding: true,
  });
  return { ...decoded, payload: frame.data, paddingBytes: frame.paddingBytes };
}
