import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeRsBlock, decodeRsBlock, encodeReedSolomon, decodeReedSolomon,
  protectPayload, recoverPayload, getRsLayout, createResearchSymbol,
  getResearchCapacity, encodePayloadFrame, OmniMatrixError,
} from '@blcklab/omnimatrix';

const errorCode = (code) => (error) => error instanceof OmniMatrixError && error.code === code;
const bytes = (length, salt = 0) => Uint8Array.from({ length }, (_, i) => (Math.imul(i ^ salt, 37) + (i * i * 17) + (i >>> 3) * 41) & 255);
const hex = (input) => Buffer.from(input).toString('hex');

// Fixed independently constructed polynomial-division vectors using GF(256)/0x11D, alpha=2, b=0.
test('M4 systematic GF256 parity agrees with independent fixed division vectors', () => {
  const vectors = [
    ['48454c4c4f',16,'48454c4c4f'],
    ['4f6d6e694d6174726978',32,'4f6d6e694d6174726978'],
    ['0102030405060708090a0b0c0d0e0f10',16,'0102030405060708090a0b0c0d0e0f10'],
  ];
  // Parity suffix constants from independent schoolbook GF polynomial division.
  const parity = [
    '7d1b08144ea39d2eccaaf24709ef5a09',
    '6737acaf080f90e500b26b6e42f416e3e4380e036700460ba2e4ec428a7bcee7',
    '603c81e09214ffd7c9497eca99c946a1',
  ];
  for (let i=0; i<vectors.length; i++) {
    const [input,parityBytes,prefix] = vectors[i];
    assert.equal(hex(encodeRsBlock(Buffer.from(input,'hex'),parityBytes)), prefix+parity[i]);
  }
});

test('M4 corrects all error counts up to floor(P/2) for multiple shortened lengths', () => {
  for (const parity of [2, 4, 16, 32, 64]) for (const k of [1, 2, 31, 115, 255-parity]) {
    const source = bytes(k, parity);
    const protectedBlock = encodeRsBlock(source, parity);
    assert.deepEqual(decodeRsBlock(protectedBlock, parity).data, source);
    assert.deepEqual(protectedBlock.subarray(0,k), source);
    for (const count of [1, Math.floor(parity/2)]) {
      const damaged = protectedBlock.slice();
      const locations = new Set();
      for (let i=0; locations.size<count; i++) locations.add((i * 37 + 5) % damaged.length);
      for (const pos of locations) damaged[pos] ^= ((pos * 23) & 255) || 1;
      const snapshot = damaged.slice();
      const recovered = decodeRsBlock(damaged, parity);
      assert.deepEqual(recovered.data, source, `parity=${parity}, K=${k}, count=${count}`);
      assert.deepEqual(recovered.codeword, protectedBlock);
      assert.equal(recovered.correctedSymbols, count);
      assert.deepEqual(damaged, snapshot, 'caller bytes must not mutate');
    }
  }
});

test('M4 ECC profiles and shortened block partition follow M0.1 exactly', () => {
  const expected = [
    { C:3993, P:32, blocks:16, maxPayload:3461 },
    { C:5427, P:32, blocks:22, maxPayload:4703 },
  ];
  for (const {C,P,blocks,maxPayload} of expected) {
    const layout=getRsLayout(C,'MEDIUM');
    assert.equal(layout.parityBytesPerBlock,P);
    assert.equal(layout.blockCount,blocks);
    assert.equal(layout.maximumPayloadBytes,maxPayload);
    assert.equal(layout.blockLengths.reduce((a,b)=>a+b,0),C);
    assert.equal(layout.dataLengths.reduce((a,b)=>a+b,0),layout.dataCapacityBytes);
    assert.ok(layout.blockLengths.every((v)=>v>layout.parityBytesPerBlock && v<=255));
    const symbol=createResearchSymbol({S:C===3993?96:112, palette:'DENSE_8'});
    assert.equal(getResearchCapacity(symbol).maximumPayloadBytes,maxPayload);
  }
  for(const [profile,parity] of [['LIGHT',16], ['MEDIUM',32], ['STRONG',64], [0,16], [1,32], [2,64]]) {
    assert.equal(getRsLayout(255,profile).parityBytesPerBlock,parity);
  }
});

