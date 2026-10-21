/** Deterministic adversarial *rendered-image* burst benchmark; not real-camera evidence. */
import {encodeHybridSymbol, rasterize, decodeHybridRasterRegistered, decodeHybridRasterBurstRegistered,
 homographyFromCardinalPoints,idealRasterCardinalPoints} from '@blcklab/omnimatrix';
import {writeFile,mkdir} from 'node:fs/promises';
const results=[];
for(const [bytes,S,pixels] of [[4096,112,1168],[8192,160,1728]]){
 const payload=Uint8Array.from({length:bytes},(_,i)=>(Math.imul(i+17,113)^(i>>>3)*57)&255);
 const symbol=encodeHybridSymbol(payload,{S,palette:'DENSE_8',ecc:'MEDIUM'});
 const registration=homographyFromCardinalPoints(S,idealRasterCardinalPoints(S,pixels,pixels));
 const frames=[],singleFrameResults=[];
 for(let frameIndex=0;frameIndex<3;frameIndex++){
   let index=0;
   const cells=symbol.layout.cells.map(cell=>{
     if(cell.role!=='DATA')return cell;
     return index++ % 12 === frameIndex*4 ? {...cell,colorIndex:(cell.colorIndex+3)%8} : cell;
   });
   const layout={...symbol.layout,cells,byCoordinate:new Map(cells.map(cell=>[`${cell.q},${cell.r}`,cell]))};
   const image=rasterize(layout,pixels,pixels,{header:symbol.header}).image;
   frames.push({image,registration,S});
   try{
     const dec=decodeHybridRasterRegistered(image,registration,S);
     singleFrameResults.push({frame:frameIndex+1,recovered:Buffer.from(dec.decoded.payload).equals(Buffer.from(payload))});
   }catch(e){singleFrameResults.push({frame:frameIndex+1,recovered:false,code:e.code??'ERROR'});}
 }
 const fused=decodeHybridRasterBurstRegistered(frames);
 const success=Buffer.from(fused.decoded.payload).equals(Buffer.from(payload));
 if(!success)throw Error('Burst did not recover exact payload');
 results.push({bytes,S,pixels,singleFrameResults,burstRecovered:success,
   disputedCells:fused.diagnostics.disputedCells,unanimousCells:fused.diagnostics.unanimousCells,
   ambiguousCells:fused.diagnostics.ambiguousCells});
 console.log(`${bytes} bytes: individual frames ${singleFrameResults.map(f=>f.recovered?'PASS':'FAIL').join('/')}, 3-frame burst ${success?'PASS':'FAIL'}; disputed=${fused.diagnostics.disputedCells}`);
}
const report={schema:'OMNIMATRIX_M10_RENDERED_BURST_V1',source:'deterministic_synthetic_rendered_images',realCameraEvidence:false,
 technique:'Three different corruption locations (each frame has one out of 12 DATA cells recolored). Exact header/geometry preserved; registered independently before majority vote.',
 caveat:'Not an estimate of probability of phone scanning; persistent blur and screen moire are untested.',results};
await mkdir(new URL('../research/results/',import.meta.url),{recursive:true});
await writeFile(new URL('../research/results/M10-BURST-SYNTHETIC-RESULTS.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
