import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  signPayload, parseSignedPayload, isSignedPayload, verifySignedPayload, verifyTrustedSignedPayload,
} from '../dist/signatures/index.js';
import { packBinaryEnvelope, unpackBinaryEnvelope } from '../dist/envelopes/index.js';
import { buildSmartPayload, parseSmartPayload } from '../dist/payloads/index.js';
import { encodeHybridSymbol, decodeHybridCells } from '../dist/index.js';
const pair = await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const second = await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const privateJwk=await webcrypto.subtle.exportKey('jwk',pair.privateKey);
const publicJwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
const payload=Uint8Array.from({length:750},(_,i)=>i*31&255);
const sign=()=>signPayload({issuerId:'blcklab:demo',payload,privateKey:privateJwk});
test('ES256 creates a strict signed envelope and verifies with public JWK / CryptoKey',async()=>{
  const bytes=await sign();assert.equal(isSignedPayload(bytes),true);
  const parsed=parseSignedPayload(bytes);
  assert.equal(parsed.issuerId,'blcklab:demo');assert.equal(parsed.algorithm,'ES256');assert.deepEqual(parsed.payload,payload);assert.equal(parsed.signature.length,64);
  assert.equal((await verifySignedPayload(bytes,publicJwk)).status,'verified');
  assert.equal((await verifySignedPayload(bytes,pair.publicKey)).status,'verified');
});
test('trust is never inferred from a successful signature or embedded issuer ID',async()=>{
  const bytes=await sign();
  assert.equal((await verifyTrustedSignedPayload(bytes,new Map())).status,'unknown-issuer');
  assert.equal((await verifyTrustedSignedPayload(bytes,new Map([['another',publicJwk]]))).status,'unknown-issuer');
  assert.equal((await verifyTrustedSignedPayload(bytes,new Map([['blcklab:demo',publicJwk]]))).status,'trusted');
  assert.equal((await verifyTrustedSignedPayload(bytes,new Map([['blcklab:demo',await webcrypto.subtle.exportKey('jwk',second.publicKey)]]))).status,'invalid-signature');
});
test('payload and issuer mutation fail verification even if envelope remains well-formed',async()=>{
  const bytes=await sign();const altered=bytes.slice();altered[30]^=1;
  assert.equal((await verifySignedPayload(altered,publicJwk)).status,'invalid-signature');
  const issuer=bytes.slice();issuer[16]=0x42;
  assert.equal((await verifySignedPayload(issuer,publicJwk)).status,'invalid-signature');
  assert.equal((await verifySignedPayload(bytes,await webcrypto.subtle.exportKey('jwk',second.publicKey))).status,'invalid-signature');
});
test('rejects malformed, truncated, unknown version and trailing bytes',async()=>{
  const bytes=await sign();
  for(const attempt of [bytes.subarray(0,15),bytes.subarray(0,-1),new Uint8Array([...bytes,0]),(()=>{const a=bytes.slice();a[4]=2;return a})(),(()=>{const a=bytes.slice();a[7]=1;return a})()]){
    assert.throws(()=>parseSignedPayload(attempt),TypeError);
  }
  assert.equal(isSignedPayload(payload),false);
});
test('rejects invalid key types, private JWK verification and public-only signing',async()=>{
  const bytes=await sign();
  await assert.rejects(()=>verifySignedPayload(bytes,privateJwk),/public JWK only/);
  await assert.rejects(()=>signPayload({issuerId:'blcklab:demo',payload,privateKey:publicJwk}),/private JWK/);
  await assert.rejects(()=>signPayload({issuerId:'bad identifier',payload,privateKey:privateJwk}),/issuerId/);
  await assert.rejects(()=>verifyTrustedSignedPayload(bytes,{ 'blcklab:demo':publicJwk}),/explicit Map/);
});
test('signed file envelope round-trip and exact existing optical encoding',async()=>{
  const file=packBinaryEnvelope({kind:'file',filename:'sample.bin',data:Uint8Array.of(1,0,255)});
  const bytes=await signPayload({issuerId:'blcklab:demo',payload:file,privateKey:pair.privateKey});
  const symbol=encodeHybridSymbol(bytes,{S:96,palette:'DENSE_8',ecc:'MEDIUM'});
  const recovered=decodeHybridCells({header:symbol.header,cells:symbol.layout.cells.map(({q,r,colorIndex})=>({q,r,colorIndex}))}).payload;
  const verified=await verifySignedPayload(recovered,publicJwk);
  assert.equal(verified.status,'verified');assert.deepEqual(unpackBinaryEnvelope(verified.signed.payload).data,Uint8Array.of(1,0,255));
});
test('signed M17 smart text remains readable but only trusted with a configured public key',async()=>{
  const payload=buildSmartPayload({kind:'url',url:'https://example.org/omnimatrix'});
  const bytes=await signPayload({issuerId:'blcklab:demo',payload,privateKey:privateJwk});
  const parsed=parseSignedPayload(bytes);assert.deepEqual(parseSmartPayload(parsed.payload),{kind:'url',url:'https://example.org/omnimatrix'});
  assert.equal((await verifyTrustedSignedPayload(bytes,new Map())).status,'unknown-issuer');
});
