import { OmniMatrixError } from '../core/errors.js';
import type { Raster } from '../types.js';
import { decodeHybridRasterAutomatic, type AutomaticHybridDecode, type AutomaticDetectionOptions } from './automatic.js';
import type { HybridAssistedDecodeOptions } from './payload-sampling.js';

/** A rectangle in the original, unrotated raster pixel coordinates. */
export interface RasterRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface RegionDecodeOptions extends AutomaticDetectionOptions, HybridAssistedDecodeOptions {
  /** Try the original complete image before any cropped regions (default true). */
  readonly includeFullImage?: boolean;
  /** Up to three explicit candidate rectangles in full-image pixel coordinates. */
  readonly regions?: readonly RasterRegion[];
}
export interface RegionDecodeResult extends AutomaticHybridDecode {
  /** Successful rectangle; detection/registration coordinates remain LOCAL to this rectangle. */
  readonly usedRegion: RasterRegion;
  readonly regionAttempts: number;
  readonly fullImageSize: { readonly width: number; readonly height: number };
}

function validImage(image: Raster): void {
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) ||
    image.width <= 0 || image.height <= 0 || image.width * image.height > 24_000_000 ||
    !(image.data instanceof Uint8Array) || image.data.length !== image.width * image.height * 3) {
    throw new OmniMatrixError('INVALID_INPUT', 'Invalid RGB raster');
  }
}
function normalizedRegion(image: Raster, r: RasterRegion): RasterRegion {
  if (!r || ![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) ||
    r.width < 1 || r.height < 1 || r.x < 0 || r.y < 0 ||
    r.x + r.width > image.width || r.y + r.height > image.height) {
    throw new OmniMatrixError('INVALID_INPUT', 'Region must be an integer rectangle inside the source raster');
  }
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** Copy a rectangular RGB region. Never resize or resample modules; that would lose optical detail. */
export function cropRaster(image: Raster, region: RasterRegion): Raster {
  validImage(image);
  const r = normalizedRegion(image, region);
  const result = new Uint8Array(r.width * r.height * 3);
  for (let y = 0; y < r.height; y++) {
    const start = ((r.y + y) * image.width + r.x) * 3;
    result.set(image.data.subarray(start, start + r.width * 3), y * r.width * 3);
  }
  return { width: r.width, height: r.height, data: result };
}

/** Generate opt-in center candidates for single near-frontal code photos with background clutter. */
export function centeredRegions(width: number, height: number): readonly RasterRegion[] {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new OmniMatrixError('INVALID_INPUT', 'Invalid image size for centered regions');
  }
  return [0.82, 0.65].map(fraction => {
    const w = Math.max(1, Math.floor(width * fraction));
    const h = Math.max(1, Math.floor(height * fraction));
    return { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), width: w, height: h };
  });
}

/**
 * M9 bounded fallback. First try the full image, then at most three caller-supplied crops.
 * Each attempt independently requires a valid optical header AND payload CRC.
 * No comparison with known test data or cross-frame data is used.
 * Cropping cannot repair blur, oblique perspective, missing symbols or inadequate resolution.
 */
export function decodeHybridRasterRegions(image: Raster, options: RegionDecodeOptions = {}): RegionDecodeResult {
  validImage(image);
  const { includeFullImage = true, regions = [], ...decoderOptions } = options;
  if (typeof includeFullImage !== 'boolean' || !Array.isArray(regions) || regions.length > 3 || !regions.length && !includeFullImage) {
    throw new OmniMatrixError('INVALID_INPUT', 'Provide a full-image attempt and/or one to three regions');
  }
  // Validate every rectangle before any attempt (no partial treatment of invalid options).
  const candidates = regions.map(r => normalizedRegion(image, r));
  const full = { x: 0, y: 0, width: image.width, height: image.height };
  if (includeFullImage) candidates.unshift(full);
  let last: unknown;
  // Preserve the most informative validated progress if later fallback crops fail.
  // ECC/CRC failure means a real symbol was acquired, unlike rim/header failures.
  const rank=(error:unknown):number=>{
    if(!(error instanceof OmniMatrixError))return 0;
    switch(error.code){
      case 'ECC_UNRECOVERABLE':case 'CRC_MISMATCH':case 'INVALID_FRAME':return 3;
      case 'INVALID_HEADER':return 2;
      case 'INVALID_GEOMETRY':return 1;
      default:return 0;
    }
  };
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    try {
      const raster = candidate.x === 0 && candidate.y === 0 && candidate.width === image.width && candidate.height === image.height
        ? image : cropRaster(image, candidate);
      const decoded = decodeHybridRasterAutomatic(raster, decoderOptions);
      return { ...decoded, usedRegion: candidate, regionAttempts: i + 1,
        fullImageSize: { width: image.width, height: image.height } };
    } catch (error) {
      // Never swallow programmer errors / unsupported decoder options.
      if (error instanceof OmniMatrixError && error.code === 'INVALID_INPUT') throw error;
      if (!(error instanceof OmniMatrixError) && !(error instanceof RangeError)) throw error;
      if(!last||rank(error)>rank(last))last=error;
    }
  }
  if (last instanceof Error) throw last;
  throw new OmniMatrixError('INVALID_GEOMETRY', 'No decodable OmniMatrix symbol found in the selected image regions');
}
