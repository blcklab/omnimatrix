import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeHybridSymbol,rasterizeHybridSymbol,idealRasterCardinalPoints,
  homographyFromCardinalPoints,sampleHybridRasterRegistered,
  decodeHybridRasterRegistered,decodeHybridRasterAssisted,decodeHybridCells,OmniMatrixError,
} from '@blcklab/omnimatrix';
import {chromaticGradient,chromaticImpulseNoise} from '@blcklab/omnimatrix/research';

const S=112,size=1184;
const original=Uint8Array.from({length:4096},(_,i)=>(Math.imul(i+91,137)+(i>>>2)*41)&255);
const symbol=encodeHybridSymbol(original,{S,palette:'DENSE_8',ecc:'MEDIUM',mask:1});
const image=rasterizeHybridSymbol(symbol,size,size).image;
const points=idealRasterCardinalPoints(S,size,size);
const reg=homographyFromCardinalPoints(S,points);
function errors(sampled){return sampled.cells.reduce((n,c)=>{
  const expected=symbol.layout.byCoordinate.get(`${c.q},${c.r}`);
  return n+Number(expected?.role==='DATA'&&expected.colorIndex!==c.colorIndex);
},0);}

test('M7 baseline defaults remain unchanged and diagnostics contain safe confidence fields',()=>{
  const res=decodeHybridRasterRegistered(image,reg,S);
  assert.deepEqual(res.decoded.payload,original);
  assert.equal(res.sampling.sampleAggregation,'MEAN');
  assert.equal(res.sampling.calibrationMode,'GLOBAL');
  assert.equal(res.sampling.lowConfidenceCells,0);
  assert.ok(res.sampling.minimumPaletteSeparation>20);
  assert.ok(res.sampling.dataMinimumConfidence>=0);
  assert.deepEqual(res.sampling.validHeaderTracks,['A','B']);
});

test('M7 LOCAL uses reserved spatial pilots to recover from a controlled uneven-color raster',()=>{
  const transformed=chromaticGradient(image,100);
  const baseline=sampleHybridRasterRegistered(transformed,reg,S);
  assert.ok(errors(baseline)>100,'Global calibration must detectably degrade on this stress fixture');
  const improved=sampleHybridRasterRegistered(transformed,reg,S,{calibrationMode:'LOCAL'});
  assert.equal(errors(improved),0);
  assert.deepEqual(decodeHybridCells(improved).payload,original);
  assert.equal(improved.diagnostics.calibrationMode,'LOCAL');
});

test('M7 MEDIAN resists impulse outliers while preserving the 4 KiB payload',()=>{
  const noisy=chromaticImpulseNoise(image,.02,.25);
  const baseline=sampleHybridRasterRegistered(noisy,reg,S);
  assert.ok(errors(baseline)>100);
  const robust=sampleHybridRasterRegistered(noisy,reg,S,{sampleAggregation:'MEDIAN'});
  assert.ok(errors(robust)<errors(baseline)/10);
  assert.deepEqual(decodeHybridCells(robust).payload,original);
  assert.equal(robust.diagnostics.sampleAggregation,'MEDIAN');
});

test('M7 alternatives work through assisted camera-style API without encoder cells',()=>{
  const distorted=chromaticGradient(image,100);
  const result=decodeHybridRasterAssisted(distorted,points,{refine:false,sizes:[112],calibrationMode:'LOCAL',sampleAggregation:'MEDIAN'});
  assert.deepEqual(result.decoded.payload,original);
  assert.equal(result.identification.detected?.S,112);
  assert.equal(result.sampling.calibrationMode,'LOCAL');
});

test('M7 refuses unsupported sampling options early',()=>{
  for(const options of [
    {sampleAggregation:'RANDOM'},
    {calibrationMode:'INFERRED'},
    {confidenceWarningThreshold:-1},
    {confidenceWarningThreshold:Infinity},
    {confidenceWarningThreshold:999},
  ]){
    assert.throws(()=>sampleHybridRasterRegistered(image,reg,S,options),e=>e instanceof OmniMatrixError&&e.code==='INVALID_INPUT');
  }
});

test('M7 stress transforms are deterministic, preserve inputs and reject invalid options',()=>{
  const sample={width:3,height:3,data:Uint8Array.from({length:27},(_,i)=>i*9)};
  const saved=sample.data.slice();
  const a=chromaticImpulseNoise(sample,.1,.25,123);
  const b=chromaticImpulseNoise(sample,.1,.25,123);
  assert.deepEqual(a,b);
  assert.deepEqual(sample.data,saved);
  assert.notStrictEqual(a.data,sample.data);
  assert.throws(()=>chromaticGradient(sample,Infinity));
  assert.throws(()=>chromaticImpulseNoise(sample,1.1));
  assert.throws(()=>chromaticImpulseNoise({...sample,data:new Uint8Array(1)}));
});
