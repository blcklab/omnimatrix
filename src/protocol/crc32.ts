import { OmniMatrixError } from '../core/errors.js';

/** CRC-32/ISO-HDLC, also called CRC-32/ADCCP (poly 0x04C11DB7, reflected 0xEDB88320). */
export function crc32IsoHdlc(bytes: Uint8Array): number {
  if (!(bytes instanceof Uint8Array)) {
    throw new OmniMatrixError('INVALID_INPUT', 'CRC-32 input must be Uint8Array');
  }
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
