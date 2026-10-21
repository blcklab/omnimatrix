import type { Layout, Raster, RGB, SampleResult, Transform } from '../types.js';
import { rgbPalette } from '../render.js';

export function pixelAt(image: Raster, x: number, y: number): RGB | null {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
  const i = (Math.floor(y) * image.width + Math.floor(x)) * 3;
  return { r: image.data[i]!, g: image.data[i + 1]!, b: image.data[i + 2]! };
}
function imagePoint(t: Transform, x: number, y: number): {x: number;y: number} {
  if (t.mirror) x = -x;
  const c = Math.cos(t.rotation), s = Math.sin(t.rotation);
  return { x: t.cx + t.a * (c * x - s * y), y: t.cy + t.a * (s * x + c * y) };
}
function dist(a: RGB, b: RGB): number {
  return (a.r-b.r)**2 + (a.g-b.g)**2 + (a.b-b.b)**2;
}
/** M1 baseline: supplied ground-truth affine transform, not automatic detection. */
export function sampleRegistered(layout: Layout, image: Raster, transform: Transform, opts: { calibrate?: boolean } = {}): SampleResult {
  return sampleMapped(layout, image, (x,y) => imagePoint(transform,x,y),opts);
}
export type CellMapping = (x:number,y:number)=>{x:number;y:number}|null;

/** Works with independently annotated registration or simulated ground truth.
 * A mapped cell can be sampled at center (baseline) or five inward points (photo mode).
 * The full expected test pattern is known; these are classification stats, NOT payload recovery.
 */
export function sampleMapped(layout: Layout, image: Raster, map: CellMapping,
  opts: { calibrate?: boolean; samplesPerCell?: 1 | 5 } = {}): SampleResult {
  const colors = rgbPalette(layout.palette);
  const k = colors.length;
  const classCounts = Array(k).fill(0) as number[];
  const perColorErrors = Array(k).fill(0) as number[];
  function cellPixel(x:number,y:number):RGB|null {
    const offsets:readonly (readonly [number,number])[] = opts.samplesPerCell===5
      ? [[0,0],[.21,0],[-.21,0],[0,.21],[0,-.21]]
      : [[0,0]];
    let r=0,g=0,b=0,n=0;
    for (const [dx,dy] of offsets) {
      const p=map(x+dx,y+dy);
      const rgb=p ? pixelAt(image,p.x,p.y) : null;
      if (!rgb) continue;
      r+=rgb.r;g+=rgb.g;b+=rgb.b;n++;
    }
    return n>=Math.ceil(offsets.length*.6)?{r:r/n,g:g/n,b:b/n}:null;
  }
  const calibrationSamples: { expected: number; rgb: RGB }[] = [];
  for (const cell of layout.cells) {
    if (cell.role !== 'CALIBRATION') continue;
    const rgb=cellPixel(cell.x,cell.y);
    if (rgb) calibrationSamples.push({ expected: cell.colorIndex, rgb });
  }
  if (opts.calibrate !== false) {
    const sums = Array.from({ length: k }, () => [0,0,0,0]);
    for (const { expected, rgb } of calibrationSamples) {
      const s = sums[expected]!;
      s[0]! += rgb.r; s[1]! += rgb.g; s[2]! += rgb.b; s[3]! += 1;
    }
    for (let i = 0; i < k; i++) {
      const s = sums[i]!;
      if (s[3]! > 0) colors[i] = { r: s[0]!/s[3]!, g: s[1]!/s[3]!, b: s[2]!/s[3]! };
    }
  }
  const confusion = Array.from({length:k},()=>Array(k).fill(0) as number[]);
  let errors = 0, total = 0, invalidSamples = 0, confidenceSum = 0;
  for (const cell of layout.cells) {
    if (cell.role !== 'DATA') continue;
    const rgb=cellPixel(cell.x,cell.y);
    if (!rgb) { ++invalidSamples; continue; }
    let first = Infinity, second = Infinity, index = -1;
    for (let j = 0; j < k; j++) {
      const e = dist(rgb, colors[j]!);
      if (e < first) { second = first; first = e; index = j; }
      else if (e < second) second = e;
    }
    if (index === -1) throw new Error('Unclassified pixel');
    ++total;
    ++classCounts[cell.colorIndex]!;
    ++confusion[cell.colorIndex]![index]!;
    if (cell.colorIndex !== index) { ++errors; ++perColorErrors[cell.colorIndex]!; }
    confidenceSum += Math.sqrt(second) - Math.sqrt(first);
  }
  return {
    total, errors, accuracy: total ? 1 - errors / total : 0,
    confusion, calibrationCount: calibrationSamples.length,
    classCounts, perColorErrors, meanConfidenceMargin: total ? confidenceSum / total : 0,
    invalidSamples,
  };
}
export interface RimAcquisition {
  readonly primaryDegrees: number;
  readonly secondaryDegrees: number;
  readonly separationDegrees: number;
  readonly primaryWidthDegrees: number;
  readonly secondaryWidthDegrees: number;
  readonly chirality: 'NORMAL' | 'MIRRORED' | 'UNKNOWN';
}
/** Detect rim notches given externally known symbol center and scale; not full-image finder. */
export function acquireOrientationWithKnownCenter(image: Raster, cx: number, cy: number, radialPixels: number): RimAcquisition | null {
  // Sample narrow outer band midpoint at quarter-degree resolution.
  const N = 1440, whiteness = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const theta = i * Math.PI * 2 / N;
    const v = pixelAt(image, cx + radialPixels*Math.cos(theta), cy + radialPixels*Math.sin(theta));
    whiteness[i] = v && (v.r + v.g + v.b > 420) ? 1 : 0;
  }
  // Circular runs of white pixels. Deal with primary spanning 0°.
  const runs: { start:number; count:number }[] = [];
  for (let i = 0; i < N; i++) {
    if (whiteness[i] === 1 && whiteness[(i-1+N)%N] === 0) {
      let count = 0;
      while (count < N && whiteness[(i+count)%N] === 1) count++;
      runs.push({start:i,count});
    }
  }
  if (runs.length !== 2) return null;
  runs.sort((a,b) => b.count - a.count);
  const [primary, secondary] = runs;
  if (!primary || !secondary || primary.count <= secondary.count || primary.count < 10 || secondary.count < 4) return null;
  const a = ((primary.start + (primary.count-1)/2) * 360/N) % 360;
  const b = ((secondary.start + (secondary.count-1)/2) * 360/N) % 360;
  const diff = (b - a + 360) % 360;
  return {
    primaryDegrees:a, secondaryDegrees:b, separationDegrees:diff,
    primaryWidthDegrees:primary.count*360/N, secondaryWidthDegrees:secondary.count*360/N,
    chirality: Math.abs(diff-120)<20?'NORMAL':Math.abs(diff-240)<20?'MIRRORED':'UNKNOWN',
  };
}

