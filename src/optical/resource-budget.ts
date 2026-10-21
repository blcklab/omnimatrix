/** M13 bounded preflight for browser-side raster work. Does not change optical decisions. */
export interface DecodeWorkload {
  readonly width: number;
  readonly height: number;
  readonly channels?: 3 | 4;
  readonly frames?: 1 | 3 | 5;
}
export interface DecodeResourceBudget {
  readonly pixelsPerFrame: number;
  readonly frames: number;
  readonly sourceBytes: number;
  readonly rgbBytes: number;
  /** Lower-bound estimate of source and RGB copies held during decoding. */
  readonly estimatedBytes: number;
}
/**
 * Reject impossible or excessive input before allocating RGB copies.
 * The estimate intentionally excludes geometry/decoder temporaries; it is a safety
 * guard, not an exact measure of runtime memory usage. It is opt-in for callers.
 */
export function validateDecodeWorkload(
  input: DecodeWorkload,
  options: { readonly maxPixelsPerFrame?: number; readonly maxEstimatedBytes?: number } = {},
): DecodeResourceBudget {
  const { width, height } = input;
  const channels = input.channels ?? 4;
  const frames = input.frames ?? 1;
  const maxPixelsPerFrame = options.maxPixelsPerFrame ?? 12_000_000;
  const maxEstimatedBytes = options.maxEstimatedBytes ?? 192 * 1024 * 1024;
  if (![width,height,maxPixelsPerFrame,maxEstimatedBytes].every(Number.isSafeInteger) ||
    width < 1 || height < 1 || maxPixelsPerFrame < 1 || maxEstimatedBytes < 1 ||
    ![3,4].includes(channels) || ![1,3,5].includes(frames))
    throw new RangeError('Invalid raster work dimensions or resource limits');
  const pixelsPerFrame = width * height;
  const sourceBytes = pixelsPerFrame * channels * frames;
  const rgbBytes = pixelsPerFrame * 3 * frames;
  const estimatedBytes = sourceBytes + rgbBytes;
  if (!Number.isSafeInteger(estimatedBytes) || pixelsPerFrame > maxPixelsPerFrame ||
      estimatedBytes > maxEstimatedBytes)
    throw new RangeError('Raster decode exceeds resource budget; reduce input resolution');
  return { pixelsPerFrame, frames, sourceBytes, rgbBytes, estimatedBytes };
}
