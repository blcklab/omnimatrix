import { protectPayload, recoverPayload, getRsLayout } from '@blcklab/omnimatrix';

const bytes = Uint8Array.from({ length: 4096 }, (_, i) => (i * 83 + Math.floor(i / 17) * 41) & 255);
// M0.1 S112 DENSE_8 encodes 5,427 RS bytes, K_total=4,723, 4,703 raw payload bytes.
const capacity = 5427;
const protectedFrame = protectPayload(bytes, capacity, 'MEDIUM');
const damaged = protectedFrame.encoded.slice();
// Artificial spread-out byte errors; not a simulation of camera classification.
for (let i = 0; i < 32; i++) damaged[i * 127 + 5] ^= (i * 19 + 1) & 255;
const decoded = recoverPayload(damaged, 'MEDIUM');
if (Buffer.compare(bytes, decoded.payload) !== 0) throw Error('RS recovery failed');
console.log('OMD1 + RS recovery: PASS');
console.log({ payloadBytes: bytes.length, encodedBytes: damaged.length,
  blocks: getRsLayout(capacity).blockCount, correctedSymbols: decoded.correctedSymbols,
  correctedBlocks: decoded.correctedBlocks });
console.log('No optical data mapping or camera payload scan is implemented yet.');
