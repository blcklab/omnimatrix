import { OmniMatrixError } from '../core/errors.js';
import { decodeHybridCells, type HybridDecodedPayload, type HybridSampledCells } from '../api/hybrid-symbol.js';
import { buildLayout } from '../geometry/hybrid.js';
import { readHeader } from '../protocol/bootstrap.js';
import { rgbPalette } from '../renderers/research-renderer.js';
import { pixelAt, sampleHeaderMapped } from './classification.js';
import { identifyAssistedHeader, refineAssistedRegistration, type OpticalIdentification } from './refinement.js';
import { homographyFromCardinalPoints, mapProjective, type CardinalPoints, type ProjectiveRegistration } from './registration.js';
import type { Layout, OpticalCell, PaletteName, Raster, RGB } from '../types.js';

/** M6: image sampling is ASSISTED, not automatic symbol detection. */
export interface HybridPixelSamplingOptions {
  /** Minimum share of black/white alignment cells correctly classified. Default 0.75. */
  readonly minimumAlignmentFraction?: number;
  /** Minimum share of black/white bullseye pilot samples. Default 0.75. */
  readonly minimumBullseyeFraction?: number;
  /** Use 1 center pixel or 5 interior samples. Default 5. */
  readonly samplesPerCell?: 1 | 5;
  /** M7 experimental: MEAN preserves the M6 baseline; MEDIAN resists isolated pixel outliers. */
  readonly sampleAggregation?: 'MEAN' | 'MEDIAN';
  /** M7 experimental: LOCAL interpolates each color from neighboring optical calibration cells. */
  readonly calibrationMode?: 'GLOBAL' | 'LOCAL';
  /** A diagnostics-only threshold measured in RGB-distance margin units (default 20). */
  readonly confidenceWarningThreshold?: number;
}

export interface HybridPixelDiagnostics {
  readonly calibrationSamples: number;
  readonly calibrationCounts: readonly number[];
  readonly alignmentSamples: number;
  readonly alignmentCorrect: number;
  readonly bullseyeSamples: number;
  readonly bullseyeCorrect: number;
  readonly dataSamples: number;
  readonly dataMeanConfidence: number;
  /** Optical header tracks which produced CRC-valid, mutually consistent bytes. */
  readonly validHeaderTracks: readonly ('A' | 'B')[];
  readonly sampleAggregation: 'MEAN' | 'MEDIAN';
  readonly calibrationMode: 'GLOBAL' | 'LOCAL';
  /** Count of DATA modules with first-vs-second RGB distance margin below threshold. */
  readonly lowConfidenceCells: number;
  readonly confidenceWarningThreshold: number;
  readonly dataMinimumConfidence: number;
  readonly minimumPaletteSeparation: number;
}

export interface SampledHybridPixels extends HybridSampledCells {
  /** Per-cell calibrated nearest-color distance margin; non-data cells have zero. */
  readonly cellConfidenceMargins: Float32Array;
  readonly S: number;
  readonly palette: PaletteName;
  readonly diagnostics: HybridPixelDiagnostics;
}
export interface HybridRasterDecode {
  readonly decoded: HybridDecodedPayload;
  readonly sampling: HybridPixelDiagnostics;
  readonly registration: ProjectiveRegistration;
}
export interface HybridAssistedDecode extends HybridRasterDecode {
  readonly identification: OpticalIdentification;
  readonly refinedPoints: CardinalPoints;
  readonly registrationRefined: boolean;
  readonly initialOpticalScore: number;
  readonly finalOpticalScore: number;
}
export interface HybridAssistedDecodeOptions extends HybridPixelSamplingOptions {
  readonly refine?: boolean;
  readonly maxShiftPx?: number;
  readonly sizes?: readonly number[];
}

