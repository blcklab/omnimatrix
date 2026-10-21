import { encodePayloadFrame, decodePayloadFrame, padPayloadFrame } from '@blcklab/omnimatrix';
const input = new TextEncoder().encode('Hello from OmniMatrix M3 — offline binary frame.');
const frame = encodePayloadFrame(input, { maxFrameBytes: 1000 });
const decoded = decodePayloadFrame(frame);
const padded = padPayloadFrame(frame, 255);
const recovered = decodePayloadFrame(padded, { allowZeroPadding: true, maxFrameBytes: 255 });
console.log(JSON.stringify({
  inputBytes: input.length, frameBytes: frame.length,
  message: new TextDecoder().decode(decoded.data),
  crc32Hex: decoded.header.crc32.toString(16).padStart(8, '0'),
  paddedBytes: padded.length, paddedRecoveryMatches: Buffer.from(recovered.data).equals(Buffer.from(input)),
  warning: 'Binary framing only. No RS parity, color mapping, or optical payload scanning in M3.',
}, null, 2));
