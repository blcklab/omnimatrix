import { buildLayout } from '../geometry.js';
import { headerBit, makeHeader, readHeader, type HeaderConfig } from '../header.js';
import { sampleHeaderMapped } from '../optical.js';
import { homographyFromCardinalPoints, mapProjective, measureProjective, type CardinalPoints, type Point, type ProjectiveRegistration } from '../projective.js';
import { rgbPalette } from '../render.js';
import type { Layout, Raster, RGB, PaletteName } from '../types.js';

export interface OpticalIdentification {
  readonly status: 'OK' | 'NO_HEADER' | 'HEADER_CONFLICT';
  readonly detected: HeaderConfig | null;
  readonly detectedFrom: readonly ('A'|'B')[];
  readonly testedSizes: readonly number[];
  readonly warnings: readonly string[];
}
export interface AssistedMeasurement {
  readonly identification: OpticalIdentification;
  readonly selectedS: number;
  readonly selectedPalette: PaletteName;
  readonly effectiveS: number;
  readonly effectivePalette: PaletteName;
  readonly initialRegistration: ProjectiveRegistration;
  readonly registration: ProjectiveRegistration;
  readonly refinedPoints: CardinalPoints;
  readonly refined: boolean;
  readonly initialOpticalScore: number | null;
  readonly finalOpticalScore: number | null;
  readonly result: ReturnType<typeof measureProjective>;
  readonly expectedDataCells: number;
}
const allSizes = Array.from({length:31},(_,i)=>32+i*16);
const paletteFor=(n:number): PaletteName => n===1?'DENSE_8':'RELIABLE_4';
const hexBytes=(str:string):Uint8Array=>Uint8Array.from(str.match(/../g)??[], x=>parseInt(x,16));

/** Attempt CRC-protected optical bootstrap recovery from human-provided approximate rim points.
 * Scans plausible S values and requires a consensus on the *decoded* header. It does not
 * locate a symbol in an unannotated image. Never uses the expected synthetic data pattern.
 */
export function identifyAssistedHeader(image:Raster, points:CardinalPoints, options:{sizes?:readonly number[]}={}): OpticalIdentification {
  const sizes=options.sizes??allSizes;
  const seen=new Map<string,{config:HeaderConfig; tracks:Set<'A'|'B'>; matching:boolean}>();
  const warnings:string[]=[];
  for(const S of sizes){
    // Every radius hypothesis uses the same observed (image) rim anchors.
    const reg=homographyFromCardinalPoints(S,points);
    const hdr=sampleHeaderMapped(image,(x,y)=>mapProjective(reg,x,y),S);
    for(const [name,valid,hex] of [['A',hdr.trackAValid,hdr.hexA],['B',hdr.trackBValid,hdr.hexB]] as const){
      if(!valid)continue;
      const config=readHeader(hexBytes(hex));
      const existing=seen.get(hex);
      if(existing){existing.tracks.add(name); existing.matching ||= config.S===S;}
      else seen.set(hex,{config,tracks:new Set([name]),matching:config.S===S});
    }
  }
  if(!seen.size)return {status:'NO_HEADER',detected:null,detectedFrom:[],testedSizes:[...sizes],warnings:['No valid CRC-protected header recovered from the annotated rim. Check points, image quality or orientation.']};
  if(seen.size>1)return {status:'HEADER_CONFLICT',detected:null,detectedFrom:[],testedSizes:[...sizes],warnings:['Conflicting CRC-valid headers were detected; refusing to select a configuration.']};
  const [candidate]=seen.values();
  if(!candidate!.matching) warnings.push('A valid header was found, but its declared S did not match the sampling hypothesis; verify registration.');
  return {status:'OK',detected:candidate!.config,detectedFrom:[...candidate!.tracks],testedSizes:[...sizes],warnings};
}

