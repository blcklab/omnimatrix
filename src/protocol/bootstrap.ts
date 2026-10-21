/** Only the M0 CRC-verified optical bootstrap; no payload encoder yet. */
export function crc16CcittFalse(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
export interface HeaderConfig {
  readonly S: number;
  readonly palette: 0 | 1;
  readonly ecc?: 0 | 1 | 2;
  readonly mask?: 0 | 1;
}
export function makeHeader(c: HeaderConfig): Uint8Array {
  if (!Number.isInteger(c.S) || c.S < 32 || c.S > 512 || c.S % 16) throw new RangeError('Invalid S');
  const ecc = c.ecc ?? 1, mask = c.mask ?? 1;
  if (![0, 1].includes(c.palette) || ![0, 1, 2].includes(ecc) || ![0, 1].includes(mask)) throw new RangeError('Header value invalid');
  // 16 magic + 4 version + 10 S + 2 mode + 2 palette + 2 ECC + 3 mask + 1 flags + 8 reserved.
  let fields = 0x4f4dn;
  for (const [value, bits] of [[1, 4], [c.S, 10], [0, 2], [c.palette, 2], [ecc, 2], [mask, 3], [0, 1], [0, 8]] as const) {
    fields = (fields << BigInt(bits)) | BigInt(value);
  }
  const bytes = new Uint8Array(8);
  for (let i = 5; i >= 0; --i) { bytes[i] = Number(fields & 0xffn); fields >>= 8n; }
  const crc = crc16CcittFalse(bytes.subarray(0, 6));
  bytes[6] = crc >>> 8; bytes[7] = crc & 255;
  return bytes;
}
export function readHeader(bytes: Uint8Array): HeaderConfig {
  if (bytes.length !== 8 || crc16CcittFalse(bytes.subarray(0, 6)) !== ((bytes[6]! << 8) | bytes[7]!)) throw new Error('INVALID_HEADER');
  let b = 0n;
  for (const x of bytes.subarray(0, 6)) b = (b << 8n) | BigInt(x);
  function take(n: number): number { const value = Number(b & ((1n << BigInt(n)) - 1n)); b >>= BigInt(n); return value; }
  const reserved = take(8), flags = take(1), mask = take(3), ecc = take(2), palette = take(2), mode = take(2), S = take(10), version = take(4), magic = take(16);
  if (reserved || flags || mode || version !== 1 || magic !== 0x4f4d || (palette !== 0 && palette !== 1) || ecc > 2 || mask > 1 || S < 32 || S > 512 || S % 16) throw new Error('UNSUPPORTED_HEADER');
  return { S, palette: palette as 0 | 1, ecc: ecc as 0 | 1 | 2, mask: mask as 0 | 1 };
}
export function headerBit(bytes: Uint8Array, i: number): number {
  return (bytes[i >>> 3]! >>> (7 - (i & 7))) & 1;
}
