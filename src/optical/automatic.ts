import { OmniMatrixError } from '../core/errors.js';
import type { Raster } from '../types.js';
import { identifyAssistedHeader, type OpticalIdentification } from './refinement.js';
import { decodeHybridRasterAssisted, type HybridAssistedDecode, type HybridAssistedDecodeOptions } from './payload-sampling.js';
import type { CardinalPoints } from './registration.js';

/**
 * M8 experimental, marker-only acquisition for ONE isolated, near-frontal,
 * roughly circular HYBRID symbol on a light/white quiet zone. Does not solve
 * arbitrary-background segmentation, multi-symbol acquisition, mirroring,
 * elliptic perspective, or autofocus/rolling-shutter distortion.
 */
export interface AutomaticDetectionOptions {
  /** Reject small images/symbols rather than fabricating optical detail (default 160). */
  readonly minimumDiameterPx?: number;
  /** Constrain optical bootstrap hypotheses. Defaults to the M0 allowable S values. */
  readonly sizes?: readonly number[];
}
export interface AutomaticHybridDetection {
  readonly points: CardinalPoints;
  readonly center: { readonly x:number; readonly y:number };
  readonly rimRadiusPx: number;
  /** Rotation of the primary wide rim notch in image coordinates, radians. */
  readonly rotationRadians: number;
  readonly rimScore: number;
  readonly notchScore: number;
  readonly identification: OpticalIdentification;
  readonly limitations: readonly string[];
}
export interface AutomaticHybridDecode extends HybridAssistedDecode {
  readonly detection: AutomaticHybridDetection;
}

const DEG = Math.PI/180;
function bright(image:Raster, x:number,y:number):number {
  const xx=Math.floor(x), yy=Math.floor(y);
  if(xx<0||yy<0||xx>=image.width||yy>=image.height) return 1;
  const k=(yy*image.width+xx)*3;
  const r=image.data[k]!,g=image.data[k+1]!,b=image.data[k+2]!;
  return (r+g+b)/(3*255);
}
function validate(image:Raster, options:AutomaticDetectionOptions):number {
  if(!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) ||
    image.width<1||image.height<1||image.width*image.height>24_000_000 ||
    !(image.data instanceof Uint8Array)||image.data.length!==image.width*image.height*3)
    throw new OmniMatrixError('INVALID_INPUT','Invalid RGB raster');
  const minimum=options.minimumDiameterPx??160;
  if(!Number.isFinite(minimum)||minimum<64||minimum>2048)
    throw new OmniMatrixError('INVALID_INPUT','minimumDiameterPx must be in [64,2048]');
  return minimum;
}
function rimScore(image:Raster,x:number,y:number,r:number):number {
  let score=0;
  for(let i=0;i<90;i++){
    const angle=(i+.37)*2*Math.PI/90;
    score+=1-bright(image,x+r*Math.cos(angle),y+r*Math.sin(angle));
  }
  return score/90;
}
function notchScore(image:Raster,x:number,y:number,r:number,rotation:number):number {
  // Test primary 14-degree gap and secondary 4-degree gap with black rim flanks.
  const expected:[number,boolean,number][]=[
    [-5,true,1.2],[-3,true,1.2],[0,true,1.5],[3,true,1.2],[5,true,1.2],
    [-13,false,1],[-10,false,1],[10,false,1],[13,false,1],
    [118.6,true,1.2],[120,true,1.5],[121.4,true,1.2],
    [114,false,1],[126,false,1],
  ];
  let sum=0,weight=0;
  for(const [deg,isWhite,w] of expected){
    const angle=rotation+deg*DEG;
    const v=bright(image,x+r*Math.cos(angle),y+r*Math.sin(angle));
    sum+=(isWhite?v:1-v)*w;weight+=w;
  }
  return sum/weight;
}
function pointsAt(cx:number,cy:number,r:number,rotation:number):CardinalPoints {
  return [0,1,2,3].map(i=>({x:cx+r*Math.cos(rotation+i*Math.PI/2),y:cy+r*Math.sin(rotation+i*Math.PI/2)})) as unknown as CardinalPoints;
}

