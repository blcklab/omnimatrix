import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeHybridSymbol, rasterize, decodeHybridRasterAutomatic,
  cropRaster, centeredRegions, decodeHybridRasterRegions, OmniMatrixError,
} from '@blcklab/omnimatrix';

function payload(length) {return Uint8Array.from({length},(_,i)=>(i * 47 + (i>>>2)*11) & 255);}
function canvas(width,height) {return {width,height,data:new Uint8Array(width*height*3).fill(255)};}
function paste(dest,source,x,y) {
  for(let row=0;row<source.height;row++) {
    dest.data.set(source.data.subarray(row*source.width*3,(row+1)*source.width*3), ((row+y)*dest.width+x)*3);
  }
}
function blot(img,x,y,w,h) {
  for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++){
    const pos=(j*img.width+i)*3;img.data[pos]=20;img.data[pos+1]=30;img.data[pos+2]=40;
  }
}

test('M9 central region fallback recovers binary content despite dark peripheral clutter',()=>{
  const original=payload(1024);
  const symbol=encodeHybridSymbol(original,{S:96,ecc:'MEDIUM'});
  const image=rasterize(symbol.layout,800,800,{header:symbol.header}).image;
  const scene=canvas(1500,1500);
  paste(scene,image,350,350);
  blot(scene,10,10,90,105);blot(scene,1390,1360,100,120);
  assert.throws(()=>decodeHybridRasterAutomatic(scene,{sizes:[96]}));
  const result=decodeHybridRasterRegions(scene,{sizes:[96],regions:centeredRegions(1500,1500)});
  assert.deepEqual(result.decoded.payload,original);
  assert.equal(result.regionAttempts,2);
  assert.deepEqual(result.fullImageSize,{width:1500,height:1500});
  assert.ok(result.usedRegion.width<1500);
  assert.deepEqual(result.sampling.validHeaderTracks,['A','B']);
});

test('M9 full-size original symbol still decodes on first attempt',()=>{
  const original=payload(240);
  const symbol=encodeHybridSymbol(original,{S:96});
  const scene=rasterize(symbol.layout,820,820,{header:symbol.header}).image;
  const result=decodeHybridRasterRegions(scene,{sizes:[96],regions:centeredRegions(scene.width,scene.height)});
  assert.deepEqual(result.decoded.payload,original);
  assert.equal(result.regionAttempts,1);
  assert.deepEqual(result.usedRegion,{x:0,y:0,width:820,height:820});
});

test('M9 pixel crop preserves RGB bytes and rejects malformed rectangles',()=>{
  const scene={width:3,height:2,data:Uint8Array.from({length:18},(_,i)=>i)};
  assert.deepEqual(cropRaster(scene,{x:1,y:0,width:2,height:2}).data,Uint8Array.of(3,4,5,6,7,8,12,13,14,15,16,17));
  for(const region of [{x:-1,y:0,width:2,height:2},{x:0,y:0,width:4,height:2},{x:.1,y:0,width:2,height:2},{x:0,y:0,width:0,height:2}]) {
    assert.throws(()=>cropRaster(scene,region),(e)=>e instanceof OmniMatrixError&&e.code==='INVALID_INPUT');
  }
  assert.throws(()=>centeredRegions(0,900));
  assert.throws(()=>decodeHybridRasterRegions(scene,{includeFullImage:false}));
  assert.throws(()=>decodeHybridRasterRegions(scene,{regions:[...Array(4)].map(()=>({x:0,y:0,width:1,height:1}))}));
});

test('M9 never accepts a cluttered scene without an encoded symbol',()=>{
  const scene=canvas(600,600);blot(scene,40,20,50,60);blot(scene,470,480,90,100);
  assert.throws(()=>decodeHybridRasterRegions(scene,{sizes:[96],regions:centeredRegions(600,600)}));
});