export interface HeaderScan {
  readonly status: 'OK' | 'INVALID_HEADER' | 'HEADER_CONFLICT';
  readonly trackAValid: boolean;
  readonly trackBValid: boolean;
  readonly hexA: string;
  readonly hexB: string;
}
/** Baseline affine header sampling with externally known registration. */
export function sampleHeaderRegistered(image: Raster, transform: Transform, S: number): HeaderScan {
  return sampleHeaderMapped(image,(x,y)=>imagePoint(transform,x,y),S);
}
/** Registered optical header scan. CRC checks the actual recovered pixels.
 * A manually supplied mapping is not evidence of automatic acquisition.
 */
export function sampleHeaderMapped(image: Raster, map: CellMapping, S: number): HeaderScan {
  function recover(radius: number, invert: boolean): Uint8Array {
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 64; ++i) {
      const theta = (i+0.5) * 2*Math.PI/64;
      const xy=map(radius*Math.cos(theta),radius*Math.sin(theta));
      const color = xy ? pixelAt(image, xy.x, xy.y) : null;
      if (!color) return new Uint8Array(); // invalid header; do not silently decode missing pixels as zero
      const black = color.r+color.g+color.b < 384;
      const bit = invert ? !black : black;
      bytes[i>>>3]! |= Number(bit) << (7-(i&7));
    }
    return bytes;
  }
  const a = recover(S+3,false), b = recover(S+6,true);
  const hex = (bytes: Uint8Array) => Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
  let va=false,vb=false;
  try { readBootstrap(a); va=true; } catch { /* invalid */ }
  try { readBootstrap(b); vb=true; } catch { /* invalid */ }
  const status = !va && !vb ? 'INVALID_HEADER' : va && vb && hex(a)!==hex(b) ? 'HEADER_CONFLICT' : 'OK';
  return {status,trackAValid:va,trackBValid:vb,hexA:hex(a),hexB:hex(b)};
}
// Avoid using a typed byte array as a decode shortcut: actual pixels become extracted bits first.
import { readHeader as readBootstrap } from '../header.js';
