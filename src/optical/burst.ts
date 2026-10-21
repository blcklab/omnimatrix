import { OmniMatrixError } from '../core/errors.js';
import { decodeHybridCells, type HybridDecodedPayload } from '../api/hybrid-symbol.js';
import { buildLayout } from '../geometry/hybrid.js';
import { readHeader } from '../protocol/bootstrap.js';
import type { Raster, PaletteName } from '../types.js';
import { detectHybridRaster, type AutomaticDetectionOptions, type AutomaticHybridDetection } from './automatic.js';
import { sampleHybridRasterRegistered, type HybridPixelDiagnostics, type HybridAssistedDecodeOptions, type SampledHybridPixels } from './payload-sampling.js';
import { refineAssistedRegistration } from './refinement.js';
import type { ProjectiveRegistration } from './registration.js';

/** A separately registered photograph of the SAME, stationary optical code. */
export interface RegisteredBurstFrame {
  readonly image: Raster;
  readonly registration: ProjectiveRegistration;
  readonly S: number;
}
export type BurstFusionMode = 'MAJORITY' | 'CONFIDENCE';
/** Confidence weighting is optional and changes no symbol bytes or geometry. */
export interface BurstDecodeOptions extends HybridAssistedDecodeOptions {
  readonly fusionMode?: BurstFusionMode;
  /** Minimum winner-to-runner score ratio in CONFIDENCE mode. Default 1.5. */
  readonly minimumConfidenceRatio?: number;
}
export interface BurstDiagnostics {
  readonly fusionMode: BurstFusionMode;
  readonly weightedConflictCells: number;
  readonly frames: number;
  /** Data cells where not every frame agreed. */
  readonly disputedCells: number;
  /** Cells rejected because no color received a strict majority. */
  readonly ambiguousCells: number;
  readonly unanimousCells: number;
  /** Per-frame calibration, structural validation and confidence. */
  readonly frameSampling: readonly HybridPixelDiagnostics[];
}
export interface BurstDecodeResult {
  readonly decoded: HybridDecodedPayload;
  readonly diagnostics: BurstDiagnostics;
}
export interface AutomaticBurstDecodeResult extends BurstDecodeResult {
  readonly detections: readonly AutomaticHybridDetection[];
}

