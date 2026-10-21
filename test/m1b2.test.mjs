import test from 'node:test';
import assert from 'node:assert/strict';
import {
 buildLayout, rasterize, idealRasterCardinalPoints, identifyAssistedHeader,
 measureAssisted
} from '../dist/index.js';

test('a wrong S112 dropdown is corrected to an S96 DENSE_8 reference using pixel-derived header',()=>{
 const {image}=rasterize(buildLayout(96,'DENSE_8'),840,840);
 const pts=idealRasterCardinalPoints(96,840,840);
 const detected=identifyAssistedHeader(image,pts);
 assert.equal(detected.status,'OK');
 assert.equal(detected.detected.S,96);
 assert.equal(detected.detected.palette,1);
 const m=measureAssisted(image,pts,112,'RELIABLE_4',{refine:false});
 assert.equal(m.effectiveS,96);
 assert.equal(m.effectivePalette,'DENSE_8');
 assert.equal(m.expectedDataCells,10650);
 assert.equal(m.result.sample.errors,0);
 assert.equal(m.result.header.trackAValid,true);
 assert.equal(m.result.header.trackBValid,true);
});

test('fine registration recovers deliberately shifted cardinal points without reading expected DATA colors',()=>{
 const {image}=rasterize(buildLayout(96,'DENSE_8'),840,840);
 const points=idealRasterCardinalPoints(96,840,840).map((p,i)=>({x:p.x+2*[1,-1,.5,-.5][i],y:p.y+2*[-.5,1,1,-1][i]}));
 const baseline=measureAssisted(image,points,96,'DENSE_8',{refine:false});
 const optimized=measureAssisted(image,points,96,'DENSE_8',{refine:true});
 assert.equal(optimized.identification.status,'OK');
 assert.ok(optimized.finalOpticalScore>=optimized.initialOpticalScore);
 assert.ok(optimized.result.sample.errors<baseline.result.sample.errors,`${optimized.result.sample.errors} not less than ${baseline.result.sample.errors}`);
 assert.equal(optimized.result.header.status,'OK');
});

test('missing valid header reports uncertainty instead of inventing S/palette',()=>{
 const white={width:840,height:840,data:new Uint8Array(840*840*3).fill(255)};
 const pts=idealRasterCardinalPoints(96,840,840);
 const m=measureAssisted(white,pts,96,'RELIABLE_4');
 assert.equal(m.identification.status,'NO_HEADER');
 assert.equal(m.identification.detected,null);
 assert.equal(m.effectiveS,96);
 assert.equal(m.effectivePalette,'RELIABLE_4');
 assert.equal(m.refined,false);
});

test('assisted size search does not mutate user-selected points',()=>{
 const {image}=rasterize(buildLayout(96,'DENSE_8'),840,840);
 const points=idealRasterCardinalPoints(96,840,840);
 const snapshot=JSON.stringify(points);
 measureAssisted(image,points,112,'DENSE_8',{refine:true});
 assert.equal(JSON.stringify(points),snapshot);
});

test('RELIABLE_4 header identifies a different S and palette correctly',()=>{
 const {image}=rasterize(buildLayout(112,'RELIABLE_4'),920,920);
 const points=idealRasterCardinalPoints(112,920,920);
 const m=measureAssisted(image,points,96,'DENSE_8',{refine:false});
 assert.equal(m.identification.status,'OK');
 assert.equal(m.effectiveS,112);
 assert.equal(m.effectivePalette,'RELIABLE_4');
 assert.equal(m.result.sample.errors,0);
});

test('bounded refinement rejects unsafe shifts',()=>{
 const {image}=rasterize(buildLayout(96,'DENSE_8'),840,840);
 const points=idealRasterCardinalPoints(96,840,840);
 assert.throws(()=>measureAssisted(image,points,96,'DENSE_8',{maxShiftPx:50}),/refinement bound/);
});
