import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransferChunks,parseTransferChunk,isTransferChunk,TransferCollector} from '../dist/transfers/index.js';
import {encodeHybridSymbol,decodeHybridCells} from '../dist/index.js';
const example=n=>Uint8Array.from({length:n},(_,i)=>(i*73+(i>>2)*11)&255);
for(const n of [3000,4096,8192,19011])test(`M22: ${n} bytes out of order with duplicates and exact optical roundtrip`,async()=>{
 const data=example(n);const chunks=await createTransferChunks(data,{chunkBytes:2048});
 assert.equal(chunks.length,Math.ceil(n/2048));
 const collector=new TransferCollector();const shuffled=chunks.map((_,i)=>i).reverse();
 for(const i of shuffled){
  const symbol=encodeHybridSymbol(chunks[i],{S:112,palette:'DENSE_8',ecc:'MEDIUM'});
  const optical=decodeHybridCells({header:symbol.header,cells:symbol.layout.cells});
  const accepted=await collector.add(optical.payload);
  if(i===shuffled[0])assert.equal((await collector.add(optical.payload)).status,'duplicate');
  if(i!==0)assert.equal(accepted.status,'added');
  else {assert.equal(accepted.status,'complete');assert.deepEqual(accepted.payload,data);}
 }
 assert.equal(collector.progress().completed,true);assert.equal(collector.progress().missing.length,0);
});
test('M22: no partial plaintext, missing chunks reported, reset',async()=>{
 const [one,two]=await createTransferChunks(example(2600),{chunkBytes:2048});const c=new TransferCollector();
 const a=await c.add(one);assert.equal(a.payload,undefined);assert.deepEqual(a.progress.missing,[1]);c.reset();assert.equal(c.progress().received,0);
 assert.equal((await c.add(two)).status,'added');
});
test('M22: CRC, metadata mismatch, conflicts and transfer isolation',async()=>{
 const [a,b]=await createTransferChunks(example(2400),{chunkBytes:1200});const c=new TransferCollector();
 const badBody=b.slice();badBody[badBody.length-1]^=1;assert.throws(()=>parseTransferChunk(badBody),/chunk CRC/);
 const badHeader=a.slice();badHeader[24]^=1;assert.throws(()=>parseTransferChunk(badHeader),/header CRC|invalid chunk geometry/);
 const alt=await createTransferChunks(example(2400),{chunkBytes:1200});await c.add(a);await assert.rejects(c.add(alt[1]),/different transfer/);
 const altered=b.slice();altered[80]^=1;const conflicting=await createTransferChunks(example(2400).map((n,i)=>i>=1200?(n^1):n),{chunkBytes:1200,transferId:a.slice(8,24)});
 await assert.rejects(c.add(conflicting[0]),/different transfer|conflicting/);
 assert.equal((await c.add(b)).status,'complete');
});
test('M22: whole-transfer SHA-256 prevents a consistent-header yet altered payload',async()=>{
 const chunks=await createTransferChunks(example(3000),{chunkBytes:1500}), c=new TransferCollector();
 await c.add(chunks[0]);const forged=chunks[1].slice();forged[80]^=1;
 const {crc32IsoHdlc}=await import('../dist/protocol/crc32.js');const view=new DataView(forged.buffer);
 view.setUint32(72,crc32IsoHdlc(forged.subarray(80)),false);view.setUint32(76,crc32IsoHdlc(forged.subarray(0,76)),false);
 await assert.rejects(c.add(forged),/SHA-256 mismatch/);assert.equal(c.progress().completed,false);
 assert.equal((await c.add(chunks[1])).status,'complete');
});
test('M22: strict geometry and upper bounds',async()=>{
 await assert.rejects(createTransferChunks(new Uint8Array(0)),/payload/);
 await assert.rejects(createTransferChunks(example(33),{chunkBytes:0}),/chunkBytes/);
 const [a]=await createTransferChunks(example(256),{chunkBytes:128});const bad=a.slice();bad[4]=2;assert.throws(()=>parseTransferChunk(bad),/unsupported/);
 assert.equal(isTransferChunk(a),true);assert.equal(isTransferChunk(new Uint8Array([1,2,3])),false);
});
