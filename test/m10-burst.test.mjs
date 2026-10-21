import test from 'node:test';
import assert from 'node:assert/strict';
import {
 encodeHybridSymbol, rasterizeHybridSymbol, rasterize, homographyFromCardinalPoints,
 idealRasterCardinalPoints,decodeHybridRasterRegistered,decodeHybridRasterBurstRegistered,
 decodeHybridRasterBurstAutomatic,decodeHybridCells,
} from '@blcklab/omnimatrix';

function makeFrames(payloadBytes,S,size){
 const payload=Uint8Array.from({length:payloadBytes},(_,i)=>(Math.imul(i+17,113)^(i>>>3)*57)&255);
 const symbol=encodeHybridSymbol(payload,{S, palette:'DENSE_8',ecc:'MEDIUM'});
 const frames=[];
 for(let frameIndex=0;frameIndex<3;frameIndex++){
  let dataIndex=0;
  const cells=symbol.layout.cells.map(cell=>{
    if(cell.role!=='DATA')return cell;
    const flip=(dataIndex++%12)===(frameIndex*4);
    return flip?{...cell,colorIndex:(cell.colorIndex+3)%8}:cell;
  });
  const reg=homographyFromCardinalPoints(S,idealRasterCardinalPoints(S,size,size));
  const image=rasterize({...symbol.layout,cells,byCoordinate:new Map(cells.map(c=>[`${c.q},${c.r}`,c]))},size,size,{header:symbol.header}).image;
  frames.push({image,registration:reg,S});
 }
 return {payload,symbol,frames};
}

test('M10 4 KiB: noisy individual images fail RS while consensus restores bytes',()=>{
 const {payload,frames}=makeFrames(4096,112,1168);
 for(const f of frames)assert.throws(()=>decodeHybridRasterRegistered(f.image,f.registration,f.S),/./);
 const result=decodeHybridRasterBurstRegistered(frames);
 assert.deepEqual(result.decoded.payload,payload);
 assert.equal(result.diagnostics.frames,3);
 assert.ok(result.diagnostics.disputedCells>100);
 assert.equal(result.diagnostics.ambiguousCells,0);
 assert.throws(()=>decodeHybridRasterBurstRegistered([frames[0],frames[0],frames[0]]),/./,
 'Repeated identical damaged frame must not be presented as a successful burst');
});

test('M10 8 KiB: independently registered noisy images decode via consensus',()=>{
 const {payload,frames}=makeFrames(8192,160,1728);
 const result=decodeHybridRasterBurstRegistered(frames);
 assert.deepEqual(result.decoded.payload,payload);
 assert.ok(result.diagnostics.disputedCells>1000);
});

test('M10 automatic acquisition independently identifies generated burst',()=>{
 const payload=new TextEncoder().encode('M10 independent automatic camera frame registration');
 const sym=encodeHybridSymbol(payload,{S:96});
 const frames=Array.from({length:3},()=>rasterizeHybridSymbol(sym,832,832).image);
 const result=decodeHybridRasterBurstAutomatic(frames,{sizes:[96]});
 assert.deepEqual(result.decoded.payload,payload);
 assert.equal(result.detections.length,3);
 assert.equal(result.diagnostics.disputedCells,0);
});

test('M10 refuses inadequate frame count and unrelated optical headers',()=>{
 const a=encodeHybridSymbol('alpha',{S:96});const b=encodeHybridSymbol('beta',{S:112});
 const f=(s,size)=>({image:rasterizeHybridSymbol(s,size,size).image,
  registration:homographyFromCardinalPoints(s.layout.S,idealRasterCardinalPoints(s.layout.S,size,size)),S:s.layout.S});
 assert.throws(()=>decodeHybridRasterBurstRegistered([f(a,800),f(a,800)]),/3 or 5/);
 assert.throws(()=>decodeHybridRasterBurstRegistered([f(a,800),f(b,800),f(a,800)]),/incompatible/);
});