/** Bilinear pixel interpolation only for optimization score; measured data stays on M1b's established sampler. */
function bilinear(image:Raster,x:number,y:number):RGB|null{
  const X=x-.5,Y=y-.5,ix=Math.floor(X),iy=Math.floor(Y),fx=X-ix,fy=Y-iy;
  if(ix<0||iy<0||ix+1>=image.width||iy+1>=image.height)return null;
  const d=image.data,w=image.width;
  const a=(iy*w+ix)*3,b=a+3,c=a+w*3,e=c+3;
  function channel(k:number):number{
    return (1-fy)*((1-fx)*d[a+k]!+fx*d[b+k]!)+fy*((1-fx)*d[c+k]!+fx*d[e+k]!);
  }
  return {r:channel(0),g:channel(1),b:channel(2)};
}
function brightness(p:RGB){return (p.r+p.g+p.b)/765;}
function cdist(a:RGB,b:RGB){return ((a.r-b.r)**2+(a.g-b.g)**2+(a.b-b.b)**2)/(3*255*255);}
/** Scores reserved optical structures only: alignment rosettes, calibration pilots, and
 * known bootstrap tracks. Deliberately never scores DATA cells, even for synthetic fixtures.
 */
function opticalScore(layout:Layout,image:Raster,reg:ProjectiveRegistration,header:HeaderConfig):number{
  const palette=rgbPalette(layout.palette);
  let score=0,weight=0;
  for(const c of layout.cells){
    if(c.role==='DATA')continue;
    const xy=mapProjective(reg,c.x,c.y);if(!xy)continue;
    const observed=bilinear(image,xy.x,xy.y);if(!observed)continue;
    const expected= c.role==='ALIGNMENT'?palette[c.colorIndex===0?0:1]!:palette[c.colorIndex]!;
    // Compensate weakly for screen-gain differences by ranking against other palette colors.
    const correct=cdist(observed,expected);
    let competing=Infinity;
    for(let k=0;k<palette.length;k++)if(k!==c.colorIndex)competing=Math.min(competing,cdist(observed,palette[k]!));
    const margin=Math.max(-1,Math.min(1,(competing-correct)*2));
    score+=margin*(c.role==='ALIGNMENT'?1.2:1);weight+=c.role==='ALIGNMENT'?1.2:1;
  }
  // Recreate the validated exact bootstrap for the selected revision. No user-data assumption.
  // Caller supplies readHeader values, which preserve ECC/mask flags.
  const headerBytes=makeHeader(header);
  for(let i=0;i<64;i++){
    const theta=(i+.5)*Math.PI/32;
    for(const [radius,invert] of [[layout.S+3,false],[layout.S+6,true]] as const){
      const xy=mapProjective(reg,radius*Math.cos(theta),radius*Math.sin(theta));if(!xy)continue;
      const color=bilinear(image,xy.x,xy.y);if(!color)continue;
      const black=Boolean(headerBit(headerBytes,i))!==invert;
      const lum=brightness(color);
      score+=1.2*(black?1-2*lum:2*lum-1);weight+=1.2;
    }
  }
  // Central bullseye provides registration even where calibration modules are obscured.
  for(const radius of [1,3,5,7])for(let i=0;i<16;i++){
    const theta=i*Math.PI/8;
    const xy=mapProjective(reg,radius*Math.cos(theta),radius*Math.sin(theta));if(!xy)continue;
    const color=bilinear(image,xy.x,xy.y);if(!color)continue;
    const black=radius===1||radius===5;
    const lum=brightness(color);score+=.6*(black?1-2*lum:2*lum-1);weight+=.6;
  }
  return weight?score/weight:-Infinity;
}
function asCardinal(points:readonly Point[]):CardinalPoints{
  if(points.length!==4)throw new RangeError('Expected four anchors');
  return [points[0]!,points[1]!,points[2]!,points[3]!];
}
/** Constrained, deterministic coordinate descent on the four manual rim landmarks.
 * Search is pixel-bounded, not unconstrained perspective estimation. It is NOT automatic
 * acquisition and may fail with heavy glare, oblique capture or poor initial clicks.
 */