const offsets1: readonly (readonly [number, number])[] = [[0, 0]];
const offsets5: readonly (readonly [number, number])[] = [[0, 0], [.21, 0], [-.21, 0], [0, .21], [0, -.21]];
function validateImage(image: Raster): void {
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) ||
      image.width <= 0 || image.height <= 0 || image.width * image.height > 24_000_000 ||
      !(image.data instanceof Uint8Array) || image.data.length !== image.width * image.height * 3) {
    throw new OmniMatrixError('INVALID_INPUT', 'Expected a valid RGB raster with width * height * 3 bytes');
  }
}
function fraction(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < 0 || result > 1) {
    throw new OmniMatrixError('INVALID_INPUT', 'Optical verification fraction must be in [0,1]');
  }
  return result;
}
function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const m = values.length >> 1;
  return values.length % 2 ? values[m]! : (values[m - 1]! + values[m]!) / 2;
}
function distance(a: RGB, b: RGB): number {
  return (a.r-b.r)**2 + (a.g-b.g)**2 + (a.b-b.b)**2;
}
function classify(rgb: RGB, colors: readonly RGB[]): { index: number; margin: number } {
  let first = Infinity, second = Infinity, index = -1;
  for (let j = 0; j < colors.length; j++) {
    const d = distance(rgb, colors[j]!);
    if (d < first) { second = first; first = d; index = j; }
    else if (d < second) second = d;
  }
  if (index < 0) throw new OmniMatrixError('INVALID_GEOMETRY', 'No palette colors');
  return { index, margin: Math.sqrt(second) - Math.sqrt(first) };
}
function sampleCell(image: Raster, map: (x: number, y: number) => { x: number; y: number } | null,
  x: number, y: number, offsets: readonly (readonly [number, number])[],
  aggregation: 'MEAN' | 'MEDIAN'): RGB | null {
  let r = 0, g = 0, b = 0, n = 0;
  const readings: RGB[] = [];
  for (const [dx, dy] of offsets) {
    const position = map(x + dx, y + dy);
    const pixel = position && pixelAt(image, position.x, position.y);
    if (!pixel) continue;
    r += pixel.r; g += pixel.g; b += pixel.b; n++;
    if (aggregation === 'MEDIAN') readings.push(pixel);
  }
  if (n < Math.ceil(offsets.length * .6)) return null;
  if (aggregation === 'MEAN') return {r:r/n, g:g/n, b:b/n};
  return {r:median(readings.map(p => p.r)),g:median(readings.map(p => p.g)),b:median(readings.map(p => p.b))};
}

interface ReferenceSample {
  readonly q: number; readonly r: number;
  readonly x: number; readonly y: number;
  readonly colorIndex: number; readonly rgb: RGB;
}
/**
 * Bounded, location-based reference lookup. Each calibration point lives on
 * (q % 8, r % 8) == (0, 0). Inspect at most 121 neighboring grid nodes,
 * independent of total symbol size; no DATA pixels inform calibration.
 */
function localPalette(
  referenceGrid: ReadonlyMap<string, ReferenceSample>,
  q: number, r: number, x: number, y: number, globalColors: readonly RGB[],
): RGB[] {
  const nearest: {d:number; rgb: RGB}[][] = globalColors.map(() => []);
  const qBase = Math.round(q/8)*8, rBase = Math.round(r/8)*8;
  for (let rq=-5;rq<=5;rq++) for (let qq=-5;qq<=5;qq++) {
    const ref=referenceGrid.get(`${qBase+qq*8},${rBase+rq*8}`);
    if (!ref) continue;
    const candidates=nearest[ref.colorIndex]!;
    const d=(ref.x-x)**2+(ref.y-y)**2;
    if (candidates.length===4 && d>=candidates[3]!.d) continue;
    const index=candidates.findIndex(p=>p.d>d);
    if(index<0) candidates.push({d,rgb:ref.rgb});
    else candidates.splice(index,0,{d,rgb:ref.rgb});
    if(candidates.length>4) candidates.pop();
  }
  return nearest.map((samples,i)=>{
    if (!samples.length) return globalColors[i]!;
    let total=0, rr=0,gg=0,bb=0;
    for (const sample of samples) {
      const weight=1/(1+sample.d/64);
      total+=weight;
      rr+=sample.rgb.r*weight;gg+=sample.rgb.g*weight;bb+=sample.rgb.b*weight;
    }
    return {r:rr/total,g:gg/total,b:bb/total};
  });
}