function frameCount(length:number):void {
  // Fixed and bounded to avoid long-running browser workers, tie ambiguity and huge allocations.
  if (length !== 3 && length !== 5)
    throw new OmniMatrixError('INVALID_INPUT','M10 burst decoder requires exactly 3 or 5 frames');
}
/** Consensus considers ONLY independently sampled data, never a known test pattern. */
function fuse(samples: readonly SampledHybridPixels[], options: BurstDecodeOptions): BurstDecodeResult {
  const first=samples[0]!;
  const header=readHeader(first.header);
  const n=samples.length;
  const fusionMode=options.fusionMode??'MAJORITY';
  const minimumConfidenceRatio=options.minimumConfidenceRatio??1.5;
  if(fusionMode!=='MAJORITY' && fusionMode!=='CONFIDENCE')
    throw new OmniMatrixError('INVALID_INPUT','Invalid burst fusionMode');
  if(!Number.isFinite(minimumConfidenceRatio)||minimumConfidenceRatio<1||minimumConfidenceRatio>10)
    throw new OmniMatrixError('INVALID_INPUT','minimumConfidenceRatio must be in [1,10]');
  for(const sampled of samples){
    const config=readHeader(sampled.header);
    if(config.S!==header.S||config.palette!==header.palette||config.ecc!==header.ecc||config.mask!==header.mask ||
       sampled.cells.length!==first.cells.length || sampled.cellConfidenceMargins.length!==first.cells.length)
      throw new OmniMatrixError('INVALID_HEADER','Burst frames contain incompatible optical headers or layouts');
  }
  const colors=header.palette===1?8:4;
  const layout=buildLayout(header.S,header.palette===1?'DENSE_8':'RELIABLE_4');
  let disputedCells=0,ambiguousCells=0,unanimousCells=0,weightedConflictCells=0;
  const cells=first.cells.map((cell,i)=>{
    const role=layout.byCoordinate.get(`${cell.q},${cell.r}`)?.role;
    if(role!=='DATA')return cell;
    const votes=new Uint8Array(colors);
    const weights=new Float64Array(colors);
    for(const sampled of samples){
      const candidate=sampled.cells[i]!;
      if(candidate.q!==cell.q||candidate.r!==cell.r ||
         !Number.isInteger(candidate.colorIndex)||candidate.colorIndex<0||candidate.colorIndex>=colors)
        throw new OmniMatrixError('INVALID_GEOMETRY','Burst frame has inconsistent or invalid axial data cell');
      votes[candidate.colorIndex]!++;
      const margin=sampled.cellConfidenceMargins[i]!;
      if(!Number.isFinite(margin)||margin<0)
        throw new OmniMatrixError('INVALID_INPUT','Burst contains invalid per-cell confidence');
      // Limit the influence of any one reading. Calibrated margins, not original payload
      // or known color patterns, are the only data used to weight the sampled votes.
      weights[candidate.colorIndex]!+=Math.max(1,Math.min(128,margin));
    }
    let majorityIndex=0,majorityVotes=0;
    for(let k=0;k<colors;k++) if(votes[k]!>majorityVotes){majorityIndex=k;majorityVotes=votes[k]!;}
    if(majorityVotes===n)unanimousCells++;
    else disputedCells++;
    let winner=majorityIndex;
    if(fusionMode==='MAJORITY') {
      if(majorityVotes<=n/2)ambiguousCells++;
    } else {
      let highest=-1,runner=-1,winnerIndex=-1;
      for(let k=0;k<colors;k++){
        const weight=weights[k]!;
        if(weight>highest){runner=highest;highest=weight;winnerIndex=k;}
        else if(weight>runner)runner=weight;
      }
      // Strict decision boundary: never fabricate a data cell from tied/unconvincing votes.
      if(highest<=0 || highest<=runner*minimumConfidenceRatio)ambiguousCells++;
      else {
        winner=winnerIndex;
        if(winner!==majorityIndex)weightedConflictCells++;
      }
    }
    return {q:cell.q,r:cell.r,colorIndex:winner};
  });
  if(ambiguousCells)throw new OmniMatrixError('ECC_UNRECOVERABLE',
    `Burst ${fusionMode.toLowerCase()} fusion has ${ambiguousCells} ambiguous data cells`);
  // The independently reconstructed layout, RS decoder, and OMD1 CRC-32 remain
  // mandatory acceptance checks; weighted fusion NEVER counts as payload verification.
  const decoded=decodeHybridCells({header:first.header,cells});
  return {decoded,diagnostics:{fusionMode,weightedConflictCells,frames:n,
    disputedCells,ambiguousCells,unanimousCells,frameSampling:samples.map(s=>s.diagnostics)}};
}

/**
 * M10 opt-in multi-frame majority fusion. Every frame independently samples the entire
 * symbol and validates its optical structures; noisy data cells are fused before RS/CRC.
 * Does not fix common-mode blur, screen moire, wrong size, perspective, or unrelated symbols.
 */
export function decodeHybridRasterBurstRegistered(frames:readonly RegisteredBurstFrame[],
  options:BurstDecodeOptions={}):BurstDecodeResult {
  if(!Array.isArray(frames))throw new OmniMatrixError('INVALID_INPUT','Expected burst frames');
  frameCount(frames.length);
  const sampled=frames.map(f=>sampleHybridRasterRegistered(f.image,f.registration,f.S,options));
  return fuse(sampled,options);
}

/** Independently acquire and refine each frame before strict-majority voting. */
export function decodeHybridRasterBurstAutomatic(images:readonly Raster[],
  options:BurstDecodeOptions & AutomaticDetectionOptions={}):AutomaticBurstDecodeResult {
  if(!Array.isArray(images))throw new OmniMatrixError('INVALID_INPUT','Expected RGB burst rasters');
  frameCount(images.length);
  const detections=images.map(image=>detectHybridRaster(image,options));
  const configs=detections.map(d=>d.identification.detected);
  const cfg=configs[0];
  if(!cfg||configs.some(c=>!c || c.S!==cfg.S||c.palette!==cfg.palette||c.ecc!==cfg.ecc||c.mask!==cfg.mask))
    throw new OmniMatrixError('INVALID_HEADER','Burst frames identify different optical configurations');
  const palette:PaletteName=cfg.palette===1?'DENSE_8':'RELIABLE_4';
  const layout=buildLayout(cfg.S,palette);
  const registrations=images.map((image,i)=>refineAssistedRegistration(layout,image,detections[i]!.points,cfg,{
    maxShiftPx:options.refine===false?0:options.maxShiftPx,
  }).registration);
  const decoded=decodeHybridRasterBurstRegistered(images.map((image,i)=>({image,registration:registrations[i]!,S:cfg.S})),options);
  return {...decoded,detections};
}
