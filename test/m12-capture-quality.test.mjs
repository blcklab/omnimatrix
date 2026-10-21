import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assessCaptureQuality,selectCaptureFrames} from '../dist/index.js';
function img(type,w=240,h=240,channels=3){
 const data=new Uint8Array(w*h*channels);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const v=type==='flat'?160:type==='stripes'?(x%12<6?20:230):type==='gray'?(x%12<6?102:210):type==='white'?255:0;
  const p=(y*w+x)*channels;data[p]=data[p+1]=data[p+2]=v;
  if(channels===4)data[p+3]=255;
 }
 return {width:w,height:h,channels,data};
}
test('M12 metrics bounded and distinguish flat versus stripes',()=>{
 const flat=assessCaptureQuality(img('flat')), stripes=assessCaptureQuality(img('stripes'));
 assert.ok(stripes.detailRms>flat.detailRms);
 assert.ok(stripes.lumaStdDev>flat.lumaStdDev);
 for(const c of [flat,stripes])for(const k of ['meanLuma','lumaStdDev','detailRms','relativeRank','darkFraction','brightFraction'])assert.ok(Number.isFinite(c[k]));
 assert.equal(stripes.width,240); assert.ok(stripes.samples>0);
});
test('M12 RGBA and RGB have identical measurements for opaque data',()=>{
 const a=assessCaptureQuality(img('gray',256,192,3));const b=assessCaptureQuality(img('gray',256,192,4));
 assert.deepEqual(a,b);
});
test('M12 rejects invalid buffers, unsafe dimensions, and choices',()=>{
 for(const value of [{width:16,height:16,data:new Uint8Array(1)}, {width:0,height:5,data:new Uint8Array(0)}, {width:10,height:10,channels:9,data:new Uint8Array(300)}])assert.throws(()=>assessCaptureQuality(value),RangeError);
 assert.throws(()=>selectCaptureFrames([1],()=>assessCaptureQuality(img('flat')),3),RangeError);
});
test('M12 frame ranking is deterministic and stable',()=>{
 const arr=[img('flat'),img('stripes'),img('gray'),img('flat'),img('stripes')];
 assert.deepEqual(selectCaptureFrames(arr,assessCaptureQuality,3),[1,2,4]);
});
test('M12 warnings are advisory, never reject or modify buffers',()=>{
 const dark=img('black'), bright=img('white');
 const copy=dark.data.slice();const metric=assessCaptureQuality(dark);
 assert.match(metric.cautions.join(' '),/dark/i);
 assert.ok(assessCaptureQuality(bright).brightFraction>.8);
 assert.deepEqual(dark.data,copy);
});
