import { BitReader, BitWriter } from '../core/bit-stream.js';
import { OmniMatrixError } from '../core/errors.js';
import { buildLayout, key } from '../geometry/hybrid.js';
import { makeHeader, readHeader } from '../protocol/bootstrap.js';
import { getRsLayout, protectPayload, recoverPayload } from '../protocol/reed-solomon.js';
import { renderSVG, rasterize } from '../renderers/research-renderer.js';
import type { Layout, OpticalCell, PaletteName, Raster, Transform } from '../types.js';
import type { EccProfile, RsLayout } from '../protocol/reed-solomon.js';

/** M0.1 logical HYBRID payload symbol; NOT a demonstrated camera-decodable barcode. */
export interface HybridSymbol {
  readonly kind: 'hybrid-payload';
  readonly formatDraft: 'M0.1';
  readonly mode: 'HYBRID';
  readonly header: Uint8Array;
  readonly layout: Layout;
  readonly mask: 0 | 1;
  readonly ecc: 'LIGHT' | 'MEDIUM' | 'STRONG';
  readonly maximumPayloadBytes: number;
  readonly payloadBytes: number;
}

export interface HybridEncodeOptions {
  readonly S: number;
  readonly palette?: PaletteName;
  readonly ecc?: EccProfile;
  readonly mask?: 0 | 1;
}

/** A logical optical-reader handoff; cells may be in any order, and role labels are not trusted. */
export interface HybridSampledCells {
  readonly header: Uint8Array;
  readonly cells: readonly Pick<OpticalCell, 'q' | 'r' | 'colorIndex'>[];
}

export interface HybridDecodedPayload {
  /** Independent output, safe for callers to modify. */
  readonly payload: Uint8Array;
  readonly S: number;
  readonly palette: PaletteName;
  readonly ecc: 'LIGHT' | 'MEDIUM' | 'STRONG';
  readonly mask: 0 | 1;
  readonly correctedSymbols: number;
  readonly correctedBlocks: number;
  readonly paddingBytes: number;
  readonly encodedBytes: number;
}

const eccNames = ['LIGHT', 'MEDIUM', 'STRONG'] as const;
function normalizeEcc(profile: EccProfile): 0 | 1 | 2 {
  switch (profile) {
    case 0: case 'LIGHT': return 0;
    case 1: case 'MEDIUM': return 1;
    case 2: case 'STRONG': return 2;
    default: throw new OmniMatrixError('INVALID_INPUT', 'Invalid ECC profile');
  }
}
function cellWidth(palette: PaletteName): 2 | 3 { return palette === 'DENSE_8' ? 3 : 2; }
function assertPalette(palette: PaletteName): void {
  if (palette !== 'DENSE_8' && palette !== 'RELIABLE_4') {
    throw new OmniMatrixError('INVALID_PALETTE', 'Unsupported color palette');
  }
}
function assertSize(S: number): void {
  if (!Number.isInteger(S) || S < 32 || S > 512 || S % 16 !== 0) {
    throw new OmniMatrixError('INVALID_SIZE', 'S must be a multiple of 16 in [32,512]');
  }
}
function assertMask(mask: number): asserts mask is 0 | 1 {
  if (mask !== 0 && mask !== 1) throw new OmniMatrixError('UNSUPPORTED_MASK', 'Unsupported data mask');
}
function layoutCapacity(layout: Layout, ecc: 0 | 1 | 2): { bytes: number; rs: RsLayout } {
  const bytes = Math.floor(layout.dataCount * cellWidth(layout.palette) / 8);
  return { bytes, rs: getRsLayout(bytes, ecc) };
}
function nextMask(state: number): number {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}
function initialMask(S: number): number {
  return (0x6d2b79f5 ^ ((S & 1023) << 12) ^ 0x4d58) >>> 0;
}

/**
 * Encode arbitrary bytes into the exact M0.1 r-then-q ordered hexagonal data cells.
 * Structure/calibration cells retain their original fixed palette indices.
 */
export function encodeHybridSymbol(payload: string | Uint8Array, options: HybridEncodeOptions): HybridSymbol {
  if (!options || typeof options !== 'object') throw new OmniMatrixError('INVALID_INPUT', 'Hybrid options must be an object');
  const { S, palette = 'DENSE_8', ecc = 'MEDIUM', mask = 1 } = options;
  assertSize(S);
  assertPalette(palette);
  assertMask(mask);
  const eccId = normalizeEcc(ecc);
  const base = buildLayout(S, palette);
  const { bytes, rs } = layoutCapacity(base, eccId);
  const { encoded } = protectPayload(payload, bytes, eccId);
  const bitCount = base.dataCount * cellWidth(palette);
  // Bits after the final full RS byte are required to be zero in M0.1.
  const padded = new Uint8Array(Math.ceil(bitCount / 8));
  padded.set(encoded);
  const reader = new BitReader(padded, bitCount);
  const colorMask = (1 << cellWidth(palette)) - 1;
  let state = initialMask(S);
  const cells: OpticalCell[] = [];
  const byCoordinate = new Map<string, OpticalCell>();
  for (const cell of base.cells) {
    let colorIndex = cell.colorIndex;
    if (cell.role === 'DATA') {
      const index = reader.read(cellWidth(palette));
      if (mask === 1) state = nextMask(state);
      colorIndex = index ^ (mask === 1 ? state & colorMask : 0);
    }
    const placed: OpticalCell = { ...cell, colorIndex };
    cells.push(placed);
    byCoordinate.set(key(cell.q, cell.r), placed);
  }
  if (reader.remainingBits !== 0) throw new OmniMatrixError('INVALID_FRAME', 'Data-cell mapping not exhausted');
  const header = makeHeader({ S, palette: palette === 'DENSE_8' ? 1 : 0, ecc: eccId, mask });
  const payloadBytes = typeof payload === 'string' ? new TextEncoder().encode(payload).length : payload.length;
  return { kind: 'hybrid-payload', formatDraft: 'M0.1', mode: 'HYBRID', header,
    layout: { ...base, cells, byCoordinate }, ecc: eccNames[eccId], mask,
    maximumPayloadBytes: rs.maximumPayloadBytes, payloadBytes };
}

