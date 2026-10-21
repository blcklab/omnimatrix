import test from 'node:test';
import assert from 'node:assert/strict';
import { packBinaryEnvelope, unpackBinaryEnvelope, isBinaryEnvelope, encodeHybridSymbol, decodeHybridCells } from '../dist/index.js';
import * as standalone from '../dist/envelopes/index.js';

test('M18 public subpath exposes envelope operations', () => assert.equal(standalone.packBinaryEnvelope, packBinaryEnvelope));
for (const [size,S] of [[0,96],[22,96],[4096,112],[8096,160]]) {
 test(`M18 exact ${size}-byte binary roundtrip and existing optical code`, () => {
   const data = Uint8Array.from({length:size}, (_,i) => (i*137 + (i>>2)*29) & 255);
   const bytes = packBinaryEnvelope({kind:'file',filename:'é-sample.dat',mediaType:'application/octet-stream',data});
   assert.ok(isBinaryEnvelope(bytes));
   const decoded=unpackBinaryEnvelope(bytes);
   assert.equal(decoded.version,1);assert.equal(decoded.filename,'é-sample.dat');assert.equal(decoded.mediaType,'application/octet-stream');
   assert.deepEqual(decoded.data,data);
   if(size<=8096) {
     const symbol=encodeHybridSymbol(bytes,{S,palette:'DENSE_8',ecc:'MEDIUM'});
     assert.deepEqual(decodeHybridCells({header:symbol.header,cells:symbol.layout.cells}).payload,bytes);
   }
 });
}
test('blob kind and default media type',()=>{
 const parsed=unpackBinaryEnvelope(packBinaryEnvelope({kind:'blob',data:Uint8Array.of(0,255,30)}));
 assert.deepEqual(parsed,{version:1,kind:'blob',mediaType:'application/octet-stream',data:Uint8Array.of(0,255,30)});
});
test('reject unsafe metadata, allocations, and inputs',()=>{
 const data=Uint8Array.of(1,2);
 for(const filename of ['../a.txt','a\\b.txt','x/y','a\0b','C:foo','..','a\n','x'.repeat(260),'invoice\u202eexe.pdf']) {
   assert.throws(()=>packBinaryEnvelope({filename,data}));
 }
 for(const mediaType of ['text/html; charset=utf-8','abc','image/','\napplication/json']) assert.throws(()=>packBinaryEnvelope({mediaType,data}));
 assert.throws(()=>packBinaryEnvelope({kind:'blob',filename:'x',data}));
 assert.throws(()=>packBinaryEnvelope({data:new Uint8Array(16*1024*1024+1)}));
 assert.equal(isBinaryEnvelope(data),false);
});
test('reject missing/truncated/changed header and data, trailing bytes, versions and lengths',()=>{
 const original=packBinaryEnvelope({kind:'file',filename:'archive.bin',data:Uint8Array.of(3,2,1)});
 for(let end=0;end<original.length;end++) assert.throws(()=>unpackBinaryEnvelope(original.subarray(0,end)));
 for(const offset of [4,5,6,8,10,12,16,19,20,21,original.length-1]) {
   const modified=original.slice();modified[offset]^=0x80;assert.throws(()=>unpackBinaryEnvelope(modified));
 }
 const extended=new Uint8Array(original.length+1);extended.set(original);assert.throws(()=>unpackBinaryEnvelope(extended));
 const tampered=original.slice();tampered[4]=2;assert.throws(()=>unpackBinaryEnvelope(tampered),/unsupported version/);
});
test('do not misidentify ordinary M17 and raw binary payloads',()=>{
 for(const content of ['Hello','https://example.org','WIFI:T:WPA;S:hi;P:hello;;']) assert.equal(isBinaryEnvelope(new TextEncoder().encode(content)),false);
 assert.equal(isBinaryEnvelope(new TextEncoder().encode('OMXE-not-an-envelope')),true);
 assert.throws(()=>unpackBinaryEnvelope(new TextEncoder().encode('OMXE-not-an-envelope')));
});
