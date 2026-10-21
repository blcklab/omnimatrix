import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptPayload,decryptPayload,isEncryptedPayload,parseEncryptedPayload} from '../dist/encryption/index.js';
import {signPayload,verifyTrustedSignedPayload} from '../dist/signatures/index.js';
import {packBinaryEnvelope,unpackBinaryEnvelope} from '../dist/envelopes/index.js';
import {encodeHybridSymbol,decodeHybridCells} from '../dist/index.js';
const password='correct horse battery staple + unique';
const random = (n) => Uint8Array.from({length:n},(_,i)=>((i*37)^(i>>2))&255);

test('M20: AES-256-GCM password encryption round-trip and random salt/IV',async()=>{
 const original=random(281); const a=await encryptPayload({payload:original,password}); const b=await encryptPayload({payload:original,password});
 assert.equal(isEncryptedPayload(a),true);assert.notDeepEqual(a,b);
 assert.equal(parseEncryptedPayload(a).iterations,310000);
 assert.deepEqual(await decryptPayload(a,password),original);
 assert.deepEqual(await decryptPayload(b,password),original);
});
test('M20: empty payload and offset views round-trip',async()=>{
 const empty=await encryptPayload({payload:new Uint8Array(),password});assert.deepEqual(await decryptPayload(empty,password),new Uint8Array());
 const backing=Uint8Array.of(4,9,18,27,36,45,54); const cipher=await encryptPayload({payload:backing.subarray(2,6),password});
 const larger=new Uint8Array(cipher.length+8);larger.set(cipher,5);
 assert.deepEqual(await decryptPayload(larger.subarray(5,5+cipher.length),password),backing.subarray(2,6));
});
test('M20: incorrect password, ciphertext/tag tamper and authenticated metadata fail closed',async()=>{
 const original=await encryptPayload({payload:random(48),password});
 await assert.rejects(()=>decryptPayload(original,'another long passphrase'),/incorrect password or encrypted data/);
 for (const index of [11,12,28,41,44,original.length-1]) {
  const altered=original.slice();altered[index]^=1;
  await assert.rejects(()=>decryptPayload(altered,password),/incorrect password or encrypted data|invalid or inconsistent payload length/);
 }
});
test('M20: parser refuses unknown versions, KDF, flags, truncated, trailing and excessive iteration counts',async()=>{
 const data=await encryptPayload({payload:random(14),password});
 for(const [index,value] of [[4,2],[5,2],[6,2],[7,1]]) {const bad=data.slice();bad[index]=value;assert.throws(()=>parseEncryptedPayload(bad),/unsupported/);}
 assert.throws(()=>parseEncryptedPayload(data.subarray(0,20)),/truncated/);
 assert.throws(()=>parseEncryptedPayload(data.subarray(0,data.length-1)),/length/);
 assert.throws(()=>parseEncryptedPayload(new Uint8Array([...data,0])),/length/);
 const work=data.slice();work.fill(255,8,12);assert.throws(()=>parseEncryptedPayload(work),/work factor/);
});
test('M20: weak password, invalid types, oversized buffer and out-of-range work factors rejected',async()=>{
 await assert.rejects(()=>encryptPayload({payload:random(1),password:'short'}),/12–1024/);
 await assert.rejects(()=>encryptPayload({payload:random(1),password,iterations:100}),/iterations/);
 await assert.rejects(()=>encryptPayload({payload:random(1),password,iterations:1000001}),/iterations/);
 await assert.rejects(()=>encryptPayload({payload:new Uint8Array(16*1024*1024+1),password}),/16 MiB/);
 assert.equal(isEncryptedPayload(random(12)),false);
});
test('M20: optical roundtrip with existing format, M18 file and M19 signature inside encryption',async()=>{
 const kp=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const original=packBinaryEnvelope({kind:'file',filename:'sample.bin',data:random(200)});
 const signed=await signPayload({issuerId:'team-demo',privateKey:kp.privateKey,payload:original});
 const ciphertext=await encryptPayload({payload:signed,password});
 const symbol=encodeHybridSymbol(ciphertext,{S:96,palette:'DENSE_8',ecc:'MEDIUM'});
 const recovered=decodeHybridCells({header:symbol.header,cells:symbol.layout.cells}).payload;
 const revealed=await decryptPayload(recovered,password);
 const trusted=await verifyTrustedSignedPayload(revealed,new Map([['team-demo',kp.publicKey]]));
 assert.equal(trusted.status,'trusted');assert.deepEqual(unpackBinaryEnvelope(trusted.signed.payload).data,random(200));
});
