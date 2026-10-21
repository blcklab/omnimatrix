import {writeFileSync} from 'node:fs';
import {encodeHybridSymbol,rasterizeHybridSymbol,assessCaptureQuality,decodeHybridRasterAutomatic} from '../dist/index.js';
const payload=Uint8Array.from({length:4096},(_,i)=>(Math.imul(i,79)+19)&255);
const {image}=rasterizeHybridSymbol(encodeHybridSymbol(payload,{S:112}),1024,1024);
function blur(input){
 const result={...input,data:new Uint8Array(input.data.length)};
 for(let y=0;y<input.height;y++)for(let x=0;x<input.width;x++){
  for(let c=0;c<3;c++){
   let sum=0,n=0;
   for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const a=Math.min(input.width-1,Math.max(0,x+dx));const b=Math.min(input.height-1,Math.max(0,y+dy));
    sum+=input.data[(b*input.width+a)*3+c];n++;
   }
   result.data[(y*input.width+x)*3+c]=Math.round(sum/n);
  }
 } return result;
}
const blurred=blur(image);
const checks=[['generated-clean',image],['synthetic-5x5-blur',blurred]];
const entries=[];
for(const [name,raster] of checks){
 const q=assessCaptureQuality(raster);
 let recovered=false,errorCode=null;
 try{const d=decodeHybridRasterAutomatic(raster); recovered=Buffer.from(d.decoded.payload).equals(Buffer.from(payload));}
 catch(err){errorCode=err.code??'DECODE_FAILED';}
 entries.push({name,detailRms:q.detailRms,lumaStdDev:q.lumaStdDev,meanLuma:q.meanLuma,recovered,errorCode});
}
const out={schema:'OMNIMATRIX_M12_SYNTHETIC_QUALITY_V1',notes:'Not a phone-camera benchmark. Quality metrics may rank moiré as high-detail. No physical trials included.',samples:entries};
const path=process.argv[2];if(path)writeFileSync(path,JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
