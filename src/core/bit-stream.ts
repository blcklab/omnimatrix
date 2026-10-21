import { OmniMatrixError } from './errors.js';

function assertWidth(width: number): void {
  if (!Number.isInteger(width) || width < 1 || width > 32) {
    throw new OmniMatrixError('INVALID_INPUT', 'Bit width must be an integer in [1,32]');
  }
}

/** MSB-first bit packing; the final byte is padded with zero bits at its least-significant end. */
export class BitWriter {
  private readonly output: number[] = [];
  private pending = 0;
  private count = 0;
  private totalBits = 0;

  write(value: number, width: number): this {
    assertWidth(width);
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** width) {
      throw new OmniMatrixError('INVALID_INPUT', `Value must fit in ${width} bits`);
    }
    for (let bit = width - 1; bit >= 0; bit--) {
      this.pending = this.pending * 2 + (Math.floor(value / 2 ** bit) % 2);
      if (++this.count === 8) {
        this.output.push(this.pending);
        this.pending = 0;
        this.count = 0;
      }
    }
    this.totalBits += width;
    return this;
  }

  get lengthBits(): number { return this.totalBits; }

  toBytes(): Uint8Array {
    const tail = this.count ? [this.pending * 2 ** (8 - this.count)] : [];
    return Uint8Array.from([...this.output, ...tail]);
  }
}

export class BitReader {
  private offset = 0;
  private readonly source: Uint8Array;
  constructor(input: Uint8Array, bitLength = input?.length * 8) {
    if (!(input instanceof Uint8Array) || !Number.isSafeInteger(bitLength) || bitLength < 0 || bitLength > input.length * 8) {
      throw new OmniMatrixError('INVALID_INPUT', 'Invalid bitstream input or bit length');
    }
    this.source = new Uint8Array(input);
    this.lengthBits = bitLength;
  }
  readonly lengthBits: number;
  get positionBits(): number { return this.offset; }
  get remainingBits(): number { return this.lengthBits - this.offset; }

  read(width: number): number {
    assertWidth(width);
    if (this.remainingBits < width) throw new OmniMatrixError('UNEXPECTED_EOF', 'Not enough bits available');
    let value = 0;
    for (let i = 0; i < width; i++) {
      const byte = this.source[this.offset >>> 3]!;
      value = value * 2 + ((byte >>> (7 - (this.offset & 7))) & 1);
      this.offset++;
    }
    return value;
  }
}

/** Pack fixed-width color indices without treating them as RS codewords. */
export function packIndices(indices: readonly number[], bitsPerIndex: 2 | 3): {
  readonly bytes: Uint8Array;
  readonly bitLength: number;
} {
  if (!Array.isArray(indices) || (bitsPerIndex !== 2 && bitsPerIndex !== 3)) {
    throw new OmniMatrixError('INVALID_INPUT', 'Invalid color indices or profile width');
  }
  const writer = new BitWriter();
  for (const value of indices) writer.write(value, bitsPerIndex);
  return { bytes: writer.toBytes(), bitLength: writer.lengthBits };
}

/** Decode exactly count indices; reject invalid data length and nonzero pad bits. */
export function unpackIndices(data: Uint8Array, bitsPerIndex: 2 | 3, count: number): number[] {
  if (!(data instanceof Uint8Array) || (bitsPerIndex !== 2 && bitsPerIndex !== 3) ||
      !Number.isSafeInteger(count) || count < 0 || count > Number.MAX_SAFE_INTEGER / bitsPerIndex) {
    throw new OmniMatrixError('INVALID_INPUT', 'Invalid packed indices');
  }
  const used = count * bitsPerIndex;
  if (data.length !== Math.ceil(used / 8)) {
    throw new OmniMatrixError('INVALID_INPUT', 'Packed buffer length does not match index count');
  }
  const reader = new BitReader(data, used);
  const result: number[] = [];
  for (let i = 0; i < count; i++) result.push(reader.read(bitsPerIndex));
  const pad = data.length * 8 - used;
  if (pad > 0 && (data[data.length - 1]! & ((1 << pad) - 1)) !== 0) {
    throw new OmniMatrixError('INVALID_PADDING', 'Non-zero padding bits');
  }
  return result;
}
