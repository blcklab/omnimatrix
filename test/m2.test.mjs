import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BitReader, BitWriter, OmniMatrixError,
  toBytes, fromUtf8, concatBytes, readU32BE, writeU32BE,
  packIndices, unpackIndices,
  createResearchSymbol, renderResearchSVG, getResearchCapacity,
  buildLayout, renderSVG, makeHeader, readHeader, measureAssisted,
} from '@blcklab/omnimatrix';

function errorCode(code) { return (err) => err instanceof OmniMatrixError && err.code === code; }

test('M2 public API exports ESM, preserves original research APIs', async () => {
  const { createResearchSymbol: fromResearch } = await import('@blcklab/omnimatrix/research');
  const { BitReader: fromCore } = await import('@blcklab/omnimatrix/core');
  const { buildLayout: fromGeometry } = await import('@blcklab/omnimatrix/geometry');
  const { readHeader: fromProtocol } = await import('@blcklab/omnimatrix/protocol');
  const { renderSVG: fromRenderers } = await import('@blcklab/omnimatrix/renderers');
  const { measureAssisted: fromOptical } = await import('@blcklab/omnimatrix/optical');
  assert.equal(fromResearch, createResearchSymbol);
  assert.equal(fromCore, BitReader);
  assert.equal(fromGeometry, buildLayout);
  assert.equal(fromProtocol, readHeader);
  assert.equal(fromRenderers, renderSVG);
  assert.equal(fromOptical, measureAssisted);
});

test('M2 bitstream supports MSB-first 3-bit packing and exact payload length', () => {
  const writer = new BitWriter().write(5, 3).write(2, 3).write(7, 3).write(0, 3);
  assert.equal(writer.lengthBits, 12);
  assert.deepEqual([...writer.toBytes()], [0b10101011, 0b10000000]);
  const reader = new BitReader(writer.toBytes(), 12);
  assert.deepEqual([reader.read(3), reader.read(3), reader.read(3), reader.read(3)], [5, 2, 7, 0]);
  assert.equal(reader.remainingBits, 0);
  assert.throws(() => reader.read(1), errorCode('UNEXPECTED_EOF'));
});

test('M2 bitstream random roundtrips at all supported widths 1-32', () => {
  for (let width = 1; width <= 32; width++) {
    const limit = 2 ** width;
    const values = Array.from({ length: 39 }, (_, i) => (Math.imul(i, 0x9e3779b1) >>> 0) % limit);
    const writer = new BitWriter();
    for (const value of values) writer.write(value, width);
    const reader = new BitReader(writer.toBytes(), writer.lengthBits);
    for (const value of values) assert.equal(reader.read(width), value);
    assert.equal(reader.remainingBits, 0);
  }
});

test('M2 bitstream returns a new snapshot when additional values are written', () => {
  const writer = new BitWriter().write(1, 3);
  const old = writer.toBytes();
  writer.write(7, 3);
  assert.deepEqual([...old], [0b00100000]);
  assert.deepEqual([...writer.toBytes()], [0b00111100]);
});

test('M2 bits reject invalid width, out-of-range values and short reads', () => {
  const writer = new BitWriter();
  assert.throws(() => writer.write(8, 3), errorCode('INVALID_INPUT'));
  assert.throws(() => writer.write(-1, 3), errorCode('INVALID_INPUT'));
  assert.throws(() => writer.write(1, 33), errorCode('INVALID_INPUT'));
  assert.throws(() => new BitReader(new Uint8Array([0]), 9), errorCode('INVALID_INPUT'));
  assert.throws(() => new BitReader('oops'), errorCode('INVALID_INPUT'));
  const reader = new BitReader(new Uint8Array(1));
  assert.throws(() => reader.read(0), errorCode('INVALID_INPUT'));
  assert.throws(() => reader.read(9), errorCode('UNEXPECTED_EOF'));
});

test('M2 fixed-width profiles support empty/odd counts', () => {
  for (const bits of [2, 3]) for (const count of [0, 1, 2, 3, 5, 7, 8, 9, 31]) {
    const values = Array.from({ length: count }, (_, i) => i % (2 ** bits));
    const packed = packIndices(values, bits);
    assert.equal(packed.bitLength, count * bits);
    assert.deepEqual(unpackIndices(packed.bytes, bits, count), values);
  }
});

