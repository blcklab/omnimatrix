import { toBytes, readU32BE, writeU32BE } from '../core/bytes.js';
import { OmniMatrixError } from '../core/errors.js';
import { crc32IsoHdlc } from './crc32.js';

/** M0.1 draft: OMD1 main frame, which will become the RS *input* in M4. */
export const PAYLOAD_FRAME_HEADER_BYTES = 20;
export const PAYLOAD_FRAME_MAGIC = 'OMD1';
export const COMPRESSION_NONE = 0;
export const COMPRESSION_BROTLI_RESERVED = 1;

export interface EncodePayloadFrameOptions {
  /** M3 deliberately supports NONE only; BROTLI is reserved for a future adapter. */
  readonly compression?: 0 | 1;
  /** Optional maximum number of bytes available for frame *before* ECC. */
  readonly maxFrameBytes?: number;
}

export interface DecodePayloadFrameOptions {
  /** Mandatory for callers decoding an optical symbol: bound claims by the decoded layout capacity. */
  readonly maxFrameBytes?: number;
  /** Set true for M4's zero-filled RS data capacity. Default requires an exact frame. */
  readonly allowZeroPadding?: boolean;
}

export interface PayloadFrameHeader {
  readonly magic: typeof PAYLOAD_FRAME_MAGIC;
  readonly compression: 0;
  readonly flags: 0;
  readonly originalLength: number;
  readonly storedLength: number;
  readonly crc32: number;
  readonly frameLength: number;
}

export interface DecodedPayloadFrame {
  /** Independent allocation; safe to mutate without affecting the supplied encoded buffer. */
  readonly data: Uint8Array;
  readonly header: PayloadFrameHeader;
  /** Number of zero pad bytes after the payload frame (when explicitly permitted). */
  readonly paddingBytes: number;
}

function assertMaximum(maxFrameBytes: number | undefined): void {
  if (maxFrameBytes !== undefined &&
      (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 0)) {
    throw new OmniMatrixError('INVALID_INPUT', 'maxFrameBytes must be a nonnegative safe integer');
  }
}

/** Exact encoded input length, before Reed–Solomon and zero-fill. */
export function requiredPayloadFrameBytes(payloadBytes: number): number {
  if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 0 || payloadBytes > 0xffffffff) {
    throw new OmniMatrixError('INVALID_SIZE', 'Payload length must be a uint32 byte count');
  }
  return PAYLOAD_FRAME_HEADER_BYTES + payloadBytes;
}

/** Build the deterministic uncompressed OMD1 frame (no RS, no color mapping). */
export function encodePayloadFrame(
  input: string | Uint8Array,
  options: EncodePayloadFrameOptions = {},
): Uint8Array {
  if (options === null || typeof options !== 'object') {
    throw new OmniMatrixError('INVALID_INPUT', 'Invalid frame options');
  }
  const compression = options.compression ?? COMPRESSION_NONE;
  if (compression !== COMPRESSION_NONE) {
    throw new OmniMatrixError('UNSUPPORTED_COMPRESSION', `Compression ${String(compression)} is not implemented`);
  }
  assertMaximum(options.maxFrameBytes);
  const source = toBytes(input);
  const size = requiredPayloadFrameBytes(source.length);
  if (options.maxFrameBytes !== undefined && size > options.maxFrameBytes) {
    throw new OmniMatrixError('CAPACITY_EXCEEDED', 'Frame exceeds the supplied byte capacity');
  }
  const frame = new Uint8Array(size);
  frame.set([0x4f, 0x4d, 0x44, 0x31], 0); // ASCII OMD1
  // 4 compression, 5 flags, 6..7 reserved: zero by default.
  writeU32BE(frame, 8, source.length);
  writeU32BE(frame, 12, source.length);
  writeU32BE(frame, 16, crc32IsoHdlc(source));
  frame.set(source, PAYLOAD_FRAME_HEADER_BYTES);
  return frame;
}