function headerFromImage(image: Raster, registration: ProjectiveRegistration, S: number): {
  bytes: Uint8Array; tracks: ('A' | 'B')[];
} {
  const report = sampleHeaderMapped(image, (x,y)=>mapProjective(registration,x,y), S);
  if (report.status !== 'OK') {
    throw new OmniMatrixError('INVALID_HEADER', `Unable to recover a consistent optical header (${report.status})`);
  }
  const tracks: ('A'|'B')[] = [];
  if (report.trackAValid) tracks.push('A');
  if (report.trackBValid) tracks.push('B');
  const hex = report.trackAValid ? report.hexA : report.hexB;
  if (!/^[0-9a-f]{16}$/.test(hex)) throw new OmniMatrixError('INVALID_HEADER', 'Truncated sampled header');
  const bytes = Uint8Array.from(hex.match(/../g)!, part => Number.parseInt(part, 16));
  const config = readHeader(bytes);
  if (config.S !== S) throw new OmniMatrixError('INVALID_HEADER', 'Optical header S disagrees with registered geometry');
  return {bytes, tracks};
}

/**
 * Sample an UNKNOWN HYBRID payload, using only its public optical pilots and the
 * pixel-derived bootstrap header. Does NOT compare data cells with an encoder's
 * in-memory colors, and does not assume the original payload or random test seed.
 *
 * Reserved cells in the returned logical array are reconstructed from the spec;
 * their actual image values are independently checked in diagnostics. An unobserved
 * DATA cell always causes failure rather than fabricated data.
 */
