/** M18: optional binary envelope. Independent of the OMD1 optical frame. */
import { crc32IsoHdlc } from '../protocol/crc32.js';

const MAGIC = Uint8Array.of(0x4f, 0x4d, 0x58, 0x45); // OMXE
const HEADER_BYTES = 20;
const MAX_DATA_BYTES = 16 * 1024 * 1024;
const MAX_META_BYTES = 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

export type BinaryEnvelopeKind = 'file' | 'blob';
export interface BinaryEnvelopeInput {
  readonly kind?: BinaryEnvelopeKind;
  readonly mediaType?: string;
  readonly filename?: string;
  readonly data: Uint8Array;
}
export interface BinaryEnvelope {
  readonly version: 1;
  readonly kind: BinaryEnvelopeKind;
  readonly mediaType: string;
  readonly filename?: string;
  readonly data: Uint8Array;
}
function bad(message: string): never { throw new TypeError('Invalid OmniMatrix binary envelope: ' + message); }
function validateMediaType(input: string | undefined): string {
  const type = input ?? 'application/octet-stream';
  if (typeof type !== 'string' || type.length > 160 || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(type)) bad('invalid media type');
  return type.toLowerCase();
}
function validateFilename(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'string' || !input || input === '.' || input === '..' || /[\\/\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069<>:"|?*]/u.test(input)) bad('invalid filename');
  const bytes = encoder.encode(input);
  if (bytes.length > 255 || input !== input.normalize('NFC')) bad('filename exceeds 255 bytes or is not NFC');
  return input;
}
function validateData(data: Uint8Array): void {
  if (!(data instanceof Uint8Array)) bad('data must be Uint8Array');
  if (data.byteLength > MAX_DATA_BYTES) bad('data exceeds 16 MiB safety limit');
}
/** An OMXE prefix is a *candidate* envelope, not evidence of validated content. */
export function isBinaryEnvelope(bytes: Uint8Array): boolean {
  return bytes instanceof Uint8Array && bytes.byteLength >= 4 && MAGIC.every((value, index) => bytes[index] === value);
}
/** Encode one optional typed payload envelope. Never compresses, signs or encrypts data. */
export function packBinaryEnvelope(input: BinaryEnvelopeInput): Uint8Array {
  if (!input || typeof input !== 'object') bad('missing input');
  validateData(input.data);
  const kind = input.kind ?? 'file';
  if (kind !== 'file' && kind !== 'blob') bad('unknown kind');
  const mediaType = validateMediaType(input.mediaType);
  const filename = validateFilename(input.filename);
  if (kind === 'blob' && filename !== undefined) bad('blob must not include a filename');
  const mime = encoder.encode(mediaType), name = encoder.encode(filename ?? '');
  if (mime.length + name.length > MAX_META_BYTES) bad('metadata too large');
  const output = new Uint8Array(HEADER_BYTES + mime.length + name.length + input.data.byteLength);
  const view = new DataView(output.buffer);
  output.set(MAGIC, 0);
  output[4] = 1; // version
  output[5] = kind === 'file' ? 1 : 2; // kind
  output[6] = 0; output[7] = 0; // reserved flags
  view.setUint16(8, mime.length, false);
  view.setUint16(10, name.length, false);
  view.setUint32(12, input.data.byteLength, false);
  output.set(mime, HEADER_BYTES);
  output.set(name, HEADER_BYTES + mime.length);
  output.set(input.data, HEADER_BYTES + mime.length + name.length);
  // CRC covers version, kind, reserved flags, lengths, metadata and data.
  const protectedBytes = new Uint8Array(12 + output.length - HEADER_BYTES);
  protectedBytes.set(output.subarray(4, 16));
  protectedBytes.set(output.subarray(HEADER_BYTES), 12);
  view.setUint32(16, crc32IsoHdlc(protectedBytes), false);
  return output;
}
/** Decode a complete, strict v1 envelope, rejecting unknown versions and trailing bytes. */
export function unpackBinaryEnvelope(bytes: Uint8Array): BinaryEnvelope {
  if (!(bytes instanceof Uint8Array) || !isBinaryEnvelope(bytes)) bad('missing OMXE magic');
  if (bytes.length < HEADER_BYTES) bad('truncated header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[4] !== 1) bad('unsupported version');
  const kindCode = bytes[5];
  if (kindCode !== 1 && kindCode !== 2) bad('unknown kind');
  if (bytes[6] !== 0 || bytes[7] !== 0) bad('unsupported flags');
  const mimeLen = view.getUint16(8, false), nameLen = view.getUint16(10, false), dataLen = view.getUint32(12, false);
  if (mimeLen + nameLen > MAX_META_BYTES || dataLen > MAX_DATA_BYTES || HEADER_BYTES + mimeLen + nameLen + dataLen !== bytes.length) bad('invalid lengths or trailing bytes');
  const protectedBytes = new Uint8Array(12 + bytes.length - HEADER_BYTES);
  protectedBytes.set(bytes.subarray(4, 16));
  protectedBytes.set(bytes.subarray(HEADER_BYTES), 12);
  if (crc32IsoHdlc(protectedBytes) !== view.getUint32(16, false)) bad('CRC-32 mismatch');
  let mediaType: string, filename: string | undefined;
  try {
    mediaType = validateMediaType(decoder.decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + mimeLen)));
    const rawName = decoder.decode(bytes.subarray(HEADER_BYTES + mimeLen, HEADER_BYTES + mimeLen + nameLen));
    filename = rawName ? validateFilename(rawName) : undefined;
  } catch { return bad('invalid UTF-8 or metadata'); }
  if (kindCode === 2 && filename !== undefined) bad('blob must not include filename');
  return {version: 1, kind:kindCode === 1 ? 'file' : 'blob', mediaType, ...(filename === undefined ? {} : {filename}), data:bytes.slice(HEADER_BYTES + mimeLen + nameLen)};
}
