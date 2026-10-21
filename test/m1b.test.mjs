import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLayout, rasterize, pixelAt, rgbaToRaster, homographyFromCardinalPoints,
  mapProjective, measureProjective, visibleProjection, makeHeader, idealRasterCardinalPoints,
} from '../dist/index.js';

function knownProjective() {
  // Independent synthetic camera plane transform with skew, rotation & mild perspective.
  const h=[3.38,.31,491,-.22,3.16,492,.00051,-.00041,1];
  return (x,y) => {
    const w=h[6]*x+h[7]*y+1;
    return {x:(h[0]*x+h[1]*y+h[2])/w,y:(h[3]*x+h[4]*y+h[5])/w};
  };
}
function cardinal(S,fn){const r=S+9;return [[r,0],[0,r],[-r,0],[0,-r]].map(([x,y])=>fn(x,y));}

function inverse(H) {
  const [a,b,c,d,e,f,g,h,i]=H;
  const adj=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
  const det=a*adj[0]+b*adj[3]+c*adj[6];
  return adj.map(x=>x/det);
}
function apply(H,x,y) {
  const w=H[6]*x+H[7]*y+H[8];
  return {x:(H[0]*x+H[1]*y+H[2])/w,y:(H[3]*x+H[4]*y+H[5])/w};
}
function warpOriginal(layout,reg,width=1050,height=1050) {
  // Indep. reverse warp of the existing synthetic image, not a real camera capture.
  const src=rasterize(layout,1152,1152);
  const inv=inverse(reg.h),bytes=new Uint8Array(width*height*3);
  bytes.fill(255);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const s=apply(inv,x+.5,y+.5);
    const point={x:src.transform.cx+s.x*src.transform.a,y:src.transform.cy+s.y*src.transform.a};
    const rgb=pixelAt(src.image,point.x,point.y);
    if(!rgb)continue;
    const index=(y*width+x)*3;
    bytes[index]=rgb.r;bytes[index+1]=rgb.g;bytes[index+2]=rgb.b;
  }
  return {width,height,data:bytes};
}

test('four perimeter points reconstruct projective mapping without encoder-side pose',()=>{
  const S=96,fn=knownProjective(),anchors=cardinal(S,fn);
  const reg=homographyFromCardinalPoints(S,anchors);
  for(const v of [[0,0],[25,-50],[-62,12],[79,32],[100,-5]]) {
    const expected=fn(...v),actual=mapProjective(reg,...v);
    assert.ok(actual&&Math.hypot(actual.x-expected.x,actual.y-expected.y)<1e-7);
  }
  assert.ok(reg.conditionCheck>0);
});

test('reject collinear, reverse winding and bad annotations',()=>{
  const S=96,fn=knownProjective(),points=cardinal(S,fn);
  assert.throws(()=>homographyFromCardinalPoints(S,[points[0],points[3],points[2],points[1]]),/clockwise|non-overlapping/);
  assert.throws(()=>homographyFromCardinalPoints(S,[{x:0,y:0},{x:1,y:1},{x:2,y:2},{x:3,y:3}]),/Degenerate/);
  assert.throws(()=>homographyFromCardinalPoints(S,[{x:NaN,y:0},...points.slice(1)]),/Non-finite/);
});

test('RGBA conversion composites alpha on white and rejects wrong dimensions',()=>{
  const rgba=new Uint8ClampedArray([10,20,30,255,50,100,150,0,0,80,160,128]);
  const result=rgbaToRaster(3,1,rgba);
  assert.deepEqual([...result.data.slice(0,6)],[10,20,30,255,255,255]);
  assert.deepEqual([...result.data.slice(6,9)],[127,167,207]);
  assert.throws(()=>rgbaToRaster(3,1,rgba.subarray(0,8)),/length mismatch/);
});

test('synthetic perspective-warped PNG-equivalent pixel data is measurable with manual registration',()=>{
  for(const palette of ['DENSE_8','RELIABLE_4']) {
    const layout=buildLayout(96,palette);
    const reg=homographyFromCardinalPoints(layout.S,cardinal(layout.S,knownProjective()));
    const image=warpOriginal(layout,reg);
    const r=measureProjective(layout,image,reg);
    assert.equal(r.sample.total,layout.dataCount);
    assert.equal(r.sample.calibrationCount,layout.calibrationCount);
    assert.equal(r.header.status,'OK');
    assert.equal(r.header.hexA,Buffer.from(makeHeader({S:96,palette:palette==='DENSE_8'?1:0})).toString('hex'));
    assert.ok(r.sample.errors/layout.dataCount<.01,`color errors: ${r.sample.errors}/${layout.dataCount}`);
    assert.ok(visibleProjection(layout,reg,50).length<=50);
  }
});

test('wrong annotation is detectably harmful',()=>{
  const layout=buildLayout(96,'DENSE_8');
  const anchors=cardinal(96,knownProjective());
  const good=homographyFromCardinalPoints(96,anchors);
  const image=warpOriginal(layout,good);
  const bad=homographyFromCardinalPoints(96,anchors.map(p=>({x:p.x+17,y:p.y+17})));
  const accurate=measureProjective(layout,image,good).sample;
  const wrong=measureProjective(layout,image,bad).sample;
  assert.ok(wrong.errors>accurate.errors+100);
});


test('ideal built-in S96 raster fixture requires no manual point clicks',()=>{
  const layout=buildLayout(96,'DENSE_8');
  const {image}=rasterize(layout,840,840);
  const landmarks=idealRasterCardinalPoints(96,840,840);
  assert.ok(Math.abs(landmarks[0].x-820.909090909)<1e-6);
  const reg=homographyFromCardinalPoints(96,landmarks);
  const r=measureProjective(layout,image,reg);
  assert.deepEqual(r.projectedCenter,{x:420,y:420});
  assert.equal(r.sample.total,10650);
  assert.equal(r.sample.errors,0);
  assert.equal(r.header.status,'OK');
  assert.equal(r.header.hexA,r.header.hexB);
});

test('manual landmarks from M1b field report reproduce registration mismatch',()=>{
  const layout=buildLayout(96,'DENSE_8');
  const {image}=rasterize(layout,840,840);
  const reported=[{x:804.5625,y:413.875},{x:421.3125,y:822.5},
    {x:13.5625,y:413.875},{x:411.6875,y:12.25}];
  const r=measureProjective(layout,image,homographyFromCardinalPoints(96,reported));
  assert.equal(r.sample.errors,8460);
  assert.equal(r.header.status,'INVALID_HEADER');
});