export function refineAssistedRegistration(layout:Layout,image:Raster,points:CardinalPoints,header:HeaderConfig,options:{maxShiftPx?:number}={}):{
    points:CardinalPoints; registration:ProjectiveRegistration; initialScore:number; finalScore:number; refined:boolean;
  }{
  const maxShift=options.maxShiftPx??Math.min(16,Math.max(3,Math.min(image.width,image.height)*.015));
  if(!Number.isFinite(maxShift)||maxShift<0||maxShift>32)throw new RangeError('Invalid registration refinement bound');
  const orig=points.map(p=>({...p})),candidate=orig.map(p=>({...p}));
  const init=homographyFromCardinalPoints(layout.S,points);
  const initialScore=opticalScore(layout,image,init,header);
  let bestScore=initialScore,bestReg=init;
  // Prioritize low-dimensional global motion before independent corner updates.
  for(const step of [Math.min(5,maxShift),2,1,.5]){
    if(step<=0||step>maxShift)continue;
    for(let repeat=0;repeat<2;repeat++){
      let changed=false;
      const directions:readonly (readonly [number,number])[]=[[1,0],[-1,0],[0,1],[0,-1]];
      // translation tweaks move four points together; then individual corner offsets.
      for(const index of [-1,0,1,2,3]){
        let nextScore=bestScore,nextPoints:Point[]|null=null,nextReg:ProjectiveRegistration|null=null;
        for(const [dx,dy] of directions){
          const trial=candidate.map((p,k)=>({x:p.x+(index===-1||index===k?dx*step:0),y:p.y+(index===-1||index===k?dy*step:0)}));
          if(trial.some((p,k)=>Math.hypot(p.x-orig[k]!.x,p.y-orig[k]!.y)>maxShift))continue;
          try{
            const reg=homographyFromCardinalPoints(layout.S,asCardinal(trial));
            const value=opticalScore(layout,image,reg,header);
            if(value>nextScore+1e-6){nextScore=value;nextPoints=trial;nextReg=reg;}
          }catch{/* geometric constraint violation */}
        }
        if(nextPoints&&nextReg){
          for(let j=0;j<4;j++){candidate[j]=nextPoints[j]!;}
          bestReg=nextReg;bestScore=nextScore;changed=true;
        }
      }
      if(!changed)break;
    }
  }
  return {points:asCardinal(candidate),registration:bestReg,initialScore,finalScore:bestScore,refined:bestScore>initialScore+1e-6};
}
export function measureAssisted(image:Raster,points:CardinalPoints,selectedS:number,selectedPalette:PaletteName,options:{refine?:boolean; sizes?:readonly number[]; maxShiftPx?:number}={}):AssistedMeasurement{
  if(selectedPalette!=='DENSE_8'&&selectedPalette!=='RELIABLE_4')throw new RangeError('Invalid palette');
  const identification=identifyAssistedHeader(image,points,{sizes:options.sizes});
  const effectiveS=identification.detected?.S??selectedS;
  const effectivePalette=identification.detected?paletteFor(identification.detected.palette):selectedPalette;
  const layout=buildLayout(effectiveS,effectivePalette);
  const initialRegistration=homographyFromCardinalPoints(effectiveS,points);
  let registration=initialRegistration,refinedPoints=points,refined=false,initialOpticalScore:null|number=null,finalOpticalScore:null|number=null;
  if(identification.status==='OK'&&identification.detected){
    const optimized=refineAssistedRegistration(layout,image,points,identification.detected,{maxShiftPx:options.refine===false?0:options.maxShiftPx});
    registration=optimized.registration;refinedPoints=optimized.points;refined=optimized.refined;
    initialOpticalScore=optimized.initialScore;finalOpticalScore=optimized.finalScore;
  }
  return {identification,selectedS,selectedPalette,effectiveS,effectivePalette,initialRegistration,registration,refinedPoints,refined,initialOpticalScore,finalOpticalScore,
    result:measureProjective(layout,image,registration),expectedDataCells:layout.dataCount};
}
