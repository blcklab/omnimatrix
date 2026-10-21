import { OmniMatrixError } from '../core/errors.js';
import type { Raster } from '../types.js';

/** M7 synthetic-only research utilities; these are NOT a model of a particular camera. */
function valid(image: Raster): void {
  if (!(image?.data instanceof Uint8Array) || !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) || image.width <= 0 || image.height <= 0 ||
    image.width * image.height > 24_000_000 || image.data.length !== image.width * image.height * 3) {
    throw new OmniMatrixError('INVALID_INPUT','Invalid RGB raster for chromatic experiment');
  }
}
function clamp(n:number): number { return Math.max(0,Math.min(255,Math.round(n))); }
/** Preserve central bullseye and outer header/rim, stress ONLY the colored lattice region. */
function interior(x:number,y:number,width:number,height:number): {x:number;y:number}|null {
  const nx=(x+.5-width/2)/(width/2);
  const ny=(y+.5-height/2)/(height/2);
  const radius=Math.hypot(nx,ny);
  return radius >= .065 && radius <= .9 ? {x:nx,y:ny} : null;
}
export function chromaticGradient(image:Raster, amplitude=100):Raster {
  valid(image);
  if(!Number.isFinite(amplitude) || amplitude < 0 || amplitude>140)
    throw new OmniMatrixError('INVALID_INPUT','Gradient amplitude must be in [0,140]');
  const output=image.data.slice(), {width,height}=image;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=interior(x,y,width,height);if(!p)continue;
    const i=3*(y*width+x);
    const r=image.data[i]!,g=image.data[i+1]!,b=image.data[i+2]!;
    output[i]=clamp(r*.47+64 +(p.x*.6+p.y*.4)*amplitude);
    output[i+1]=clamp(g*.47+64 +(-p.x*.7+p.y*.3)*amplitude);
    output[i+2]=clamp(b*.47+64 +(p.x*.3-p.y*.8)*amplitude);
  }
  return {width,height,data:output};
}
export function chromaticImpulseNoise(image:Raster,rate=.02,contrast=.25,seed=0x598deb71):Raster {
  valid(image);
  if(!Number.isFinite(rate)||rate<0||rate>1 || !Number.isFinite(contrast)||contrast<=0||contrast>1 || !Number.isSafeInteger(seed))
    throw new OmniMatrixError('INVALID_INPUT','Noise rate, contrast, or seed invalid');
  let state=seed>>>0;
  function random():number{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;}
  const output=image.data.slice(),{width,height}=image;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(!interior(x,y,width,height))continue;
    const i=3*(y*width+x);
    for(let ch=0;ch<3;ch++)output[i+ch]=clamp(image.data[i+ch]!*contrast+128*(1-contrast));
    if(random()<rate){const v=random()<.5?0:255;output[i]=v;output[i+1]=v;output[i+2]=v;}
  }
  return {width,height,data:output};
}
