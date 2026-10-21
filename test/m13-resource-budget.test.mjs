import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateDecodeWorkload,encodeHybridSymbol,rasterizeHybridSymbol,decodeHybridRasterAutomatic} from '../dist/index.js';
test('M13 bounded resource estimator returns correct sizes',()=>{
  const single=validateDecodeWorkload({width:1800,height:1200});
  assert.deepEqual(single,{pixelsPerFrame:2160000,frames:1,sourceBytes:8640000,rgbBytes:6480000,estimatedBytes:15120000});
  const burst=validateDecodeWorkload({width:1800,height:1200,frames:3});
  assert.equal(burst.estimatedBytes,single.estimatedBytes*3);
});
test('M13 preflight rejects oversized, zero, fractional and invalid bursts',()=>{
  for (const input of [
    {width:0,height:1080},{width:3200,height:2400,frames:5},
    {width:25000,height:1000},{width:1.1,height:1080},
    {width:100,height:100,frames:2},{width:100,height:100,channels:2},
  ]) assert.throws(()=>validateDecodeWorkload(input),RangeError);
  assert.throws(()=>validateDecodeWorkload({width:1800,height:1200,frames:3}, {maxEstimatedBytes:1000}),RangeError);
});
test('M13 guard cannot alter 4 KiB optical recovery',()=>{
  const payload=Uint8Array.from({length:4096},(_,i)=>(i*73+11)&255);
  const symbol=encodeHybridSymbol(payload,{S:112});
  const {image}=rasterizeHybridSymbol(symbol,1100,1100);
  validateDecodeWorkload({width:image.width,height:image.height,channels:3});
  assert.deepEqual(decodeHybridRasterAutomatic(image).decoded.payload,payload);
});