test('M4 column-major interleave is reversible, including unequal block lengths', () => {
  for(const C of [200,255,256,510,511,997,3993,5427]) {
    const layout=getRsLayout(C,'MEDIUM');
    const data=bytes(layout.dataCapacityBytes,C);
    const encoded=encodeReedSolomon(data,C,'MEDIUM');
    assert.equal(encoded.length,C);
    const decoded=decodeReedSolomon(encoded,'MEDIUM');
    assert.deepEqual(decoded.data,data);
    assert.equal(decoded.correctedSymbols,0);
  }
  // Independently check that the first interleaved bytes are first bytes of successive data blocks.
  const layout=getRsLayout(511);
  const data=bytes(layout.dataCapacityBytes);
  const interleaved=encodeReedSolomon(data,511);
  let offset=0;
  for(let i=0;i<layout.blockCount;i++) {
    assert.equal(interleaved[i],data[offset]);
    offset+=layout.dataLengths[i];
  }
});

test('M4 end-to-end binary 4096 and 8192 bytes recover after distributed RS byte errors', () => {
  for(const [C,size] of [[5427,4096],[11173,8192]]) {
    const input=bytes(size,size);
    const {encoded,layout}=protectPayload(input,C,'MEDIUM');
    assert.equal(encoded.length,C);
    assert.ok(layout.maximumPayloadBytes >= size);
    const damaged=encoded.slice();
    for(let i=0;i<48;i++) damaged[(i*147+7)%damaged.length] ^= (i*13+17)&255;
    const result=recoverPayload(damaged,'MEDIUM');
    assert.deepEqual(result.payload,input);
    assert.equal(result.correctedSymbols,48);
    assert.ok(result.correctedBlocks>0);
    assert.ok(result.paddingBytes>=0);
  }
});

test('M4 prevents silent over-capacity framing and rejects bad RS geometry', () => {
  assert.throws(()=>getRsLayout(0),errorCode('INVALID_SIZE'));
  assert.throws(()=>getRsLayout(32,'MEDIUM'),errorCode('CAPACITY_EXCEEDED'));
  assert.throws(()=>getRsLayout(255,'INVALID'),errorCode('INVALID_INPUT'));
  assert.throws(()=>getRsLayout(2_000_001),errorCode('INVALID_SIZE'));
  assert.throws(()=>protectPayload(bytes(4704),5427),errorCode('CAPACITY_EXCEEDED'));
  assert.throws(()=>encodeRsBlock(new Uint8Array(),32),errorCode('INVALID_SIZE'));
  assert.throws(()=>decodeRsBlock(new Uint8Array(32),32),errorCode('INVALID_SIZE'));
  assert.throws(()=>encodeReedSolomon(bytes(15),255),errorCode('INVALID_SIZE'));
  assert.throws(()=>decodeReedSolomon(Uint8Array.of(1,2,3)),errorCode('CAPACITY_EXCEEDED'));
});

test('M4 detects corruption exceeding RS correction radius', () => {
  const data=bytes(99);
  const encoded=encodeRsBlock(data,32);
  const damaged=encoded.slice();
  for(let i=0;i<17;i++) damaged[i*5] ^= (i+1);
  assert.throws(()=>decodeRsBlock(damaged,32),errorCode('ECC_UNRECOVERABLE'));
});

test('M4 checks OMD1 CRC after valid RS decoding (RS is not authentication)', () => {
  const original=encodePayloadFrame('HELLO');
  const tampered=original.slice();
  tampered[20]^=1;
  const layout=getRsLayout(255);
  const padded=new Uint8Array(layout.dataCapacityBytes);
  padded.set(tampered);
  const ecc=encodeReedSolomon(padded,255);
  assert.throws(()=>recoverPayload(ecc),errorCode('CRC_MISMATCH'));
});

test('M4 randomized deterministic stress of varying shortened blocks and error positions', () => {
  let state=0x12345678;
  const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  for(let iteration=0;iteration<100;iteration++) {
    const p=[16,32,64][iteration%3];
    const k=1+next()%(255-p);
    const raw=Uint8Array.from({length:k},()=>next()&255);
    const encoded=encodeRsBlock(raw,p);
    const count=next()%(Math.floor(p/2)+1);
    const used=new Set();
    while(used.size<count)used.add(next()%encoded.length);
    const damaged=encoded.slice();
    for(const pos of used) damaged[pos]^=(next()%255)+1;
    const got=decodeRsBlock(damaged,p);
    assert.deepEqual(got.data,raw);
    assert.equal(got.correctedSymbols,count);
  }
});