/**
 * Decode via independently verified bootstrap and deterministically reconstructed axial positions.
 * Reserved optical cell colors are intentionally NOT required to be perfect: they are used
 * during acquisition/calibration, not protected by payload ECC. Missing/duplicate coordinates fail.
 */
export function decodeHybridCells(input: HybridSampledCells): HybridDecodedPayload {
  if (!input || typeof input !== 'object' || !(input.header instanceof Uint8Array) || !Array.isArray(input.cells)) {
    throw new OmniMatrixError('INVALID_INPUT', 'Expected header bytes and sampled cells');
  }
  let header: ReturnType<typeof readHeader>;
  try { header = readHeader(input.header); }
  catch { throw new OmniMatrixError('INVALID_HEADER', 'Optical bootstrap header is invalid or unsupported'); }
  const S = header.S;
  const palette: PaletteName = header.palette === 1 ? 'DENSE_8' : 'RELIABLE_4';
  const mask = header.mask ?? 1;
  assertMask(mask);
  const eccId = header.ecc ?? 1;
  if (eccId !== 0 && eccId !== 1 && eccId !== 2) throw new OmniMatrixError('INVALID_HEADER', 'Invalid ECC profile');
  const reference = buildLayout(S, palette);
  if (input.cells.length !== reference.candidates) throw new OmniMatrixError('INVALID_GEOMETRY', 'Incorrect number of sampled hexagonal cells');
  const seen = new Map<string, number>();
  const colors = 1 << cellWidth(palette);
  for (const cell of input.cells) {
    if (!cell || !Number.isSafeInteger(cell.q) || !Number.isSafeInteger(cell.r) ||
        !Number.isInteger(cell.colorIndex) || cell.colorIndex < 0 || cell.colorIndex >= colors) {
      throw new OmniMatrixError('INVALID_GEOMETRY', 'Invalid axial coordinate or color index');
    }
    const id = key(cell.q, cell.r);
    if (!reference.byCoordinate.has(id) || seen.has(id)) throw new OmniMatrixError('INVALID_GEOMETRY', 'Unexpected or duplicate hexagonal coordinate');
    seen.set(id, cell.colorIndex);
  }
  const width = cellWidth(palette);
  const { bytes } = layoutCapacity(reference, eccId);
  const writer = new BitWriter();
  let state = initialMask(S);
  for (const cell of reference.cells) {
    if (cell.role !== 'DATA') continue;
    const sampled = seen.get(key(cell.q, cell.r));
    if (sampled === undefined) throw new OmniMatrixError('INVALID_GEOMETRY', 'Missing data cell');
    if (mask === 1) state = nextMask(state);
    writer.write(sampled ^ (mask === 1 ? state & (colors - 1) : 0), width);
  }
  const stream = writer.toBytes();
  const reader = new BitReader(stream, reference.dataCount * width);
  // Reject non-zero protocol padding at the END of the RS bitstream, before ECC.
  for (let i = 0; i < bytes * 8; i++) reader.read(1);
  while (reader.remainingBits > 0) if (reader.read(1) !== 0) {
    throw new OmniMatrixError('INVALID_PADDING', 'Non-zero final data-cell padding bits');
  }
  const recovered = recoverPayload(stream.subarray(0, bytes), eccId);
  return { payload: recovered.payload, S, palette, ecc: eccNames[eccId], mask,
    correctedSymbols: recovered.correctedSymbols, correctedBlocks: recovered.correctedBlocks,
    paddingBytes: recovered.paddingBytes, encodedBytes: bytes };
}

/** Convenience logical decoder accepting an encoded symbol; does not trust its cached layout metadata. */
export function decodeHybridSymbol(symbol: HybridSymbol): HybridDecodedPayload {
  if (!symbol || symbol.kind !== 'hybrid-payload' || !symbol.layout) {
    throw new OmniMatrixError('INVALID_INPUT', 'Expected an M0.1 hybrid payload symbol');
  }
  return decodeHybridCells({ header: symbol.header, cells: symbol.layout.cells });
}

export function renderHybridSVG(symbol: HybridSymbol, pixelSize = 1024): string {
  if (!symbol || symbol.kind !== 'hybrid-payload') throw new OmniMatrixError('INVALID_INPUT', 'Expected hybrid symbol');
  if (!Number.isSafeInteger(pixelSize) || pixelSize < 1 || pixelSize > 16384) {
    throw new OmniMatrixError('INVALID_SIZE', 'SVG size must be an integer in [1,16384]');
  }
  return renderSVG(symbol.layout, pixelSize, symbol.header);
}

export function rasterizeHybridSymbol(symbol: HybridSymbol, width: number, height: number): {
  image: Raster; transform: Transform;
} {
  if (!symbol || symbol.kind !== 'hybrid-payload') throw new OmniMatrixError('INVALID_INPUT', 'Expected hybrid symbol');
  return rasterize(symbol.layout, width, height, { header: symbol.header });
}