export function sampleHybridRasterRegistered(image: Raster, registration: ProjectiveRegistration,
  S: number, options: HybridPixelSamplingOptions = {}): SampledHybridPixels {
  validateImage(image);
  const alignmentMinimum = fraction(options.minimumAlignmentFraction, .75);
  const bullseyeMinimum = fraction(options.minimumBullseyeFraction, .75);
  if (options.samplesPerCell !== undefined && options.samplesPerCell !== 1 && options.samplesPerCell !== 5) {
    throw new OmniMatrixError('INVALID_INPUT', 'samplesPerCell must be 1 or 5');
  }
  const aggregation = options.sampleAggregation ?? 'MEAN';
  const calibrationMode = options.calibrationMode ?? 'GLOBAL';
  const confidenceThreshold = options.confidenceWarningThreshold ?? 20;
  if (aggregation !== 'MEAN' && aggregation !== 'MEDIAN')
    throw new OmniMatrixError('INVALID_INPUT', 'sampleAggregation must be MEAN or MEDIAN');
  if (calibrationMode !== 'GLOBAL' && calibrationMode !== 'LOCAL')
    throw new OmniMatrixError('INVALID_INPUT', 'calibrationMode must be GLOBAL or LOCAL');
  if (!Number.isFinite(confidenceThreshold) || confidenceThreshold < 0 || confidenceThreshold > 442)
    throw new OmniMatrixError('INVALID_INPUT', 'confidenceWarningThreshold must be in [0,442]');
  const { bytes: header, tracks } = headerFromImage(image, registration, S);
  const config = readHeader(header);
  const palette: PaletteName = config.palette === 1 ? 'DENSE_8' : 'RELIABLE_4';
  const layout = buildLayout(S, palette);
  const map = (x: number, y: number) => mapProjective(registration, x, y);
  const offsets = options.samplesPerCell === 1 ? offsets1 : offsets5;
  const calibration: RGB[][] = Array.from({length: config.palette === 1 ? 8 : 4},()=>[]);
  const referenceGrid = new Map<string,ReferenceSample>();
  for (const cell of layout.cells) {
    if (cell.role !== 'CALIBRATION') continue;
    const rgb = sampleCell(image, map, cell.x, cell.y, offsets, aggregation);
    if (rgb) {
      calibration[cell.colorIndex]!.push(rgb);
      referenceGrid.set(`${cell.q},${cell.r}`,{q:cell.q,r:cell.r,x:cell.x,y:cell.y,colorIndex:cell.colorIndex,rgb});
    }
  }
  const calibrationCounts = calibration.map(p => p.length);
  if (calibrationCounts.some(n => n < 2)) {
    throw new OmniMatrixError('INVALID_GEOMETRY', 'Insufficient sampled palette reference cells for every color');
  }
  const colors: RGB[] = calibration.map(samples => ({
    r: median(samples.map(s=>s.r)), g:median(samples.map(s=>s.g)), b:median(samples.map(s=>s.b)),
  }));
  // If color references collapsed to nearly identical RGB values, refuse a false decode.
  let minimumPaletteSeparation=Infinity;
  for (let i=0;i<colors.length;i++) for (let j=i+1;j<colors.length;j++) {
    minimumPaletteSeparation=Math.min(minimumPaletteSeparation,Math.sqrt(distance(colors[i]!,colors[j]!)));
    if (distance(colors[i]!,colors[j]!) < 20*20) {
      throw new OmniMatrixError('INVALID_GEOMETRY', 'Palette calibration colors are not distinguishable');
    }
  }

  let alignmentSamples = 0, alignmentCorrect = 0;
  for (const cell of layout.cells) {
    if (cell.role !== 'ALIGNMENT') continue;
    const rgb = sampleCell(image, map, cell.x, cell.y, offsets, aggregation);
    if (!rgb) continue;
    alignmentSamples++;
    // Alignment indices are explicitly black or white, not full chromatic data.
    const observed = distance(rgb, colors[0]!) < distance(rgb, colors[1]!) ? 0 : 1;
    if (observed === cell.colorIndex) alignmentCorrect++;
  }
  if (layout.alignmentCount > 0 && (alignmentSamples < Math.ceil(layout.alignmentCount * .6) ||
      alignmentCorrect / alignmentSamples < alignmentMinimum)) {
    throw new OmniMatrixError('INVALID_GEOMETRY', 'Registration rejected by reserved alignment rosettes');
  }
  const BW = rgbPalette(palette);
  let bullseyeSamples = 0, bullseyeCorrect = 0;
  for (const [radius, expected] of [[1,0], [3,1], [5,0], [7,1]] as const) {
    for (let n=0;n<16;n++) {
      const theta=n*Math.PI/8;
      const xy=map(radius*Math.cos(theta),radius*Math.sin(theta));
      const rgb=xy ? pixelAt(image,xy.x,xy.y) : null;
      if (!rgb) continue;
      bullseyeSamples++;
      const actualIndex=distance(rgb,BW[0]!) < distance(rgb,BW[1]!) ? 0 : 1;
      if (actualIndex === expected) bullseyeCorrect++;
    }
  }
  if (bullseyeSamples < 48 || bullseyeCorrect / bullseyeSamples < bullseyeMinimum) {
    throw new OmniMatrixError('INVALID_GEOMETRY', 'Registration rejected by central bullseye');
  }
  const cells: {q:number;r:number;colorIndex:number}[] = [];
  const cellConfidenceMargins = new Float32Array(layout.cells.length);
  let dataSamples = 0, confidence = 0, lowConfidenceCells = 0, dataMinimumConfidence = Infinity;
  for (const cell of layout.cells) {
    if (cell.role !== 'DATA') {
      cells.push({q:cell.q,r:cell.r,colorIndex:cell.colorIndex});
      continue;
    }
    const rgb = sampleCell(image,map,cell.x,cell.y,offsets,aggregation);
    if (!rgb) throw new OmniMatrixError('INVALID_GEOMETRY', `Missing data-cell pixels at axial ${cell.q},${cell.r}`);
    const candidates = calibrationMode === 'LOCAL'
      ? localPalette(referenceGrid,cell.q,cell.r,cell.x,cell.y,colors)
      : colors;
    const result = classify(rgb,candidates);
    cellConfidenceMargins[cells.length] = result.margin;
    if (result.margin < confidenceThreshold) lowConfidenceCells++;
    dataMinimumConfidence = Math.min(dataMinimumConfidence, result.margin);
    cells.push({q:cell.q,r:cell.r,colorIndex:result.index});
    dataSamples++;
    confidence += result.margin;
  }
  return { header, S, palette, cells, cellConfidenceMargins, diagnostics:{
    calibrationSamples:calibrationCounts.reduce((a,b)=>a+b,0),calibrationCounts,
    alignmentSamples,alignmentCorrect,bullseyeSamples,bullseyeCorrect,dataSamples,
    dataMeanConfidence: dataSamples ? confidence/dataSamples : 0, validHeaderTracks:tracks,
    sampleAggregation:aggregation,calibrationMode,lowConfidenceCells,
    confidenceWarningThreshold:confidenceThreshold,
    dataMinimumConfidence:dataSamples ? dataMinimumConfidence : 0,
    minimumPaletteSeparation,
  }};
}