export function detectHybridRaster(image:Raster,options:AutomaticDetectionOptions={}):AutomaticHybridDetection {
  const minimum=validate(image,options);
  // Bounding silhouette estimation: use strongly dark ink (rim + dark modules),
  // NOT non-white pixels. Gray screen backgrounds frequently have channels below
  // 175 and would otherwise expand the bounding box to the whole photograph.
  // The optical header remains the final acceptance gate.
  let xMin=image.width, xMax=-1, yMin=image.height,yMax=-1,count=0;
  const step=Math.max(1,Math.floor(Math.max(image.width,image.height)/1100));
  for(let y=0;y<image.height;y+=step) for(let x=0;x<image.width;x+=step){
    const k=(y*image.width+x)*3;
    if(Math.max(image.data[k]!,image.data[k+1]!,image.data[k+2]!)>110)continue;
    xMin=Math.min(xMin,x);xMax=Math.max(xMax,x);
    yMin=Math.min(yMin,y);yMax=Math.max(yMax,y);count++;
  }
  const w=xMax-xMin+step,h=yMax-yMin+step;
  if(count<300||Math.min(w,h)<minimum)
    throw new OmniMatrixError('INVALID_GEOMETRY','No sufficiently large isolated optical symbol found');
  if(Math.max(w,h)/Math.min(w,h)>1.19)
    throw new OmniMatrixError('INVALID_GEOMETRY','Rim is too elliptical or background contains unrelated dark content');
  if(Math.max(w,h)>Math.min(image.width,image.height)*1.5)
    throw new OmniMatrixError('INVALID_GEOMETRY','Observed symbol extends outside usable image region');
  const initialX=(xMin+xMax+step)/2,initialY=(yMin+yMax+step)/2;
  const approxOuter=(w+h)/4;
  const stepCenter=Math.max(1,approxOuter*.008);
  let best={x:initialX,y:initialY,r:approxOuter*.991,score:-Infinity};
  // Radius is near the outer silhouette, not the inner color-data disk.
  for(const dx of [-2,-1,0,1,2]) for(const dy of [-2,-1,0,1,2]){
    const x=initialX+dx*stepCenter,y=initialY+dy*stepCenter;
    for(const factor of [.965,.975,.985,.991,.997,1.003,1.013]) {
      const r=approxOuter*factor,score=rimScore(image,x,y,r);
      if(score>best.score){best={x,y,r,score};}
    }
  }
  // Camera photos of dense symbols often reduce rim contrast through display moire
  // and exposure. CRC-protected bootstrap identification is the real acceptance gate.
  // Do not reject a plausible, moderately contrasted ring before testing it.
  if(best.score<.55)
    throw new OmniMatrixError('INVALID_GEOMETRY','No sufficiently contrasted circular rim identified');
  const angles:{angle:number; score:number}[]=[];
  for(let degrees=0;degrees<360;degrees+=2){
    const angle=degrees*DEG;
    angles.push({angle,score:notchScore(image,best.x,best.y,best.r,angle)});
  }
  angles.sort((a,b)=>b.score-a.score);
  // CRC of both independent optical tracks is the *acceptance* gate. A plausible
  // silhouette or notch pattern alone can never authorize symbol identification.
  const candidates=angles.slice(0,8);
  const attempt=(x:number,y:number,r:number,angle:number):AutomaticHybridDetection|null=>{
    const landmarks=pointsAt(x,y,r,angle);
    let identified: OpticalIdentification;
    try {identified=identifyAssistedHeader(image,landmarks,{sizes:options.sizes});}
    catch {return null;}
    // Never permit low-contrast finder candidates without a consistent CRC-valid
    // optical bootstrap at their own sampling geometry.
    if(identified.status!=='OK'||!identified.detected||identified.warnings.length)return null;
    return {points:landmarks,center:{x,y},rimRadiusPx:r,
      rotationRadians:angle,rimScore:rimScore(image,x,y,r),notchScore:notchScore(image,x,y,r,angle),
      identification:identified,limitations:['Near-frontal isolated symbol on light quiet zone','No arbitrary background, multiple symbols, mirror or strong perspective']};
  };
  for(const item of candidates)for(const shift of [0,-.7,.7,-1.4,1.4]){
    const found=attempt(best.x,best.y,best.r,item.angle+shift*DEG);
    if(found)return found;
  }
  // Fine localization only after the coarse rim and notch passed. A few pixels
  // of bias in the dark-pixel bounding box is fatal to a dense S160 bootstrap.
  // Keep this search tiny and deterministic for browser camera use; use only
  // reserved finder/header features, not unknown payload cells.
  if(best.score>=.55&&candidates.length){
    for(const [dx,dy] of [[2,0],[-2,0],[0,2],[0,-2],[2,2],[2,-2],[-2,2],[-2,-2]] as const){
      for(const item of candidates.slice(0,3))for(const shift of [0,-.7,.7]){
        const found=attempt(best.x+dx,best.y+dy,best.r,item.angle+shift*DEG);
        if(found)return found;
      }
    }
  }
  throw new OmniMatrixError('INVALID_HEADER','Automatic acquisition could not validate a CRC-protected optical header');
}

/** Direct pixel-image decoding without supplied cardinal registration points. */
export function decodeHybridRasterAutomatic(image:Raster, options:HybridAssistedDecodeOptions & AutomaticDetectionOptions={}):AutomaticHybridDecode {
  const detection=detectHybridRaster(image,options);
  const result=decodeHybridRasterAssisted(image,detection.points,options);
  if(result.identification.status!=='OK'||result.identification.detected?.S!==detection.identification.detected?.S)
    throw new OmniMatrixError('INVALID_HEADER','Automatic and refined header identification disagree');
  return {...result,detection};
}
