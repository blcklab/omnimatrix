/** Reproducible synthetic M7 optical stress benchmark. NOT real-phone evidence. */
import {
  encodeHybridSymbol,rasterizeHybridSymbol,sampleHybridRasterRegistered,
  decodeHybridCells,homographyFromCardinalPoints,idealRasterCardinalPoints,
} from '@blcklab/omnimatrix';
import {chromaticGradient,chromaticImpulseNoise} from '@blcklab/omnimatrix/research';
import {mkdir,writeFile} from 'node:fs/promises';

const S=112,size=1184;
const payload=Uint8Array.from({length:4096},(_,i)=>(Math.imul(i+91,137)+(i>>>2)*41)&255);
const symbol=encodeHybridSymbol(payload,{S,palette:'DENSE_8',ecc:'MEDIUM',mask:1});
const pristine=rasterizeHybridSymbol(symbol,size,size).image;
const registration=homographyFromCardinalPoints(S,idealRasterCardinalPoints(S,size,size));
const modes={
  GLOBAL_MEAN:{},
  GLOBAL_MEDIAN:{sampleAggregation:'MEDIAN'},
  LOCAL_MEAN:{calibrationMode:'LOCAL'},
  LOCAL_MEDIAN:{calibrationMode:'LOCAL',sampleAggregation:'MEDIAN'},
};
const cases={
  pristine,
  spatial_gradient_100:chromaticGradient(pristine,100),
  impulse_02_low_contrast:chromaticImpulseNoise(pristine,.02,.25),
  impulse_08_low_contrast:chromaticImpulseNoise(pristine,.08,.25),
};
const results=[];
for (const [caseName,image] of Object.entries(cases)) {
  for (const [mode,options] of Object.entries(modes)) {
    const row={case:caseName,mode,cellErrors:null,payloadRecovered:false,correctedSymbols:null,
      lowConfidenceCells:null,error:null};
    try {
      const sampled=sampleHybridRasterRegistered(image,registration,S,options);
      row.cellErrors=sampled.cells.reduce((count,c)=>{
        const truth=symbol.layout.byCoordinate.get(`${c.q},${c.r}`);
        return count+Number(truth?.role==='DATA'&&c.colorIndex!==truth.colorIndex);
      },0);
      row.lowConfidenceCells=sampled.diagnostics.lowConfidenceCells;
      try {
        const decoded=decodeHybridCells(sampled);
        row.payloadRecovered=Buffer.from(decoded.payload).equals(Buffer.from(payload));
        row.correctedSymbols=decoded.correctedSymbols;
      } catch (error) {row.error=error instanceof Error?error.message:String(error);}
    }catch(error){row.error=error instanceof Error?error.message:String(error);}
    results.push(row);
    console.log(`${caseName.padEnd(27)} ${mode.padEnd(15)} errors=${String(row.cellErrors).padStart(6)} recovered=${row.payloadRecovered}`);
  }
}
const report={schema:'OMNIMATRIX_M7_SYNTHETIC_CHROMATIC_V1',source:'generated_raster_only',
  realCameraEvidence:false,format:'M0.1',S,size,payloadBytes:payload.length,palette:'DENSE_8',
  description:'Gradient and impulsive-noise stress cases alter ONLY the internal colored field while keeping optical headers, bullseye and perimeter untouched. Scores are specific to these controlled transforms.',
  results};
const output=new URL('../research/results/M7-CHROMATIC-SYNTHETIC-RESULTS.json',import.meta.url);
await mkdir(new URL('../research/results/',import.meta.url),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log('Wrote research/results/M7-CHROMATIC-SYNTHETIC-RESULTS.json');
