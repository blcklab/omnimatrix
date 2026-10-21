import { mkdirSync } from 'node:fs';
import { buildLayout,rasterize } from '../dist/index.js';
import { writePng } from './png.mjs';
mkdirSync('research/fixtures',{recursive:true});
const layout=buildLayout(96,'DENSE_8');
const {image}=rasterize(layout,840,840,{rotation:0});
writePng('research/fixtures/OMX-S96-reference.png',image);
console.log('Wrote local reference image: research/fixtures/OMX-S96-reference.png');
