import { writeFileSync } from 'node:fs';
import { encodeHybridSymbol, rasterize, decodeHybridRasterAutomatic, decodeHybridRasterRegions, centeredRegions } from '@blcklab/omnimatrix';
const bytes = n => Uint8Array.from({length:n},(_,i)=>((i*139)+(i>>>1)*97)&255);
const results = [];
for(const [S,length,pixels] of [[112,4096,1280],[160,8192,1800]]){
 const payload=bytes(length);
 const encoded=encodeHybridSymbol(payload,{S,ecc:'MEDIUM'});
 const image=rasterize(encoded.layout,pixels,pixels,{header:encoded.header}).image;
 const started=performance.now();
 const out=decodeHybridRasterRegions(image,{sizes:[S],regions:centeredRegions(pixels,pixels)});
 if(Buffer.compare(Buffer.from(out.decoded.payload),Buffer.from(payload))!==0)throw Error(`M9 round trip failed for S${S}`);
 results.push({test:`generated S${S} full-frame ${length} bytes`,status:'passed',regionAttempts:out.regionAttempts,correctedSymbols:out.decoded.correctedSymbols,elapsedMs:Math.round(performance.now()-started),source:'generated_raster'});
}
const payload=bytes(1024),S=96;
const encoded=encodeHybridSymbol(payload,{S,ecc:'MEDIUM'});
const inner=rasterize(encoded.layout,800,800,{header:encoded.header}).image;
const scene={width:1500,height:1500,data:new Uint8Array(1500*1500*3).fill(255)};
for(let y=0;y<800;y++)scene.data.set(inner.data.subarray(y*2400,(y+1)*2400),((350+y)*1500+350)*3);
for(const [px,py] of [[15,15],[1400,1400]])for(let y=py;y<py+60;y++)for(let x=px;x<px+60;x++)scene.data.fill(20,(y*1500+x)*3,(y*1500+x)*3+3);
let fullFrameFailed=false;
try{decodeHybridRasterAutomatic(scene,{sizes:[S]});}catch{fullFrameFailed=true;}
const started=performance.now();const out=decodeHybridRasterRegions(scene,{sizes:[S],regions:centeredRegions(1500,1500)});
if(!fullFrameFailed||Buffer.compare(Buffer.from(out.decoded.payload),Buffer.from(payload))!==0)throw Error('Expected fallback recovery from clutter');
results.push({test:'synthetic clutter outside centered S96',status:'passed',fullFrameFailed,regionAttempts:out.regionAttempts,correctedSymbols:out.decoded.correctedSymbols,elapsedMs:Math.round(performance.now()-started),source:'generated_raster'});
const report={schema:'OMNIMATRIX_M9_SYNTHETIC_V1',environment:'Node.js generated raster tests; not real photographs',createdAt:new Date().toISOString(),results};
writeFileSync(new URL('../research/results/M9-SYNTHETIC-BENCHMARK.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
