import { encodeHybridSymbol, decodeHybridSymbol, renderHybridSVG } from '@blcklab/omnimatrix';
import { writeFile } from 'node:fs/promises';
const input=Uint8Array.from({length:4096}, (_,i)=>(Math.imul(i,137) + (i>>3)*11) & 255);
const symbol=encodeHybridSymbol(input,{S:112,palette:'DENSE_8',ecc:'MEDIUM',mask:1});
const output=decodeHybridSymbol(symbol);
if(Buffer.compare(output.payload,input)!==0) throw new Error('M5 logical payload round-trip failed');
await writeFile(new URL('../examples/OMX-M5-S112-4096-BYTE-DEMO.svg',import.meta.url),renderHybridSVG(symbol,1024));
console.log('HYBRID payload logical encode/decode: PASS', {
 payloadBytes:output.payload.length,encodedBytes:output.encodedBytes,
 dataCells:symbol.layout.dataCount,correctedSymbols:output.correctedSymbols,
 svg:'examples/OMX-M5-S112-4096-BYTE-DEMO.svg',
});
console.log('Image-based payload recovery is NOT implemented (M10).');
