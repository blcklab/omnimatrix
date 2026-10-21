import { OmniMatrixError } from '../core/errors.js';
import { buildLayout, estimateCapacity } from '../geometry/hybrid.js';
import { renderSVG } from '../renderers/research-renderer.js';
import type { Layout, PaletteName } from '../types.js';

/** This is a known pseudo-random laboratory pattern, NOT an encoded payload. */
export interface ResearchSymbol {
  readonly kind: 'research-pattern';
  readonly formatDraft: 'M0.1';
  readonly mode: 'HYBRID';
  readonly S: number;
  readonly palette: PaletteName;
  readonly seed: number;
  readonly layout: Layout;
}

export interface ResearchSymbolOptions {
  /** Dimensionless hybrid radius parameter, multiple of 16 in [32, 512]. */
  readonly S: number;
  readonly palette?: PaletteName;
  /** Unsigned 32-bit seed. Same seed produces the same research pattern. */
  readonly seed?: number;
}

export function createResearchSymbol(options: ResearchSymbolOptions): ResearchSymbol {
  if (options === null || typeof options !== 'object') {
    throw new OmniMatrixError('INVALID_INPUT', 'Research options must be an object');
  }
  const { S, palette = 'DENSE_8', seed = 0x4f4d } = options;
  if (!Number.isInteger(S) || S < 32 || S > 512 || S % 16 !== 0) {
    throw new OmniMatrixError('INVALID_SIZE', 'S must be a multiple of 16 between 32 and 512');
  }
  if (palette !== 'DENSE_8' && palette !== 'RELIABLE_4') {
    throw new OmniMatrixError('INVALID_PALETTE', 'Unknown research palette');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new OmniMatrixError('INVALID_INPUT', 'Seed must be an unsigned 32-bit integer');
  }
  return { kind: 'research-pattern', formatDraft: 'M0.1', mode: 'HYBRID', S, palette, seed, layout: buildLayout(S, palette, seed) };
}

/** Theoretical optical capacity: actual RS exists, but physical camera scanning is unvalidated. */
export function getResearchCapacity(symbol: ResearchSymbol, parityBytesPerBlock = 32): {
  readonly kind: 'theoretical-estimate';
  readonly codewordBytes: number;
  readonly blocks: number;
  readonly maximumPayloadBytes: number;
} {
  assertResearchSymbol(symbol);
  if (!Number.isInteger(parityBytesPerBlock) || parityBytesPerBlock < 0 || parityBytesPerBlock > 254) {
    throw new OmniMatrixError('INVALID_INPUT', 'RS parity bytes per block must be in [0,254]');
  }
  return { kind: 'theoretical-estimate', ...estimateCapacity(symbol.layout, parityBytesPerBlock) };
}

export function renderResearchSVG(symbol: ResearchSymbol, pixelSize = 1024): string {
  assertResearchSymbol(symbol);
  if (!Number.isSafeInteger(pixelSize) || pixelSize < 1 || pixelSize > 16384) {
    throw new OmniMatrixError('INVALID_SIZE', 'SVG size must be an integer in [1,16384]');
  }
  return renderSVG(symbol.layout, pixelSize);
}

function assertResearchSymbol(symbol: ResearchSymbol): void {
  if (!symbol || symbol.kind !== 'research-pattern' || symbol.formatDraft !== 'M0.1' || symbol.mode !== 'HYBRID' || !symbol.layout) {
    throw new OmniMatrixError('INVALID_INPUT', 'Expected an M0.1 HYBRID research symbol');
  }
}
