import test from 'node:test';
import assert from 'node:assert/strict';
import {
 encodeHybridSymbol,rasterize,homographyFromCardinalPoints,idealRasterCardinalPoints,
 sampleHybridRasterRegistered,decodeHybridRasterRegistered,decodeHybridRasterBurstRegistered,
} from '@blcklab/omnimatrix';

// Creates deliberately difficult but *deterministic* pixel-level captures.
// A pair of weakly wrong readings competes against one high-confidence correct
// reading in disjoint regions. This is an adversarial synthetic test, not a phone benchmark.
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

test('M11 confidence fusion recovers weakly wrong-majority colors when old majority fails',()=>{
  const {payload,frameImages}=makeMixedFrames(4096,112,1168);
  for(const f of frameImages)
    assert.throws(()=>decodeHybridRasterRegistered(f.image,f.registration,f.S),/./);
  for(const f of frameImages){
    const sampled=sampleHybridRasterRegistered(f.image,f.registration,f.S);
    assert.equal(sampled.cellConfidenceMargins.length,sampled.cells.length);
    assert.ok(sampled.cellConfidenceMargins.some(v=>v>40));
  }
  assert.throws(()=>decodeHybridRasterBurstRegistered(frameImages),/./);
  const result=decodeHybridRasterBurstRegistered(frameImages,{fusionMode:'CONFIDENCE'});
  assert.deepEqual(result.decoded.payload,payload);
  assert.equal(result.diagnostics.fusionMode,'CONFIDENCE');
  assert.ok(result.diagnostics.weightedConflictCells>500);
});

test('M11 keeps the original majority behavior and validates fusion parameters',()=>{
 const sym=encodeHybridSymbol('m11 compatibility',{S:96});
 const image=rasterize(sym.layout,840,840,{header:sym.header}).image;
 const registration=homographyFromCardinalPoints(96,idealRasterCardinalPoints(96,840,840));
 const frames=Array.from({length:3},()=>({image,registration,S:96}));
 const plain=decodeHybridRasterBurstRegistered(frames);
 const weighted=decodeHybridRasterBurstRegistered(frames,{fusionMode:'CONFIDENCE'});
 assert.deepEqual(plain.decoded.payload,weighted.decoded.payload);
 assert.equal(plain.diagnostics.fusionMode,'MAJORITY');
 assert.equal(weighted.diagnostics.weightedConflictCells,0);
 assert.throws(()=>decodeHybridRasterBurstRegistered(frames,{fusionMode:'UNKNOWN'}),/fusionMode/);
 assert.throws(()=>decodeHybridRasterBurstRegistered(frames,{fusionMode:'CONFIDENCE',minimumConfidenceRatio:.9}),/minimumConfidenceRatio/);
});

test('M11 8 KiB confidence recovery uses exactly the same format and protected bytes',()=>{
  const {payload,frameImages}=makeMixedFrames(8192,160,1728);
  assert.throws(()=>decodeHybridRasterBurstRegistered(frameImages),/./);
  const result=decodeHybridRasterBurstRegistered(frameImages,{fusionMode:'CONFIDENCE'});
  assert.deepEqual(result.decoded.payload,payload);
  assert.equal(result.decoded.S,160);
  assert.ok(result.diagnostics.weightedConflictCells>1000);
});

test('M11 rejects persistent high-confidence corruption instead of silently accepting data',()=>{
  const symbol=encodeHybridSymbol('persistent high confidence damage',{S:96});
  let i=0;
  const cells=symbol.layout.cells.map(cell=>cell.role==='DATA' && i++%4===0
    ? {...cell,colorIndex:(cell.colorIndex+3)%8}:cell);
  const damaged=rasterize({...symbol.layout,cells,byCoordinate:new Map(cells.map(c=>[`${c.q},${c.r}`,c]))},840,840,{header:symbol.header}).image;
  const registration=homographyFromCardinalPoints(96,idealRasterCardinalPoints(96,840,840));
  const frames=Array.from({length:3},()=>({image:damaged,registration,S:96}));
  assert.throws(()=>decodeHybridRasterBurstRegistered(frames,{fusionMode:'CONFIDENCE'}),/./);
});
