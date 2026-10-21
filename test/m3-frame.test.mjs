import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crc32IsoHdlc, encodePayloadFrame, readPayloadFrameHeader, decodePayloadFrame,
  requiredPayloadFrameBytes, padPayloadFrame, fromUtf8, OmniMatrixError,
  PAYLOAD_FRAME_HEADER_BYTES, PAYLOAD_FRAME_MAGIC,
} from '@blcklab/omnimatrix';

const withCode = (code) => (error) => error instanceof OmniMatrixError && error.code === code;
function mutate(data, at, value) { const copy = data.slice(); copy[at] = value; return copy; }
const fixture = (length) => Uint8Array.from({ length }, (_, i) => (Math.imul(i, 37) + (i >>> 3) * 61 + 193) & 255);

test('M3 CRC-32/ISO-HDLC independent published vectors', () => {
  assert.equal(crc32IsoHdlc(new Uint8Array()), 0);
  assert.equal(crc32IsoHdlc(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32IsoHdlc(new TextEncoder().encode('hello world')), 0x0d4a1185);
  assert.throws(() => crc32IsoHdlc('wrong'), withCode('INVALID_INPUT'));
});

test('M3 OMD1 byte format golden vector for ASCII A and empty payload', () => {
  const a = encodePayloadFrame('A');
  assert.equal(Buffer.from(a).toString('hex'), '4f4d4431000000000000000100000001d3d99e8b41');
  const empty = encodePayloadFrame(new Uint8Array());
  assert.equal(Buffer.from(empty).toString('hex'), '4f4d443100000000000000000000000000000000');
  assert.equal(readPayloadFrameHeader(a).frameLength, 21);
  assert.equal(readPayloadFrameHeader(a).crc32, 0xd3d99e8b);
  assert.equal(PAYLOAD_FRAME_HEADER_BYTES, 20);
  assert.equal(PAYLOAD_FRAME_MAGIC, 'OMD1');
});

test('M3 arbitrary bytes, Unicode, zero bytes and long payloads roundtrip', () => {
  for (const data of ['', 'OmniMatrix 💠 日本語', new Uint8Array([0, 0xff, 0x80, 0, 1]),
    fixture(3000), fixture(4096), fixture(8192)]) {
    const raw = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const frame = encodePayloadFrame(data);
    const recovered = decodePayloadFrame(frame);
    assert.deepEqual(recovered.data, raw);
    assert.equal(recovered.header.originalLength, raw.length);
    assert.equal(recovered.header.storedLength, raw.length);
    assert.equal(recovered.paddingBytes, 0);
    assert.equal(frame.length, 20 + raw.length);
  }
  assert.equal(fromUtf8(decodePayloadFrame(encodePayloadFrame('🔵')).data), '🔵');
});

test('M3 decoder returns independent output, encoder snapshots source', () => {
  const source = Uint8Array.of(7, 9, 3);
  const frame = encodePayloadFrame(source);
  source[0] = 99;
  const decoded = decodePayloadFrame(frame);
  decoded.data[0] = 88;
  assert.deepEqual([...decodePayloadFrame(frame).data], [7, 9, 3]);
});

test('M3 uses exact frame length and zero-only optional padding for M4', () => {
  const frame = encodePayloadFrame('test');
  const padded = padPayloadFrame(frame, 255);
  assert.equal(padded.length, 255);
  assert.equal(frame.length, 24);
  assert.ok(padded.subarray(frame.length).every((x) => x === 0));
  assert.throws(() => decodePayloadFrame(padded), withCode('INVALID_FRAME'));
  assert.deepEqual(decodePayloadFrame(padded, { allowZeroPadding: true }).data, new TextEncoder().encode('test'));
  assert.equal(decodePayloadFrame(padded, { allowZeroPadding: true }).paddingBytes, 231);
  assert.throws(() => decodePayloadFrame(mutate(padded, 250, 2), { allowZeroPadding: true }), withCode('INVALID_PADDING'));
  assert.throws(() => padPayloadFrame(padded, 300), withCode('INVALID_FRAME'));
  assert.throws(() => padPayloadFrame(mutate(frame, 20, frame[20] ^ 1), 255), withCode('CRC_MISMATCH'));
  assert.throws(() => padPayloadFrame(frame, frame.length - 1), withCode('CAPACITY_EXCEEDED'));
  assert.deepEqual(padPayloadFrame(frame, frame.length), frame);
});

test('M3 rejects malformed header, incomplete body and unsupported compression', () => {
  const frame = encodePayloadFrame('abc');
  for (const length of [0, 1, 3, 7, 19]) {
    assert.throws(() => decodePayloadFrame(frame.subarray(0, length)), withCode('UNEXPECTED_EOF'));
  }
  assert.throws(() => decodePayloadFrame(mutate(frame, 0, 0)), withCode('INVALID_FRAME'));
  assert.throws(() => decodePayloadFrame(mutate(frame, 4, 1)), withCode('UNSUPPORTED_COMPRESSION'));
  assert.throws(() => decodePayloadFrame(mutate(frame, 4, 255)), withCode('UNSUPPORTED_COMPRESSION'));
  for (const byte of [5, 6, 7]) {
    assert.throws(() => decodePayloadFrame(mutate(frame, byte, 1)), withCode('INVALID_FRAME'));
  }
  assert.throws(() => decodePayloadFrame(frame.subarray(0, 22)), withCode('UNEXPECTED_EOF'));
  assert.throws(() => decodePayloadFrame(mutate(frame, 12, 1)), withCode('INVALID_FRAME'));
  assert.throws(() => decodePayloadFrame(mutate(frame, 19, frame[19] ^ 1)), withCode('CRC_MISMATCH'));
  assert.throws(() => decodePayloadFrame(mutate(frame, 20, frame[20] ^ 1)), withCode('CRC_MISMATCH'));
});

test('M3 bounded claims cannot exceed decoded layout capacity before copying', () => {
  const frame = encodePayloadFrame(fixture(1024));
  assert.equal(readPayloadFrameHeader(frame, { maxFrameBytes: frame.length }).frameLength, frame.length);
  assert.throws(() => encodePayloadFrame('abc', { maxFrameBytes: 22 }), withCode('CAPACITY_EXCEEDED'));
  assert.throws(() => decodePayloadFrame(frame, { maxFrameBytes: frame.length - 1 }), withCode('CAPACITY_EXCEEDED'));
  const malicious = frame.slice(0, 20);
  malicious.set([255, 255, 255, 255], 8);
  malicious.set([255, 255, 255, 255], 12);
  assert.throws(() => readPayloadFrameHeader(malicious, { maxFrameBytes: 4000 }), withCode('CAPACITY_EXCEEDED'));
  assert.throws(() => readPayloadFrameHeader(malicious), withCode('UNEXPECTED_EOF'));
});

test('M3 validates all boundary values and options', () => {
  for (const bad of [-1, NaN, Infinity, 1.5, 4294967296]) {
    assert.throws(() => requiredPayloadFrameBytes(bad), withCode('INVALID_SIZE'));
  }
  assert.equal(requiredPayloadFrameBytes(0), 20);
  assert.equal(requiredPayloadFrameBytes(0xffffffff), 0x100000013);
  for (const invalid of [-1, NaN, 1.2, '4']) {
    assert.throws(() => encodePayloadFrame('ok', { maxFrameBytes: invalid }), withCode('INVALID_INPUT'));
  }
  assert.throws(() => encodePayloadFrame('ok', { compression: 1 }), withCode('UNSUPPORTED_COMPRESSION'));
  assert.throws(() => encodePayloadFrame('ok', { compression: 12 }), withCode('UNSUPPORTED_COMPRESSION'));
  assert.throws(() => decodePayloadFrame(encodePayloadFrame('ok'), { allowZeroPadding: 'yes' }), withCode('INVALID_INPUT'));
  assert.throws(() => decodePayloadFrame(encodePayloadFrame('ok'), null), withCode('INVALID_INPUT'));
  assert.throws(() => encodePayloadFrame(42), withCode('INVALID_INPUT'));
  assert.throws(() => readPayloadFrameHeader('oops'), withCode('INVALID_INPUT'));
  assert.throws(() => padPayloadFrame(encodePayloadFrame('ok'), -1), withCode('INVALID_INPUT'));
});

test('M3 protocol subpath provides same APIs as root, independent of Node APIs', async () => {
  const { encodePayloadFrame: subpath, crc32IsoHdlc: subCrc } = await import('@blcklab/omnimatrix/protocol');
  assert.equal(subpath, encodePayloadFrame);
  assert.equal(subCrc, crc32IsoHdlc);
});

// Deterministic property-style stress on wide and uneven payload lengths.
test('M3 deterministic frame fuzz covers hundreds of lengths and integrity errors', () => {
  for (let i = 0; i < 200; i++) {
    const length = (Math.imul(i + 41, 7793) >>> 0) % 12000;
    const raw = fixture(length);
    const coded = encodePayloadFrame(raw, { maxFrameBytes: 12020 });
    assert.deepEqual(decodePayloadFrame(coded, { maxFrameBytes: 12020 }).data, raw);
    if (length > 0) {
      const broken = mutate(coded, 20 + ((i * 73) % length), coded[20 + ((i * 73) % length)] ^ 0x20);
      assert.throws(() => decodePayloadFrame(broken), withCode('CRC_MISMATCH'));
    }
  }
});
