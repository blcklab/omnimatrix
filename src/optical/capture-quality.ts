/**
 * M12 capture-quality diagnostics. These are image measurements, NOT predictions
 * of decoding success. Camera moiré can yield a high edge/detail score.
 */
export interface CaptureQuality {
  readonly width: number;
  readonly height: number;
  readonly samples: number;
  /** Mean luma using Rec. 709 RGB weights, normalized to 0..1. */
  readonly meanLuma: number;
  readonly lumaStdDev: number;
  /** Sample fractions nearly black or nearly white. */
  readonly darkFraction: number;
  readonly brightFraction: number;
  /** RMS of sampled adjacent-pixel luma gradients, normalized to 0..1. */
  readonly detailRms: number;
  /** Relative ordering heuristic for frames from the same camera and scene. */
  readonly relativeRank: number;
  /** Explanatory diagnostics; never used to reject frames automatically. */
  readonly cautions: readonly string[];
}

export interface CaptureQualityInput {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly channels?: 3 | 4;
}

const luma = (data: Uint8Array | Uint8ClampedArray, index: number): number =>
  (0.2126 * data[index]! + 0.7152 * data[index + 1]! + 0.0722 * data[index + 2]!) / 255;

/** Sample the central 80% of the image on a bounded grid (approx 25k points). */
export function assessCaptureQuality(image: CaptureQualityInput): CaptureQuality {
  const { width, height, data } = image;
  const channels = image.channels ?? 3;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 8 || height < 8 ||
    width * height > 24_000_000 || (channels !== 3 && channels !== 4) ||
    data.length !== width * height * channels)
    throw new RangeError('Invalid capture dimensions or channel data');
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / 25000)));
  const left = Math.max(1, Math.floor(width * .1));
  const top = Math.max(1, Math.floor(height * .1));
  const right = Math.min(width - 2, Math.ceil(width * .9));
  const bottom = Math.min(height - 2, Math.ceil(height * .9));
  let count = 0, sum = 0, squared = 0, gradients = 0, dark = 0, bright = 0;
  for (let y = top; y <= bottom; y += step) {
    for (let x = left; x <= right; x += step) {
      const at = (y * width + x) * channels;
      const value = luma(data, at);
      const gx = luma(data, at + channels) - luma(data, at - channels);
      const gy = luma(data, at + channels * width) - luma(data, at - channels * width);
      count++;
      sum += value;
      squared += value * value;
      gradients += (gx * gx + gy * gy) / 8; // sqrt(8) normalization for finite differences
      if (value < .055) dark++;
      if (value > .965) bright++;
    }
  }
  const meanLuma = sum / count;
  const lumaStdDev = Math.sqrt(Math.max(0, squared / count - meanLuma * meanLuma));
  const detailRms = Math.sqrt(gradients / count);
  const darkFraction = dark / count;
  const brightFraction = bright / count;
  // Used *only* to choose between nearby frames of the same symbol/camera.
  // Avoid promoting a completely washed-out or underexposed frame.
  const exposureFactor = Math.max(.05, 1 - Math.max(0, brightFraction - .75) - Math.max(0, darkFraction - .75));
  const relativeRank = detailRms * exposureFactor;
  const cautions: string[] = [];
  if (meanLuma < .18) cautions.push('Image appears very dark');
  if (meanLuma > .90) cautions.push('Image appears very bright');
  if (lumaStdDev < .065) cautions.push('Low overall luminance contrast');
  if (brightFraction > .80) cautions.push('Large bright/clipped area');
  if (darkFraction > .80) cautions.push('Large dark/clipped area');
  return { width, height, samples: count, meanLuma, lumaStdDev, darkFraction,
    brightFraction, detailRms, relativeRank, cautions };
}

/** Pick the highest relative-quality frames. Equal scores keep earlier frames. */
export function selectCaptureFrames<T>(
  items: readonly T[],
  measure: (item: T, index: number) => CaptureQuality,
  keep = 3,
): readonly number[] {
  if (!Number.isSafeInteger(keep) || keep < 1 || keep > items.length || items.length > 24)
    throw new RangeError('Invalid capture-selection count');
  return items.map((value, index) => ({ index, rank: measure(value, index).relativeRank }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .slice(0, keep).map(x => x.index).sort((a, b) => a - b);
}