/** Parse and validate header without copying or allocating payload bytes. */
export function readPayloadFrameHeader(
  frame: Uint8Array,
  options: Pick<DecodePayloadFrameOptions, 'maxFrameBytes'> = {},
): PayloadFrameHeader {
  if (!(frame instanceof Uint8Array) || options === null || typeof options !== 'object') {
    throw new OmniMatrixError('INVALID_INPUT', 'Expected a frame and valid options');
  }
  assertMaximum(options.maxFrameBytes);
  if (options.maxFrameBytes !== undefined && frame.length > options.maxFrameBytes) {
    throw new OmniMatrixError('CAPACITY_EXCEEDED', 'Provided frame exceeds layout capacity');
  }
  if (frame.length < PAYLOAD_FRAME_HEADER_BYTES) {
    throw new OmniMatrixError('UNEXPECTED_EOF', 'Truncated OMD1 frame header');
  }
  if (frame[0] !== 0x4f || frame[1] !== 0x4d || frame[2] !== 0x44 || frame[3] !== 0x31) {
    throw new OmniMatrixError('INVALID_FRAME', 'Not an OMD1 payload frame');
  }
  if (frame[4] !== COMPRESSION_NONE) {
    throw new OmniMatrixError('UNSUPPORTED_COMPRESSION', `Unknown or unsupported compression ${frame[4]}`);
  }
  if (frame[5] !== 0 || frame[6] !== 0 || frame[7] !== 0) {
    throw new OmniMatrixError('INVALID_FRAME', 'Flags and reserved bytes must be zero');
  }
  const originalLength = readU32BE(frame, 8);
  const storedLength = readU32BE(frame, 12);
  if (originalLength !== storedLength) {
    throw new OmniMatrixError('INVALID_FRAME', 'NONE profile requires equal original/stored lengths');
  }
  const frameLength = requiredPayloadFrameBytes(storedLength);
  if (options.maxFrameBytes !== undefined && frameLength > options.maxFrameBytes) {
    throw new OmniMatrixError('CAPACITY_EXCEEDED', 'Claimed payload exceeds layout capacity');
  }
  if (frameLength > frame.length) {
    throw new OmniMatrixError('UNEXPECTED_EOF', 'Stored data is shorter than declared payload length');
  }
  return {
    magic: PAYLOAD_FRAME_MAGIC,
    compression: COMPRESSION_NONE,
    flags: 0,
    originalLength,
    storedLength,
    crc32: readU32BE(frame, 16),
    frameLength,
  };
}

/** Decode exact OMD1 frame, or explicitly verified zero-fill from future RS data blocks. */
export function decodePayloadFrame(
  frame: Uint8Array,
  options: DecodePayloadFrameOptions = {},
): DecodedPayloadFrame {
  if (options === null || typeof options !== 'object' ||
      (options.allowZeroPadding !== undefined && typeof options.allowZeroPadding !== 'boolean')) {
    throw new OmniMatrixError('INVALID_INPUT', 'Invalid decode options');
  }
  const header = readPayloadFrameHeader(frame, options);
  const trailing = frame.length - header.frameLength;
  if (trailing > 0) {
    if (!options.allowZeroPadding) {
      throw new OmniMatrixError('INVALID_FRAME', 'Unexpected bytes after end of frame');
    }
    for (let i = header.frameLength; i < frame.length; i++) {
      if (frame[i] !== 0) {
        throw new OmniMatrixError('INVALID_PADDING', 'Nonzero trailing RS data padding');
      }
    }
  }
  // No allocation until the frame header and claimed lengths pass validation.
  const data = frame.slice(PAYLOAD_FRAME_HEADER_BYTES, header.frameLength);
  if (crc32IsoHdlc(data) !== header.crc32) {
    throw new OmniMatrixError('CRC_MISMATCH', 'Payload CRC-32 verification failed');
  }
  return { data, header, paddingBytes: trailing };
}

/** Explicit padding for future M4 RS input. Does not modify caller-owned bytes. */
export function padPayloadFrame(frame: Uint8Array, frameCapacityBytes: number): Uint8Array {
  if (!Number.isSafeInteger(frameCapacityBytes) || frameCapacityBytes < 0) {
    throw new OmniMatrixError('INVALID_INPUT', 'frameCapacityBytes must be a nonnegative safe integer');
  }
  const { header } = decodePayloadFrame(frame);
  if (header.frameLength !== frame.length) {
    throw new OmniMatrixError('INVALID_FRAME', 'Only exact frames can be padded');
  }
  if (frame.length > frameCapacityBytes) {
    throw new OmniMatrixError('CAPACITY_EXCEEDED', 'Frame exceeds target capacity');
  }
  const result = new Uint8Array(frameCapacityBytes);
  result.set(frame);
  return result;
}
