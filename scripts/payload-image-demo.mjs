/** Offline research fixture; uses the Node-only PNG adapter outside the core library. */
import { encodeHybridSymbol, decodeHybridRasterAssisted, rasterizeHybridSymbol,
  idealRasterCardinalPoints, renderHybridSVG } from '@blcklab/omnimatrix';
import { writeFile } from 'node:fs/promises';
import { writePng } from './png.mjs';

const S=112, size=1408, original=Uint8Array.from({length:4096},(_,i)=>(Math.imul(i+29,137)+(i>>>4)*13)&255);
const symbol=encodeHybridSymbol(original,{S,palette:'DENSE_8',ecc:'MEDIUM',mask:1});
const {image}=rasterizeHybridSymbol(symbol,size,size);
const result=decodeHybridRasterAssisted(image,idealRasterCardinalPoints(S,size,size),{sizes:[S],refine:false});
if(!Buffer.from(result.decoded.payload).equals(Buffer.from(original)))throw new Error('M6 synthetic optical recovery failed');
const png=new URL('../research/fixtures/OMX-M6-S112-4096-PAYLOAD.png',import.meta.url);
writePng(png.pathname,image);
await writeFile(new URL('../examples/OMX-M6-S112-4096-PAYLOAD.svg',import.meta.url),renderHybridSVG(symbol,1408));
console.log('M6 image-backed payload round-trip: PASS',{
 bytes:result.decoded.payload.length, correctedBytes:result.decoded.correctedSymbols,
 validHeaderTracks:result.sampling.validHeaderTracks, dataCells:result.sampling.dataSamples,
 fixture:'research/fixtures/OMX-M6-S112-4096-PAYLOAD.png',
 svg:'examples/OMX-M6-S112-4096-PAYLOAD.svg',
});
console.log('This is a GENERATED raster fixture, not a real phone-camera performance test.');
