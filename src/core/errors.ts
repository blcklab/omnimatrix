/** Stable error shape for new M2 APIs; M1 research helpers retain their historical exceptions. */
export type OmniMatrixErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_SIZE'
  | 'INVALID_PALETTE'
  | 'UNEXPECTED_EOF'
  | 'INVALID_PADDING'
  | 'UNSUPPORTED_VERSION'
  | 'CAPACITY_EXCEEDED'
  | 'INVALID_FRAME'
  | 'INVALID_GEOMETRY'
  | 'INVALID_HEADER'
  | 'UNSUPPORTED_MASK'
  | 'UNSUPPORTED_COMPRESSION'
  | 'CRC_MISMATCH'
  | 'ECC_UNRECOVERABLE';

export class OmniMatrixError extends Error {
  override readonly name = 'OmniMatrixError';
  constructor(readonly code: OmniMatrixErrorCode, message: string) {
    super(message);
  }
}
