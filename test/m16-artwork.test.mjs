import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeHybridSymbol, renderHybridSVG, renderHybridArtworkSVG, decodeHybridSymbol} from '../dist/index.js';

test('CORE stays byte-for-byte identical, including both data sizes', () => {
 for (const size of [4096,8192]) {
  const source=Uint8Array.from({length:size},(_,i)=>(i*211 + (i>>>3))&255);
  const symbol=encodeHybridSymbol(source,{S:size===4096?112:160,palette:'DENSE_8',ecc:'MEDIUM'});
  assert.equal(renderHybridArtworkSVG(symbol,{theme:'CORE',coreSize:1600}),renderHybridSVG(symbol,1600));
  assert.deepEqual(decodeHybridSymbol(symbol).payload,source);
 }
});

test('the optical subtree remains exact in every additive presentation theme',()=>{
 const symbol=encodeHybridSymbol(new TextEncoder().encode('OmniMatrix optical M16'),{S:96});
 const original=renderHybridSVG(symbol,1600);
 const coreBody=original.slice(original.indexOf('>')+1,-6);
 for (const theme of ['ORBIT','PRISM','PEARL']){
  const rendered=renderHybridArtworkSVG(symbol,{theme,coreSize:1600});
  assert.ok(rendered.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(rendered.includes(coreBody),'every data polygon and optical rim path is unchanged');
  assert.equal((rendered.match(/<polygon /g)||[]).length,symbol.layout.cells.length);
  assert.match(rendered,/<text x="600"/);
  assert.ok(!rendered.includes('<script'));
 }
});

test('unknown styles and invalid sizes are rejected safely',()=>{
 const symbol=encodeHybridSymbol('tiny',{S:96});
 assert.throws(()=>renderHybridArtworkSVG(symbol,{theme:'UNSAFE'}),/Unknown/);
 assert.throws(()=>renderHybridArtworkSVG(symbol,{theme:'CORE',coreSize:0}),/coreSize/);
 assert.throws(()=>renderHybridArtworkSVG(symbol,{theme:'ORBIT',coreSize:4097}),/coreSize/);
});
