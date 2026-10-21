import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeHybridSymbol, decodeHybridCells, decodeHybridSymbol,
  renderHybridSVG, rasterizeHybridSymbol, getRsLayout,
  createResearchSymbol, renderResearchSVG, readHeader, makeHeader,
  OmniMatrixError, sampleIdeal, headerBit, renderSVG,
} from '@blcklab/omnimatrix';

const data = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (Math.imul(i + seed, 97) ^ (i >>> 3) ^ Math.imul(i % 113, 41)) & 255);
const err = (code) => (e) => e instanceof OmniMatrixError && e.code === code;
const sampled = (symbol) => ({ header: symbol.header, cells: symbol.layout.cells.map(({q,r,colorIndex}) => ({q,r,colorIndex})) });
const mutate = (symbol, at, delta) => {
  const x = sampled(symbol);
  const cell = symbol.layout.cells.filter(c => c.role === 'DATA')[at];
  const index = x.cells.findIndex(c => c.q === cell.q && c.r === cell.r);
  x.cells[index].colorIndex ^= delta;
  return x;
};

test('M5 encodes 4KiB into S112 and 8KiB into S160, independently recovers byte-for-byte', () => {
  for (const [S,length] of [[112,4096],[160,8192]]) {
    const payload = data(length,S);
    const inputSnapshot = payload.slice();
    const symbol = encodeHybridSymbol(payload,{S,palette:'DENSE_8',ecc:'MEDIUM',mask:1});
    assert.equal(symbol.payloadBytes,length);
    assert.equal(symbol.layout.dataCount, S===112?14472:29796);
    assert.equal(readHeader(symbol.header).S,S);
    assert.equal(symbol.maximumPayloadBytes,getRsLayout(Math.floor(symbol.layout.dataCount*3/8),'MEDIUM').maximumPayloadBytes);
    const cells=sampled(symbol);
    cells.cells.reverse(); // Independent coordinate reconstruction, no index/layout cache assumed.
    const decoded=decodeHybridCells(cells);
    assert.deepEqual(decoded.payload,payload);
    assert.equal(decoded.correctedSymbols,0);
    assert.deepEqual(payload,inputSnapshot);
    assert.deepEqual(decodeHybridSymbol(symbol).payload,payload);
    assert.equal(decoded.encodedBytes,S===112?5427:11173);
  }
});

test('M5 distinguishes logical payload symbols from old research patterns', () => {
  const research=createResearchSymbol({S:96});
  const symbol=encodeHybridSymbol('OmniMatrix live binary', {S:96});
  assert.equal(symbol.kind,'hybrid-payload');
  assert.equal(research.kind,'research-pattern');
  assert.deepEqual(new TextDecoder().decode(decodeHybridSymbol(symbol).payload),'OmniMatrix live binary');
  assert.notEqual(symbol.layout.cells.filter(c=>c.role==='DATA').map(c=>c.colorIndex).slice(0,64).join(','),
    research.layout.cells.filter(c=>c.role==='DATA').map(c=>c.colorIndex).slice(0,64).join(','));
  assert.match(renderResearchSVG(research),/<svg/);
});

test('M5 handles empty, UTF8, exact limit and capacity overflow', () => {
  for(const palette of ['DENSE_8','RELIABLE_4']) for(const ecc of ['LIGHT','MEDIUM','STRONG']) for(const mask of [0,1]) {
    const opt={S:64,palette,ecc,mask};
    const symbol=encodeHybridSymbol('🌟 OmniMatrix 日本語',opt);
    const decoded=decodeHybridSymbol(symbol);
    assert.equal(new TextDecoder().decode(decoded.payload),'🌟 OmniMatrix 日本語');
    assert.equal(decoded.palette,palette);
    assert.equal(decoded.ecc,ecc);
    assert.equal(decoded.mask,mask);
    assert.deepEqual(decodeHybridSymbol(encodeHybridSymbol(new Uint8Array(0),opt)).payload,new Uint8Array());
    const exact=data(symbol.maximumPayloadBytes,17);
    assert.deepEqual(decodeHybridSymbol(encodeHybridSymbol(exact,opt)).payload,exact);
    assert.throws(()=>encodeHybridSymbol(data(symbol.maximumPayloadBytes+1),opt),err('CAPACITY_EXCEEDED'));
  }
});

test('M5 deterministic byte->hex mapping and header matches ECC and mask settings', () => {
  for (const [ecc,mask,profile] of [['LIGHT',0,0],['MEDIUM',1,1],['STRONG',1,2]]) {
    const first=encodeHybridSymbol(data(100),{S:96,ecc,mask});
    const second=encodeHybridSymbol(data(100),{S:96,ecc,mask});
    assert.deepEqual(first.header,second.header);
    assert.deepEqual(first.layout.cells,second.layout.cells);
    const header=readHeader(first.header);
    assert.equal(header.ecc,profile);
    assert.equal(header.mask,mask);
    for (const c of first.layout.cells) assert.equal(first.layout.byCoordinate.get(`${c.q},${c.r}`),c);
  }
});

