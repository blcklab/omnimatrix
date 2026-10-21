/** Aggregates browser-exported M1b registered test-pattern measurements.
 * Does not pretend images are verified physical captures, or binary payloads recovered.
 */
import { readFileSync, writeFileSync } from 'node:fs';
const args=process.argv.slice(2);
const files=[];let outPath=null;
for(let i=0;i<args.length;i++){
  if(args[i]==='--output'){outPath=args[++i];if(!outPath)throw new Error('Missing --output file');}
  else if(args[i].startsWith('--'))throw new Error('Unknown option: '+args[i]);
  else files.push(args[i]);
}
if(!files.length){console.error('Usage: npm run capture:report -- capture1.json capture2.json ... [--output summary.json]');process.exit(1);}
const rows=[];
for(const file of files) {
  const m=JSON.parse(readFileSync(file,'utf8'));
  if(m.schema!=='OMNIMATRIX_M1B_MEASUREMENT_V1'||!m.sample||!m.header)throw new Error(`Not an M1b measurement: ${file}`);
  if(!Number.isInteger(m.sample.total)||!Number.isInteger(m.sample.errors)||m.sample.errors<0||m.sample.total<1||m.sample.errors>m.sample.total)throw new Error(`Invalid sample metrics: ${file}`);
  if(!['DENSE_8','RELIABLE_4'].includes(m.palette))throw new Error(`Invalid palette: ${file}`);
  const expected= m.expectedDataCells;
  if(!Number.isInteger(expected)||expected<1||m.sample.total+m.sample.invalidSamples!==expected)throw new Error(`Incomplete or inconsistent cell totals: ${file}`);
  rows.push({file,origin:m.source??'unknown',device:m.device??'',media:m.media??'unknown',tag:m.tag??'',S:m.S,palette:m.palette,classified:m.sample.total,cellErrors:m.sample.errors,
    cellErrorRate:m.sample.errors/m.sample.total,invalid:m.sample.invalidSamples,headerStatus:m.header.status,
    centerErrorPx:m.centerErrorPx??null,imageWidth:m.imageWidth,imageHeight:m.imageHeight,diameterMm:m.diameterMm??null,distanceCm:m.distanceCm??null});
}
const groups={};
for(const row of rows){const k=`${row.S}/${row.palette}/${row.media}`;const g=groups[k]??={samples:0,classified:0,errors:0,invalid:0,goodHeaders:0};g.samples++;g.classified+=row.classified;g.errors+=row.cellErrors;g.invalid+=row.invalid;g.goodHeaders+=Number(row.headerStatus==='OK');}
for(const g of Object.values(groups))g.cellErrorRate=g.classified?g.errors/g.classified:null;
const output={schema:'OMNIMATRIX_M1B_AGGREGATE_V1',notes:'Manually registered known pattern. No automatic detection, validated physical source, Reed–Solomon or payload recovery.',totalCaptures:rows.length,groups,rows};
if(outPath)writeFileSync(outPath,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
