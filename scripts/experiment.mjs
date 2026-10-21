import { mkdirSync, writeFileSync } from 'node:fs';
import { buildLayout, rasterize, sampleRegistered, sampleHeaderRegistered, acquireOrientationWithKnownCenter, perturb, estimateCapacity } from '../dist/index.js';

mkdirSync('research/results',{recursive:true});
const now='2026-10-17';
const rows=[];
const layouts = new Map();
const getLayout=(S,p)=> {const key=`${S}:${p}`;if(!layouts.has(key))layouts.set(key,buildLayout(S,p));return layouts.get(key);};
function run(S,palette,pixels,scenario,modifications={},angle=37) {
  const layout=getLayout(S,palette);
  const rad=angle*Math.PI/180;
  const {image,transform}=rasterize(layout,pixels,pixels,{rotation:rad});
  const observed=(scenario==='ideal')?image:perturb(image,modifications);
  const calibrated=sampleRegistered(layout,observed,transform,{calibrate:true});
  const uncalibrated=sampleRegistered(layout,observed,transform,{calibrate:false});
  const header=sampleHeaderRegistered(observed,transform,S);
  const orientation=acquireOrientationWithKnownCenter(observed,transform.cx,transform.cy,(S+9)*transform.a);
  const drift=sampleRegistered(layout,observed,{...transform,cx:transform.cx+0.65,cy:transform.cy-0.65,rotation:transform.rotation+.006},{calibrate:true});
  const row={S,palette,pixels,scenario,pixelsPerHexCircumradius:+transform.a.toFixed(3),
    dataCells:layout.dataCount,netCapacityBytes:estimateCapacity(layout).maximumPayloadBytes,
    validCells:calibrated.total,calibratedErrors:calibrated.errors,uncalibratedErrors:uncalibrated.errors,
    registeredAccuracy:+calibrated.accuracy.toFixed(7),
    registeredSampleWithDriftErrors:drift.errors,
    margin:+calibrated.meanConfidenceMargin.toFixed(2),
    invalidSamples:calibrated.invalidSamples,
    headerStatus:header.status,headerATrackValid:header.trackAValid,headerBTrackValid:header.trackBValid,
    orientation:orientation?.chirality??'FAILED',orientationErrorDegrees:orientation? +(orientation.primaryDegrees-angle).toFixed(3):null,
    perColorErrors:calibrated.perColorErrors,
  };
  rows.push(row);
  console.log(`${String(S).padStart(3)} ${palette.padEnd(10)} ${String(pixels).padStart(4)} ${scenario.padEnd(7)} errors=${String(calibrated.errors).padStart(6)} drift=${String(drift.errors).padStart(6)} header=${header.status} orient=${row.orientation}`);
}
for (const S of [96,112,128,144,160]) {
  for(const palette of ['RELIABLE_4','DENSE_8']) {
    for(const pixels of [512,1024])run(S,palette,pixels,'ideal');
  }
}
for (const S of [112,160]) {
  for(const palette of ['RELIABLE_4','DENSE_8']) {
    run(S,palette,2048,'ideal');
    for(const pixels of [512,1024]) {
      run(S,palette,pixels,'mild',{blur:true,noiseSigma:8,gains:[1,.8,1.2],washout:.2});
    }
    run(S,palette,512,'harsh',{blur:true,noiseSigma:18,gains:[.8,1.1,.7],washout:.35});
  }
}
const report={
  report:'OmniMatrix M1 synthetic registered color-sampling experiment',date:now,protocol:'M0.1 provisional',
  interpretation:'A CELL classification experiment, NOT a payload decoder and NOT a real camera scan; pixel sampler is supplied exact transform.',
  missing:'Auto position/scale localization, homography, capture from physical devices, real RS payload recovery, print tests, JAB/QR same-size benchmarks',
  sampling:'single pixel at ground-truth cell center; palette learned by averaging known reference-cell pixels; coarse 3x3 blur, channel gain, grey veil, Gaussian noise and synthetic orientation',
  driftTest:'same image sampled with assumed center +0.65px X/-0.65px Y and assumed rotation +0.006 rad; calibrated before classification',
  rows,
};
writeFileSync('research/results/M1-SYNTHETIC-RESULTS.json',JSON.stringify(report,null,2));
let csv='S,palette,pixels,scenario,pixelsPerHexCircumradius,dataCells,netCapacityBytes,calibratedErrors,uncalibratedErrors,registeredAccuracy,registeredSampleWithDriftErrors,headerStatus,orientation,orientationErrorDegrees\n';
for(const r of rows) csv += ['S','palette','pixels','scenario','pixelsPerHexCircumradius','dataCells','netCapacityBytes','calibratedErrors','uncalibratedErrors','registeredAccuracy','registeredSampleWithDriftErrors','headerStatus','orientation','orientationErrorDegrees'].map(k=>r[k]).join(',')+'\n';
writeFileSync('research/results/M1-SYNTHETIC-RESULTS.csv',csv);
console.log(`Wrote ${rows.length} experiment observations`);
