import { sampleMapped, sampleHeaderMapped } from '../optical.js';
import type { Layout, Raster, SampleResult } from '../types.js';

/** Image coordinates of cardinal points at nominal radius S+9, in this exact order:
 * +X / primary rim notch, +Y, -X, -Y. This is user-assisted registration,
 * NOT automatic detection, and assumes a planar printed/displayed symbol.
 */
export type CardinalPoints = readonly [Point, Point, Point, Point];
export interface Point { readonly x: number; readonly y: number }
/** Exact rim landmarks for a PNG made with rasterize(layout, width, height)
 * using its default, unrotated camera transform. This is NEVER valid for
 * user-selected photos, crops, perspective distortion, or rescaled images.
 * Use only for a programmatically generated reference fixture.
 */
export function idealRasterCardinalPoints(S: number, width: number, height: number): CardinalPoints {
  if (!Number.isInteger(S) || S < 32 || S > 512 || S % 16 !== 0) throw new RangeError('Invalid S');
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new RangeError('Invalid ideal raster dimensions');
  const scale = Math.min(width, height) / (2 * (S + 14));
  const rim = scale * (S + 9), cx = width / 2, cy = height / 2;
  return [{ x: cx + rim, y: cy }, { x: cx, y: cy + rim },
    { x: cx - rim, y: cy }, { x: cx, y: cy - rim }];
}

export interface ProjectiveRegistration {
  /** Row-major 3x3 projective mapping: symbol coordinate -> image pixel coordinate. */
  readonly h: readonly [number,number,number,number,number,number,number,number,number];
  readonly conditionCheck: number;
}

function validatePoint(point: Point): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new RangeError('Non-finite annotation point');
}

/** Solve an 8x8 linear system with partial pivoting. Throws on degenerate cardinal annotations. */
function solve8(rows: number[][], rhs: number[]): number[] {
  for (let i = 0; i < 8; i++) {
    let pivot = i;
    for (let j = i + 1; j < 8; j++) if (Math.abs(rows[j]![i]!) > Math.abs(rows[pivot]![i]!)) pivot = j;
    if (Math.abs(rows[pivot]![i]!) < 1e-10) throw new RangeError('Degenerate registration: points cannot determine a homography');
    [rows[i], rows[pivot]] = [rows[pivot]!,rows[i]!];
    [rhs[i],rhs[pivot]] = [rhs[pivot]!,rhs[i]!];
    const divisor = rows[i]![i]!;
    for (let k = i; k < 8; k++) rows[i]![k]! /= divisor;
    rhs[i]! /= divisor;
    for (let j=0;j<8;j++) {
      if (j===i) continue;
      const factor=rows[j]![i]!;
      for (let k=i;k<8;k++) rows[j]![k]! -= factor*rows[i]![k]!;
      rhs[j]! -= factor*rhs[i]!;
    }
  }
  return rhs;
}

export function homographyFromCardinalPoints(S: number, points: CardinalPoints): ProjectiveRegistration {
  if (!Number.isInteger(S) || S < 32 || S > 512 || S % 16 !== 0) throw new RangeError('Invalid S');
  if (points.length !== 4) throw new RangeError('Exactly four points required');
  for (const p of points) validatePoint(p);
  const R=S+9;
  // Normalize canonical positions to radius 1 to reduce conditioning issues;
  // convert the resulting coefficients back to actual symbol coordinates.
  const canonical: readonly Point[] = [ {x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1} ];
  const a:number[][]=[], b:number[]=[];
  for(let i=0;i<4;i++) {
    const {x,y}=canonical[i]!, {x:u,y:v}=points[i]!;
    a.push([x,y,1,0,0,0,-u*x,-u*y]); b.push(u);
    a.push([0,0,0,x,y,1,-v*x,-v*y]); b.push(v);
  }
  const p=solve8(a,b);
  const h=[p[0]!/R,p[1]!/R,p[2]!,p[3]!/R,p[4]!/R,p[5]!,p[6]!/R,p[7]!/R,1] as const;
  const reg:ProjectiveRegistration={h,conditionCheck:0};
  // Check for foldovers / near singular mappings and unrealistic distance.
  const p0=mapProjective(reg,0,0);
  if (!p0) throw new RangeError('Invalid projective center');
  let minArea=Infinity;
  const vertices=points;
  for(let i=0;i<4;i++) {
    const c=vertices[i]!, n=vertices[(i+1)%4]!, nn=vertices[(i+2)%4]!;
    const area=(n.x-c.x)*(nn.y-n.y)-(n.y-c.y)*(nn.x-n.x);
    minArea=Math.min(minArea,area);
  }
  if (minArea < 1) throw new RangeError('Cardinal points must be clockwise in image coordinates, non-overlapping, and well separated');
  for (const xy of [ {x:0,y:0},{x:R,y:0},{x:0,y:R},{x:-R,y:0},{x:0,y:-R} ]) {
    if (!mapProjective(reg,xy.x,xy.y)) throw new RangeError('Registration is singular within symbol');
  }
  return {...reg,conditionCheck:minArea};
}
export function mapProjective(reg: ProjectiveRegistration, x: number, y: number): Point | null {
  const h=reg.h;
  const w=h[6]*x+h[7]*y+h[8];
  if (!Number.isFinite(w)||Math.abs(w)<1e-8) return null;
  const u=(h[0]*x+h[1]*y+h[2])/w;
  const v=(h[3]*x+h[4]*y+h[5])/w;
  return Number.isFinite(u)&&Number.isFinite(v)?{x:u,y:v}:null;
}
export function rgbaToRaster(width:number,height:number,bytes:Uint8Array|Uint8ClampedArray):Raster {
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>24_000_000) throw new RangeError('RGBA dimensions out of range');
  if(bytes.length!==width*height*4) throw new RangeError('RGBA length mismatch');
  const rgb=new Uint8Array(width*height*3);
  for(let i=0,j=0;i<bytes.length;i+=4,j+=3) {
    const alpha=bytes[i+3]!/255;
    // White is the agreed quiet-zone/transparent-pixel compositing background.
    rgb[j]=Math.round(bytes[i]!*alpha+255*(1-alpha));
    rgb[j+1]=Math.round(bytes[i+1]!*alpha+255*(1-alpha));
    rgb[j+2]=Math.round(bytes[i+2]!*alpha+255*(1-alpha));
  }
  return {width,height,data:rgb};
}
/** Read photo pixels using manual quadrilateral registration, without a hidden ground-truth pose. */
export function measureProjective(layout:Layout,image:Raster,registration:ProjectiveRegistration,options:{calibrate?:boolean;samplesPerCell?:1|5}={}):{
  readonly sample:SampleResult;
  readonly header:ReturnType<typeof sampleHeaderMapped>;
  readonly projectedCenter:Point|null;
} {
  const map=(x:number,y:number)=>mapProjective(registration,x,y);
  return {
    sample:sampleMapped(layout,image,map,{samplesPerCell:5,...options}),
    header:sampleHeaderMapped(image,map,layout.S),
    projectedCenter:map(0,0),
  };
}
/** Preview annotations for human inspection, not a detection score. */
export function visibleProjection(layout:Layout,registration:ProjectiveRegistration,maxPoints=2000):Point[] {
  const stride=Math.max(1,Math.ceil(layout.cells.length/maxPoints));
  const results:Point[]=[];
  for(let i=0;i<layout.cells.length;i+=stride){const c=layout.cells[i]!;const p=mapProjective(registration,c.x,c.y);if(p)results.push(p);}
  return results;
}
