import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeHybridSymbol, rasterize, decodeHybridRasterAutomatic,
  detectHybridRaster, buildLayout, OmniMatrixError,
} from '@blcklab/omnimatrix';

const bytes=(size)=>Uint8Array.from({length:size},(_,i)=>(Math.imul(i+73,103)+(i>>>3)*11)&255);
const expectCode=(code)=>(e)=>e instanceof OmniMatrixError && e.code===code;

// Do not pass the source payload, encoded colors or any manual registration points to decoder.
test('M8 detects centered 4 KiB S112 dense symbol and restores all bytes',()=>{
  const payload=bytes(4096);
  const symbol=encodeHybridSymbol(payload,{S:112,ecc:'MEDIUM'});
  const image=rasterize(symbol.layout,1280,1280,{header:symbol.header}).image;
  const result=decodeHybridRasterAutomatic(image);
  assert.deepEqual(result.decoded.payload,payload);
  assert.equal(result.detection.identification.detected?.S,112);
  assert.ok(result.detection.rimScore>.85);
  assert.deepEqual(result.sampling.validHeaderTracks,['A','B']);
});

test('M8 handles translated and rotated 8 KiB S160 symbol without any clicks',()=>{
  const payload=bytes(8192),S=160;
  const symbol=encodeHybridSymbol(payload,{S,ecc:'MEDIUM',mask:1});
  const image=rasterize(symbol.layout,1800,1700,{cx:903,cy:857,a:4.4,rotation:.31,header:symbol.header}).image;
  const result=decodeHybridRasterAutomatic(image,{sizes:[S]});
  assert.equal(result.detection.identification.detected?.S,S);
  assert.deepEqual(result.decoded.payload,payload);
  assert.equal(result.decoded.correctedSymbols,0);
});

test('M8 detects rotated RELIABLE_4 STRONG symbol and preserves configuration',()=>{
  const payload=bytes(420),S=96;
  const symbol=encodeHybridSymbol(payload,{S,palette:'RELIABLE_4',ecc:'STRONG',mask:0});
  const image=rasterize(symbol.layout,1150,1000,{cx:563,cy:503,a:4.25,rotation:1.14,header:symbol.header}).image;
  const result=decodeHybridRasterAutomatic(image,{sizes:[S]});
  assert.deepEqual(result.decoded.payload,payload);
  assert.equal(result.decoded.ecc,'STRONG');
  assert.equal(result.decoded.palette,'RELIABLE_4');
  assert.equal(result.decoded.mask,0);
});

test('M8 acquisition rejects a plain white photo or non-circular background',()=>{
  const white={width:600,height:600,data:new Uint8Array(600*600*3).fill(255)};
  assert.throws(()=>detectHybridRaster(white),expectCode('INVALID_GEOMETRY'));
  const stripe={...white,data:white.data.slice()};
  for(let y=70;y<530;y++) for(let x=100;x<490;x++){
    const i=(y*600+x)*3; stripe.data[i]=0; stripe.data[i+1]=0;stripe.data[i+2]=0;
  }
  assert.throws(()=>detectHybridRaster(stripe),expectCode('INVALID_HEADER'));
});

test('M8 detects orientation without using the known M1 data pattern',()=>{
  const layout=buildLayout(96,'DENSE_8');
  const {image}=rasterize(layout,980,980,{rotation:.47});
  const result=detectHybridRaster(image,{sizes:[96]});
  assert.equal(result.identification.detected?.S,96);
  // This is not a real payload barcode: an independent binary decode must refuse it.
  assert.throws(()=>decodeHybridRasterAutomatic(image,{sizes:[96]}));
});

test('M8 rejects invalid input dimensions, buffers and detection options',()=>{
  const image={width:2,height:2,data:new Uint8Array(12)};
  assert.throws(()=>detectHybridRaster({...image,data:new Uint8Array(11)}),expectCode('INVALID_INPUT'));
  assert.throws(()=>detectHybridRaster(image,{minimumDiameterPx:12}),expectCode('INVALID_INPUT'));
});
