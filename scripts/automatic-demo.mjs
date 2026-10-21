/** Generated-pixel research demonstration; this is not a physical camera benchmark. */
import { encodeHybridSymbol, rasterize, decodeHybridRasterAutomatic } from '@blcklab/omnimatrix';
import { writePng } from './png.mjs';
const cases=[{S:112,bytes:4096,width:1280,height:1280,angle:0,cx:640,cy:640,a:1280/(2*126)},
  {S:160,bytes:8192,width:1800,height:1700,angle:.31,cx:903,cy:857,a:4.4}];
for(const c of cases){
  const payload=Uint8Array.from({length:c.bytes},(_,i)=>(Math.imul(i+73,103)+(i>>>3)*11)&255);
  const symbol=encodeHybridSymbol(payload,{S:c.S,ecc:'MEDIUM'});
  const image=rasterize(symbol.layout,c.width,c.height,{cx:c.cx,cy:c.cy,a:c.a,rotation:c.angle,header:symbol.header}).image;
  const now=performance.now();const result=decodeHybridRasterAutomatic(image,{sizes:[c.S]});
  if(result.decoded.payload.length!==payload.length||result.decoded.payload.some((b,i)=>b!==payload[i]))throw new Error('Automatic decode mismatch');
  if(c.S===160) writePng(new URL('../research/fixtures/OMX-M8-S160-8192-AUTO.png',import.meta.url).pathname,image);
  console.log(`AUTO S${c.S} ${c.bytes} bytes: PASS, corrected=${result.decoded.correctedSymbols}, time=${(performance.now()-now).toFixed(1)}ms`);
}
console.log('Only generated flat RGB images; no phone-camera validation has been run.');
