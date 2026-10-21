import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildLayout, estimateCapacity, isCandidate, d2, cubeRound, axialToXY,
  makeHeader, readHeader, rasterize, sampleRegistered,
  acquireOrientationWithKnownCenter, sampleHeaderRegistered, perturb, renderSVG,
} from '../dist/index.js';
const vectors = JSON.parse(readFileSync(new URL('../research/M0-REFERENCE-VECTORS.json',import.meta.url)));

test('all 11 M0 capacity test vectors match', () => {
  for(const v of vectors.capacity_vectors){
    const l = buildLayout(v.S,'DENSE_8'); const c=estimateCapacity(l);
    assert.deepEqual([l.candidates,l.alignmentCount,l.calibrationCount,l.dataCount,c.codewordBytes,c.blocks,c.maximumPayloadBytes],
      [v.candidate_hexagons,v.alignment_cells,v.calibration_cells,v.data_cells,v.codeword_bytes,v.rs_blocks,v.net_payload_bytes]);
    assert.equal(l.byCoordinate.size,l.cells.length);
  }
});

test('header vector and rejection of bad CRC', () => {
  const header=makeHeader({S:112,palette:1});
  assert.equal(Buffer.from(header).toString('hex'),vectors.header_vector.header_hex);
  assert.equal(readHeader(header).S,112);
  header[3] ^= 1;
  assert.throws(()=>readHeader(header),/INVALID_HEADER/);
});

test('conservative full-cell radial exclusion for all tested sizes', () => {
  for (const S of [32,64,112,160]) {
    const l=buildLayout(S,'DENSE_8');
    for(const cell of l.cells){
      assert.ok(isCandidate(cell.q,cell.r,S));
      const c=Math.sqrt(d2(cell.q,cell.r));
      assert.ok(c-1>=8-1e-10);
      assert.ok(c+1<=S+1e-10);
    }
  }
});

test('axial forward and inverse round trip across the layout', () => {
  for(const cell of buildLayout(96,'RELIABLE_4').cells){
    const xy=axialToXY(cell.q,cell.r);
    assert.deepEqual(cubeRound(xy.x,xy.y),{q:cell.q,r:cell.r});
  }
});

test('SVG has two header tracks, circular features and accurate hex count', () => {
  const l=buildLayout(32,'RELIABLE_4');
  const svg=renderSVG(l,512);
  assert.match(svg,/viewBox="-46 -46 92 92"/);
  assert.equal((svg.match(/<polygon /g)||[]).length,l.candidates);
  assert.match(svg,/circle r="6"/);
  assert.match(svg,/path fill="#000000"/);
});

test('ideal registered sampling: both palettes and rotated image', () => {
  for(const palette of ['RELIABLE_4','DENSE_8']) {
    const l=buildLayout(112,palette);
    const {image,transform}=rasterize(l,768,768,{rotation:37*Math.PI/180});
    const result=sampleRegistered(l,image,transform);
    assert.equal(result.total,l.dataCount);
    assert.equal(result.errors,0);
    const h=sampleHeaderRegistered(image,transform,112);
    assert.equal(h.status,'OK');
    assert.equal(h.hexA,Buffer.from(makeHeader({S:112,palette:palette==='DENSE_8'?1:0})).toString('hex'));
    assert.equal(h.hexB,h.hexA);
  }
});

test('outer orientation gaps recover rotation and chirality with known center/scale', () => {
  const l=buildLayout(112,'DENSE_8');
  for(const mirror of [false,true]){
    const {image,transform}=rasterize(l,768,768,{rotation:37*Math.PI/180,mirror});
    const v=acquireOrientationWithKnownCenter(image,transform.cx,transform.cy,(l.S+9)*transform.a);
    assert.ok(v,'should find two notches');
    assert.equal(v.chirality,mirror?'MIRRORED':'NORMAL');
    const expected=mirror? 37+180 : 37;
    assert.ok(Math.abs(v.primaryDegrees-expected)<1.5);
  }
});

test('severe sampling degradation exposes errors instead of silently claiming decode', () => {
  const l=buildLayout(160,'DENSE_8');
  const {image,transform}=rasterize(l,512,512,{rotation:37*Math.PI/180});
  const damaged=perturb(image,{blur:true,noiseSigma:8,gains:[1,.8,1.2],washout:.2});
  const result=sampleRegistered(l,damaged,transform);
  assert.ok(result.total>25_000);
  assert.ok(result.errors>0,'low-density synthetic capture should reveal errors');
});
