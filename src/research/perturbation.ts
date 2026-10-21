import type { Raster } from '../types.js';
export interface Perturbation {
  readonly seed?: number;
  /** Gaussian noise sigma in 0..255 intensity units. */
  readonly noiseSigma?: number;
  /** Average each pixel with a 3x3 neighborhood. */
  readonly blur?: boolean;
  /** Multiply each channel by independently configurable gains. */
  readonly gains?: readonly [number, number, number];
  /** Add a neutral grey veil, e.g. 0.3 means 30% grey. */
  readonly washout?: number;
}
export function perturb(image: Raster, options: Perturbation): Raster {
  const {width,height} = image;
  let state = (options.seed ?? 123456789) >>> 0;
  function random(): number { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state>>>0)/0x100000000; }
  function gaussian(): number { const x = Math.max(1e-12, random()), y = random(); return Math.sqrt(-2*Math.log(x))*Math.cos(2*Math.PI*y); }
  const out = new Uint8Array(image.data.length);
  const gains = options.gains ?? [1,1,1], veil = Math.min(1,Math.max(0,options.washout ?? 0)), sigma = options.noiseSigma ?? 0;
  for (let p = 0; p < width*height; p++) for (let ch = 0; ch < 3; ch++) {
    let value = image.data[p*3+ch]!;
    if (options.blur) {
      const y = Math.floor(p/width), x=p%width;
      let sum=0,n=0;
      for (let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
        const xx=x+dx,yy=y+dy;
        if(xx>=0&&yy>=0&&xx<width&&yy<height) {sum+=image.data[(yy*width+xx)*3+ch]!;n++;}
      }
      value = sum/n;
    }
    value = (value * gains[ch]!)*(1-veil) + 128*veil;
    if (sigma) value+=sigma*gaussian();
    out[p*3+ch] = Math.max(0,Math.min(255,Math.round(value)));
  }
  return {width,height,data:out};
}
