import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeHybridSymbol, rasterizeHybridSymbol, decodeHybridRasterRegistered,
  decodeHybridRasterAssisted, sampleHybridRasterRegistered, decodeHybridCells,
  homographyFromCardinalPoints, idealRasterCardinalPoints, readHeader,
  rasterize, OmniMatrixError, rgbaToRaster,
} from '@blcklab/omnimatrix';

const data=(n,seed=11)=>Uint8Array.from({length:n},(_,i)=>(Math.imul(i+seed,137)+(i>>>2)*17)&255);
const points=(S,size)=>idealRasterCardinalPoints(S,size,size);
const exact=(S,size)=>homographyFromCardinalPoints(S,points(S,size));
const err=(code)=>(e)=> e instanceof OmniMatrixError && e.code===code;

// No encoder layout or payload bytes are passed into any of the optical decoders.
test('M6 decodes arbitrary binary payload from S112 rendered pixels (4 KiB)',()=>{
  const original=data(4096),symbol=encodeHybridSymbol(original,{S:112,ecc:'MEDIUM',mask:1});
  const {image}=rasterizeHybridSymbol(symbol,1280,1280);
  const samples=sampleHybridRasterRegistered(image,exact(112,1280),112);
  assert.equal(samples.S,112);assert.equal(samples.palette,'DENSE_8');
  assert.equal(samples.diagnostics.dataSamples,14472);
  assert.deepEqual(samples.diagnostics.validHeaderTracks,['A','B']);
  assert.deepEqual(decodeHybridCells(samples).payload,original);
  const result=decodeHybridRasterRegistered(image,exact(112,1280),112);
  assert.deepEqual(result.decoded.payload,original);
  assert.equal(result.decoded.correctedSymbols,0);
});

test('M6 header identifies S160/DENSE_8 and recovers 8 KiB from image pixels',()=>{
  const original=data(8192),symbol=encodeHybridSymbol(original,{S:160,ecc:'MEDIUM'});
  const {image}=rasterizeHybridSymbol(symbol,1664,1664);
  const result=decodeHybridRasterAssisted(image,points(160,1664),{sizes:[96,112,160],refine:false});
  assert.equal(result.identification.detected?.S,160);
  assert.equal(result.decoded.S,160);
  assert.deepEqual(result.decoded.payload,original);
  assert.equal(result.decoded.correctedSymbols,0);
});

test('M6 no hidden synthetic pattern: rotate/translate and decode STRONG RELIABLE_4 from pixels',()=>{
  const original=data(401,67),symbol=encodeHybridSymbol(original,{S:96,palette:'RELIABLE_4',ecc:'STRONG',mask:0});
  const size=1100,angle=.23,scale=size/(2*(96+14));
  const cx=555,cy=540;
  const {image}=rasterize(symbol.layout,size,size,{cx,cy,rotation:angle,header:symbol.header});
  const R=105;
  const transform=(x,y)=>({x:cx+scale*(x*Math.cos(angle)-y*Math.sin(angle)),y:cy+scale*(x*Math.sin(angle)+y*Math.cos(angle))});
  const anchors=[transform(R,0),transform(0,R),transform(-R,0),transform(0,-R)];
  const result=decodeHybridRasterAssisted(image,anchors,{sizes:[96],refine:false});
  assert.deepEqual(result.decoded.payload,original);
  assert.equal(result.decoded.ecc,'STRONG');assert.equal(result.decoded.mask,0);
  assert.equal(result.decoded.palette,'RELIABLE_4');
});

test('M6 corrected optical color errors survive Reed-Solomon',()=>{
  const original=data(500),symbol=encodeHybridSymbol(original,{S:64,ecc:'MEDIUM'});
  const cells=symbol.layout.cells.map(c=>({...c}));
  const dataCells=cells.filter(c=>c.role==='DATA');
  for(const offset of [43,207,654,1200,1750,2270,2800,4011]) dataCells[offset].colorIndex ^= 1;
  const layout={...symbol.layout,cells,byCoordinate:new Map(cells.map(c=>[`${c.q},${c.r}`,c]))};
  const {image}=rasterize(layout,900,900,{header:symbol.header});
  const result=decodeHybridRasterRegistered(image,exact(64,900),64);
  assert.ok(result.decoded.correctedSymbols>0);
  assert.deepEqual(result.decoded.payload,original);
});

