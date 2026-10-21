import { mkdirSync,writeFileSync } from 'node:fs';
import { buildLayout,renderSVG,rasterize,estimateCapacity } from '../dist/index.js';
import {writePng} from './png.mjs';
mkdirSync('examples',{recursive:true});
for(const [S,palette,size] of [[112,'DENSE_8',1024],[160,'DENSE_8',1024],[112,'RELIABLE_4',1024]]){
  const layout=buildLayout(S,palette);
  const base=`examples/OMX-HYBRID-S${S}-${palette}`;
  const svg=renderSVG(layout,size);
  writeFileSync(`${base}.svg`,svg);
  const {image}=rasterize(layout,size,size);
  writePng(`${base}.png`,image);
  console.log(`${base}: candidates=${layout.candidates} netCapacity=${estimateCapacity(layout).maximumPayloadBytes}B`);
}
console.log('CAUTION: all three images use synthetic pseudorandom cell patterns, NOT encoded user bytes.');