/** Decode a photographed or rasterized HYBRID data symbol with a known registration. */
export function decodeHybridRasterRegistered(image: Raster, registration: ProjectiveRegistration,
  S: number, options: HybridPixelSamplingOptions = {}): HybridRasterDecode {
  const sampled = sampleHybridRasterRegistered(image,registration,S,options);
  return {decoded:decodeHybridCells(sampled),sampling:sampled.diagnostics,registration};
}

/**
 * Decode from a photographed HYBRID symbol using approximate manually supplied
 * cardinal points. Identifies S/palette/ECC/mask from CRC-valid image pixels,
 * optionally refines registration against structural pilots, then performs real
 * optical cell classification -> Reed–Solomon -> OMD1/CRC-32 recovery.
 * This is NOT image-wide automatic symbol detection.
 */
export function decodeHybridRasterAssisted(image:Raster, points:CardinalPoints,
  options:HybridAssistedDecodeOptions={}):HybridAssistedDecode {
  validateImage(image);
  const identification=identifyAssistedHeader(image,points,{sizes:options.sizes});
  if (identification.status!=='OK' || !identification.detected) {
    throw new OmniMatrixError('INVALID_HEADER', `Cannot identify symbol (${identification.status})`);
  }
  const config=identification.detected;
  const palette:PaletteName=config.palette===1?'DENSE_8':'RELIABLE_4';
  const layout:Layout=buildLayout(config.S,palette);
  const refined=refineAssistedRegistration(layout,image,points,config,{
    maxShiftPx: options.refine===false ? 0 : options.maxShiftPx,
  });
  const sampled=sampleHybridRasterRegistered(image,refined.registration,config.S,options);
  // Never accept a different header from the one that selected the sampling geometry.
  const observed=readHeader(sampled.header);
  if (observed.S!==config.S || observed.palette!==config.palette ||
    observed.ecc!==config.ecc || observed.mask!==config.mask) {
    throw new OmniMatrixError('INVALID_HEADER', 'Optical header identification changed after refinement');
  }
  return {
    decoded:decodeHybridCells(sampled),sampling:sampled.diagnostics,
    registration:refined.registration,identification,refinedPoints:refined.points,
    registrationRefined:refined.refined,initialOpticalScore:refined.initialScore,
    finalOpticalScore:refined.finalScore,
  };
}
