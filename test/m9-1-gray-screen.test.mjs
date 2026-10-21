import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeHybridSymbol, rasterize, decodeHybridRasterAutomatic, detectHybridRaster, OmniMatrixError } from '@blcklab/omnimatrix';

function screenshotLikeScene(payload) {
  const symbol=encodeHybridSymbol(payload,{S:96,ecc:'MEDIUM'});
  const scene=rasterize(symbol.layout,1100,840,{header:symbol.header,cx:550,cy:420,a:3.35}).image;
  // Camera photographs of LCD screens often have a gray, slightly uneven
  // background: these non-white pixels MUST NOT be treated as black rim ink.
  for(let y=0;y<scene.height;y++)for(let x=0;x<scene.width;x++){
    const k=(y*scene.width+x)*3;
    if(scene.data[k]>245 && scene.data[k+1]>245 && scene.data[k+2]>245){
      const n=(x*17+y*11)%13;
      scene.data[k]=155+n;
      scene.data[k+1]=151+n;
      scene.data[k+2]=149+n;
    }
  }
  return scene;
}

test('M9.1 gray screen background does not turn 4:3 photo into elliptical rim',()=>{
  const original=Uint8Array.from({length:78},(_,i)=>(i*93+37)&255);
  const photo=screenshotLikeScene(original);
  const result=decodeHybridRasterAutomatic(photo,{sizes:[96]});
  assert.deepEqual(result.decoded.payload,original);
  assert.equal(result.detection.identification.detected?.S,96);
  assert.ok(result.detection.rimRadiusPx>200);
  assert.equal(photo.width,1100);
  assert.equal(photo.height,840);
});

test('M9.1 gray background without a symbol must still reject',()=>{
  const scene={width:1100,height:840,data:new Uint8Array(1100*840*3)};
  for(let i=0;i<scene.data.length;i+=3){scene.data[i]=157;scene.data[i+1]=153;scene.data[i+2]=150;}
  assert.throws(()=>detectHybridRaster(scene),(e)=>e instanceof OmniMatrixError && e.code==='INVALID_GEOMETRY');
});
