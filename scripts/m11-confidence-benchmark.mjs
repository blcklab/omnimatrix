/** M11 confidence-fusion simulation; NOT real phone-camera evidence. */
import {encodeHybridSymbol,rasterize,homographyFromCardinalPoints,idealRasterCardinalPoints,decodeHybridRasterRegistered,decodeHybridRasterBurstRegistered} from '@blcklab/omnimatrix';
import {writeFile,mkdir} from 'node:fs/promises';

function makeMixedFrames(bytes,S,pixels){
  const payload=Uint8Array.from({length:bytes},(_,i)=>(Math.imul(i+7,101) ^ (i>>>4)*37)&255);
  const symbol=encodeHybridSymbol(payload,{S,ecc:'MEDIUM'});
  const registration=homographyFromCardinalPoints(S,idealRasterCardinalPoints(S,pixels,pixels));
  const pristine=rasterize(symbol.layout,pixels,pixels,{header:symbol.header}).image;
  const frameImages=[];
  for(let frame=0;frame<3;frame++){
    let n=0;
    const cells=symbol.layout.cells.map(cell=>{
      if(cell.role!=='DATA') return cell;
      const group=(n++%12);
      // Groups 0,1,2 get a weak wrong majority; the two affected frame
      // indices differ by group so no one frame is spared from errors.
      const wrong=group===0 ? frame!==2 : group===1 ? frame!==0 : group===2 ? frame!==1 : false;
      return wrong?{...cell,colorIndex:(cell.colorIndex+3)%8}:cell;
    });
    const corrupted=rasterize({...symbol.layout,cells,byCoordinate:new Map(cells.map(cell=>[`${cell.q},${cell.r}`,cell]))},pixels,pixels,{header:symbol.header}).image;
    const data=pristine.data.slice();
    for(let i=0;i<data.length;i++){
      if(corrupted.data[i]!==pristine.data[i])
        data[i]=Math.round(pristine.data[i]*.46 + corrupted.data[i]*.54);
    }
    frameImages.push({image:{...pristine,data},registration,S});
  }
  return {payload,frameImages};
}


const results=[];
for(const [bytes,S,pixels] of [[4096,112,1168],[8192,160,1728]]){
  const {payload,frameImages}=makeMixedFrames(bytes,S,pixels);
  const singles=frameImages.map(frame=>{
    try{
      const recovered=decodeHybridRasterRegistered(frame.image,frame.registration,frame.S);
      return {recovered:Buffer.from(recovered.decoded.payload).equals(Buffer.from(payload))};
    }catch(error){return {recovered:false,code:error.code??'ERROR'};}
  });
  let majorityRecovered=false;
  try{majorityRecovered=Buffer.from(decodeHybridRasterBurstRegistered(frameImages).decoded.payload).equals(Buffer.from(payload));}
  catch{majorityRecovered=false;}
  const weighted=decodeHybridRasterBurstRegistered(frameImages,{fusionMode:'CONFIDENCE'});
  const confidenceRecovered=Buffer.from(weighted.decoded.payload).equals(Buffer.from(payload));
  if(singles.some(s=>s.recovered)||majorityRecovered||!confidenceRecovered)
    throw new Error('M11 benchmark invariant failed');
  results.push({payloadBytes:bytes,S,renderPx:pixels,singleFrames:singles,
    majorityRecovered,confidenceRecovered,weightedConflictCells:weighted.diagnostics.weightedConflictCells,
    disputedCells:weighted.diagnostics.disputedCells,crcAndEccVerified:true});
  console.log(`M11 ${bytes} bytes: singles FAIL, majority FAIL, confidence PASS; changed majority votes=${weighted.diagnostics.weightedConflictCells}`);
}
const report={schema:'OMNIMATRIX_M11_SYNTHETIC_CONFIDENCE_V1',source:'deterministic_synthetic_pixel_blends',
  realCameraEvidence:false,physicalScanningValidated:false,
  scenario:'Original pixels vs. weakly wrong RGB blends across differently affected cell groups; two wrong low-margin votes per affected cell, one strong correct vote.',
  limits:'Cannot repair stable common-mode blur, screen moire, low sensor resolution or all-frames high-confidence errors. Cannot estimate field success rates.',
  results};
const file=new URL('../research/results/M11-CONFIDENCE-BENCHMARK.json',import.meta.url);
await mkdir(new URL('../research/results/',import.meta.url),{recursive:true});
await writeFile(file,JSON.stringify(report,null,2)+'\n');