test('M2 fixed-width decoder rejects unexpected lengths and nonzero trailing pad', () => {
  assert.throws(() => unpackIndices(Uint8Array.of(0xff), 3, 1), errorCode('INVALID_PADDING'));
  assert.throws(() => unpackIndices(Uint8Array.of(0x80, 0x00), 3, 1), errorCode('INVALID_INPUT'));
  assert.throws(() => unpackIndices(new Uint8Array(), 3, 1), errorCode('INVALID_INPUT'));
  assert.throws(() => packIndices([8], 3), errorCode('INVALID_INPUT'));
});

test('M2 UTF-8 roundtrip and defensive byte clone', () => {
  const message = 'Hello, OmniMatrix 💠 日本語';
  const encoded = toBytes(message);
  assert.equal(fromUtf8(encoded), message);
  const source = Uint8Array.of(1, 2, 3);
  const cloned = toBytes(source);
  source[0] = 9;
  assert.deepEqual([...cloned], [1, 2, 3]);
  assert.throws(() => fromUtf8(Uint8Array.of(0xc0, 0xaf)), errorCode('INVALID_INPUT'));
  assert.throws(() => toBytes(123), errorCode('INVALID_INPUT'));
});

test('M2 byte concatenation is exact and not aliased', () => {
  const a = Uint8Array.of(1, 2);
  const joined = concatBytes(a, new Uint8Array(), Uint8Array.of(3, 4));
  a[0] = 90;
  assert.deepEqual([...joined], [1, 2, 3, 4]);
  assert.deepEqual([...concatBytes()], []);
  assert.throws(() => concatBytes(123), errorCode('INVALID_INPUT'));
});

test('M2 unsigned uint32 big-endian read/write', () => {
  const buf = new Uint8Array(6);
  for (const value of [0, 1, 0x12345678, 0xffffffff]) {
    writeU32BE(buf, 1, value);
    assert.equal(readU32BE(buf, 1), value);
  }
  assert.throws(() => writeU32BE(buf, 1, -1), errorCode('INVALID_INPUT'));
  assert.throws(() => writeU32BE(buf, 1, 0x100000000), errorCode('INVALID_INPUT'));
  assert.throws(() => readU32BE(buf, 3), errorCode('UNEXPECTED_EOF'));
});

test('M2 tagged research symbol is reproducible and identical to M1 lattice', () => {
  const symbol = createResearchSymbol({ S: 96, palette: 'DENSE_8', seed: 0x4f4d });
  const old = buildLayout(96, 'DENSE_8', 0x4f4d);
  assert.equal(symbol.kind, 'research-pattern');
  assert.equal(symbol.formatDraft, 'M0.1');
  assert.equal(symbol.layout.dataCount, 10650);
  assert.deepEqual(symbol.layout.cells, old.cells);
  assert.equal(renderResearchSVG(symbol, 320), renderSVG(old, 320));
});

test('M2 research capacity is explicitly theoretical, and validates parity', () => {
  const sym = createResearchSymbol({ S: 96 });
  const estimate = getResearchCapacity(sym);
  assert.equal(estimate.kind, 'theoretical-estimate');
  assert.equal(estimate.maximumPayloadBytes, 3461);
  assert.throws(() => getResearchCapacity(sym, -1), errorCode('INVALID_INPUT'));
  assert.throws(() => getResearchCapacity(sym, 255), errorCode('INVALID_INPUT'));
});

test('M2 research creation validates shape, size, palette, and seed', () => {
  assert.throws(() => createResearchSymbol(null), errorCode('INVALID_INPUT'));
  assert.throws(() => createResearchSymbol({ S: 42 }), errorCode('INVALID_SIZE'));
  assert.throws(() => createResearchSymbol({ S: 96, palette: 'RAINBOW' }), errorCode('INVALID_PALETTE'));
  assert.throws(() => createResearchSymbol({ S: 96, seed: 1.7 }), errorCode('INVALID_INPUT'));
  assert.throws(() => renderResearchSVG(createResearchSymbol({ S: 96 }), 0), errorCode('INVALID_SIZE'));
});

test('M2 bootstrap header remains unchanged', () => {
  const hex = Buffer.from(makeHeader({ S: 96, palette: 1 })).toString('hex');
  assert.equal(hex, '4f4d11805200af85');
  assert.equal(readHeader(makeHeader({ S: 96, palette: 1 })).S, 96);
});