test('M6 validates image memory, geometry, missing pixels and calibration',()=>{
  const symbol=encodeHybridSymbol('Some payload',{S:64});
  const {image}=rasterizeHybridSymbol(symbol,800,800);
  const registration=exact(64,800);
  assert.throws(()=>sampleHybridRasterRegistered({width:1,height:1,data:new Uint8Array(2)},registration,64),err('INVALID_INPUT'));
  assert.throws(()=>sampleHybridRasterRegistered(image,registration,64,{samplesPerCell:3}),err('INVALID_INPUT'));
  assert.throws(()=>sampleHybridRasterRegistered(image,registration,64,{minimumAlignmentFraction:1.01}),err('INVALID_INPUT'));
  assert.throws(()=>sampleHybridRasterRegistered(image,registration,80),err('INVALID_HEADER'));
  const blank={...image,data:new Uint8Array(image.data.length).fill(255)};
  assert.throws(()=>decodeHybridRasterRegistered(blank,registration,64),err('INVALID_HEADER'));
  const rgba=new Uint8Array(image.width*image.height*4);
  for(let j=0,i=0;i<image.data.length;i+=3,j+=4){rgba[j]=image.data[i];rgba[j+1]=image.data[i+1];rgba[j+2]=image.data[i+2];rgba[j+3]=255;}
  const normalized=rgbaToRaster(image.width,image.height,rgba);
  assert.deepEqual(decodeHybridRasterRegistered(normalized,registration,64).decoded.payload,new TextEncoder().encode('Some payload'));
});

test('M6 refuses wrong optical protocol and misleading known synthetic research data',()=>{
  const payload=encodeHybridSymbol('This is payload',{S:64});
  const {image}=rasterizeHybridSymbol(payload,800,800);
  const read=decodeHybridRasterAssisted(image,points(64,800),{sizes:[64],refine:false});
  assert.equal(read.identification.status,'OK');
  assert.equal(read.sampling.validHeaderTracks.length,2);
  assert.equal(read.initialOpticalScore,read.finalOpticalScore);
  assert.deepEqual(read.decoded.payload,new TextEncoder().encode('This is payload'));
});

test('M6 one damaged header track is tolerated; two tracks not silently invented',()=>{
  const original=data(90),symbol=encodeHybridSymbol(original,{S:64});
  const size=900,{image}=rasterizeHybridSymbol(symbol,size,size);
  const pixels=image.data.slice();
  const scale=size/(2*(64+14));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const r=Math.hypot(x+.5-size/2,y+.5-size/2)/scale;
    if(r>64+2&&r<64+4){const i=(y*size+x)*3;pixels[i]=255;pixels[i+1]=255;pixels[i+2]=255;}
  }
  const affected={...image,data:pixels};
  const result=decodeHybridRasterRegistered(affected,exact(64,size),64);
  assert.deepEqual(result.decoded.payload,original);
  assert.deepEqual(result.sampling.validHeaderTracks,['B']);
});

test('M6 refuses collapsed palette calibration despite a valid optical header',()=>{
  const symbol=encodeHybridSymbol('a proper color payload',{S:64});
  const size=840,{image}=rasterizeHybridSymbol(symbol,size,size);
  const modified=image.data.slice(),scale=size/(2*(64+14));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const r=Math.hypot(x+.5-size/2,y+.5-size/2)/scale;
    if(r>8.2 && r<64.9){const i=(y*size+x)*3;modified[i]=130;modified[i+1]=130;modified[i+2]=130;}
  }
  assert.throws(()=>sampleHybridRasterRegistered({...image,data:modified},exact(64,size),64),err('INVALID_GEOMETRY'));
});