test('M5 recovers after deliberately changed color cells through RS codewords', () => {
  for (const S of [96,112]) {
    const payload=data(S===96?2000:4096);
    const symbol=encodeHybridSymbol(payload,{S});
    const damaged=sampled(symbol);
    // Distributed, independent bit-level changes in data cells, bounded by error correction.
    for (let i=0;i<20;i++) {
      const c=symbol.layout.cells.filter(c=>c.role==='DATA')[i*67+3];
      const target=damaged.cells.find(x=>x.q===c.q && x.r===c.r);
      target.colorIndex ^= 1;
    }
    const result=decodeHybridCells(damaged);
    assert.deepEqual(result.payload,payload);
    assert.ok(result.correctedSymbols > 0);
    assert.ok(result.correctedBlocks > 0);
    // Reserve/reference cells may be misclassified; ECC applies only to actual data cells.
    const marker=damaged.cells.find((c,i)=>symbol.layout.cells[i].role==='CALIBRATION');
    marker.colorIndex ^= 1;
    assert.deepEqual(decodeHybridCells(damaged).payload,payload);
  }
});

test('M5 rejects invalid or missing coordinates, header mismatch, color indices and pad errors', () => {
  const symbol=encodeHybridSymbol(data(512),{S:96,mask:0});
  const base=sampled(symbol);
  assert.throws(()=>decodeHybridCells({...base,header:new Uint8Array(8)}),err('INVALID_HEADER'));
  assert.throws(()=>decodeHybridCells({...base,header:makeHeader({S:112,palette:1})}),err('INVALID_GEOMETRY'));
  assert.throws(()=>decodeHybridCells({...base,cells:base.cells.slice(1)}),err('INVALID_GEOMETRY'));
  const dup=sampled(symbol);dup.cells[0]={...dup.cells[1]};
  assert.throws(()=>decodeHybridCells(dup),err('INVALID_GEOMETRY'));
  const bad=sampled(symbol);bad.cells[0].colorIndex=8;
  assert.throws(()=>decodeHybridCells(bad),err('INVALID_GEOMETRY'));
  const wrong=sampled(symbol);wrong.cells[0].q=999999;
  assert.throws(()=>decodeHybridCells(wrong),err('INVALID_GEOMETRY'));
  assert.throws(()=>encodeHybridSymbol('x',{S:97}),err('INVALID_SIZE'));
  assert.throws(()=>encodeHybridSymbol('x',{S:96,palette:'INVALID'}),err('INVALID_PALETTE'));
  assert.throws(()=>encodeHybridSymbol('x',{S:96,mask:2}),err('UNSUPPORTED_MASK'));
  assert.throws(()=>encodeHybridSymbol('x',{S:96,ecc:'WRONG'}),err('INVALID_INPUT'));
  // At S96, D*3=31950 bits; 6 tail bits after the last RS byte must be zero.
  assert.equal(symbol.layout.dataCount*3 % 8,6);
  const tail=mutate(symbol,symbol.layout.dataCount-1,1);
  assert.throws(()=>decodeHybridCells(tail),err('INVALID_PADDING'));
});

test('M5 renderers embed ECC/mask-aware header instead of research-mode defaults', () => {
  const symbol=encodeHybridSymbol(data(123),{S:64,mask:0,ecc:'STRONG',palette:'RELIABLE_4'});
  const svg=renderHybridSVG(symbol,600);
  assert.match(svg,/<svg/);
  assert.match(svg,/<polygon/);
  assert.match(svg,/<path/);
  assert.match(svg,/width="600"/);
  assert.notEqual(svg,renderSVG(symbol.layout,600),'M5 header must encode chosen ECC/mask, not research defaults');
  for (let bit = 0; bit < 64; bit++) {
    const theta = (bit + 0.5) * Math.PI / 32;
    const a=sampleIdeal(symbol.layout,(symbol.layout.S+3)*Math.cos(theta),(symbol.layout.S+3)*Math.sin(theta),symbol.header);
    const b=sampleIdeal(symbol.layout,(symbol.layout.S+6)*Math.cos(theta),(symbol.layout.S+6)*Math.sin(theta),symbol.header);
    const black=(rgb)=>rgb.r===0 && rgb.g===0 && rgb.b===0;
    assert.equal(black(a),headerBit(symbol.header,bit)===1);
    assert.equal(black(b),headerBit(symbol.header,bit)===0);
  }
  const {image,transform}=rasterizeHybridSymbol(symbol,256,256);
  assert.equal(image.data.length,256*256*3);
  assert.ok(transform.a>0);
});
