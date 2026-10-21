/** M20 optional password-based authenticated encryption. Optical encoding stays unchanged.
 *
 * OMXC v1 wire format (network byte order):
 * [0..3] magic OMXC; [4] version=1; [5] AES-256-GCM=1; [6] PBKDF2-SHA256=1;
 * [7] flags=0; [8..11] iterations; [12..27] 128-bit salt; [28..39] 96-bit IV;
 * [40..43] plaintext length; [44..] ciphertext || 128-bit GCM authentication tag.
 * The entire header is authenticated as additionalData, including length and parameters.
 */
const MAGIC = Uint8Array.of(0x4f, 0x4d, 0x58, 0x43); // OMXC
const HEADER = 44;
const TAG = 16;
const SALT = 16;
const IV = 12;
const MIN_ITERATIONS = 210_000;
const DEFAULT_ITERATIONS = 310_000;
const MAX_ITERATIONS = 1_000_000;
const MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024;
const textEncoder = new TextEncoder();

export interface EncryptPayloadInput {
  readonly payload: Uint8Array;
  /** Not stored in the encoded symbol. Use a long, unique, unpredictable password. */
  readonly password: string;
  /** Explicitly bounded to prevent creating unreasonably expensive symbols. */
  readonly iterations?: number;
}
export interface EncryptedPayloadInfo {
  readonly version: 1;
  readonly algorithm: 'AES-256-GCM';
  readonly kdf: 'PBKDF2-SHA256';
  readonly iterations: number;
  readonly payloadBytes: number;
  readonly ciphertextBytes: number;
}

function malformed(detail: string): never {throw new TypeError(`Invalid OmniMatrix encrypted payload: ${detail}`);}
function subtle(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Web Crypto is required for OmniMatrix encryption (secure browser context or modern Node)');
  }
  return crypto.subtle;
}
function encodePassword(password: string): Uint8Array {
  if (typeof password !== 'string') throw new TypeError('Encryption password must be a string');
  const bytes = textEncoder.encode(password);
  if (bytes.length < 12 || bytes.length > 1024) throw new RangeError('Password must contain 12–1024 UTF-8 bytes; use a long, unique passphrase');
  return bytes;
}
function validIterations(value: number): boolean {
  return Number.isSafeInteger(value) && value >= MIN_ITERATIONS && value <= MAX_ITERATIONS;
}
function validateBytes(value: Uint8Array): void {
  if (!(value instanceof Uint8Array) || value.byteLength > MAX_PLAINTEXT_BYTES) {
    throw new TypeError('Payload must be Uint8Array no larger than 16 MiB');
  }
}
async function derive(password: string, salt: Uint8Array, iterations: number, usages: KeyUsage[]): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', encodePassword(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({name: 'PBKDF2', salt: salt.slice(), iterations, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, usages);
}
/** Checks the distinctive magic only; parseEncryptedPayload validates all lengths/fields. */
export function isEncryptedPayload(data: Uint8Array): boolean {
  return data instanceof Uint8Array && data.byteLength >= MAGIC.length && MAGIC.every((x,i) => data[i] === x);
}
/** Parses *untrusted* metadata without decrypting or authenticating it. */
export function parseEncryptedPayload(data: Uint8Array): EncryptedPayloadInfo {
  if (!(data instanceof Uint8Array) || !isEncryptedPayload(data)) malformed('missing OMXC magic');
  if (data.byteLength < HEADER + TAG) malformed('truncated frame or authentication tag');
  if (data[4] !== 1 || data[5] !== 1 || data[6] !== 1 || data[7] !== 0) malformed('unsupported version, cipher, KDF or flags');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const iterations = dv.getUint32(8, false);
  const payloadBytes = dv.getUint32(40, false);
  if (!validIterations(iterations)) malformed('PBKDF2 work factor out of supported bounds');
  if (payloadBytes > MAX_PLAINTEXT_BYTES || data.byteLength !== HEADER + payloadBytes + TAG) malformed('invalid or inconsistent payload length');
  return {version:1, algorithm:'AES-256-GCM', kdf:'PBKDF2-SHA256', iterations, payloadBytes, ciphertextBytes:payloadBytes+TAG};
}
/** Encrypts with a random salt and random 96-bit IV. Never reuses or embeds the password. */
export async function encryptPayload(input: EncryptPayloadInput): Promise<Uint8Array> {
  if (!input || typeof input !== 'object') throw new TypeError('Encryption input is required');
  validateBytes(input.payload);
  const iterations = input.iterations ?? DEFAULT_ITERATIONS;
  if (!validIterations(iterations)) throw new RangeError(`PBKDF2 iterations must be ${MIN_ITERATIONS}–${MAX_ITERATIONS}`);
  const wc = subtle();
  const salt = crypto.getRandomValues(new Uint8Array(SALT));
  const iv = crypto.getRandomValues(new Uint8Array(IV));
  const key = await derive(input.password, salt, iterations, ['encrypt']);
  const header = new Uint8Array(HEADER);
  header.set(MAGIC);
  header[4] = 1; header[5] = 1; header[6] = 1;
  const dv = new DataView(header.buffer);
  dv.setUint32(8, iterations, false);
  header.set(salt, 12);
  header.set(iv, 28);
  dv.setUint32(40, input.payload.byteLength, false);
  const encrypted = new Uint8Array(await wc.encrypt({name:'AES-GCM', iv, additionalData:header, tagLength:128}, key, input.payload));
  if (encrypted.byteLength !== input.payload.byteLength + TAG) throw new Error('Unexpected AES-GCM authentication tag length');
  const result = new Uint8Array(header.byteLength + encrypted.byteLength);
  result.set(header);result.set(encrypted, HEADER);
  return result;
}
/** Authenticates the header and ciphertext before releasing any plaintext.
 * Incorrect password, altered ciphertext/tag, and altered-but-parseable header all fail closed.
 */
export async function decryptPayload(data: Uint8Array, password: string): Promise<Uint8Array> {
  parseEncryptedPayload(data);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const salt = data.slice(12,28);
  const iv = data.slice(28,40);
  const key = await derive(password, salt, dv.getUint32(8, false), ['decrypt']);
  try {
    const plain = new Uint8Array(await subtle().decrypt({name:'AES-GCM', iv, additionalData:data.slice(0,HEADER), tagLength:128}, key, data.slice(HEADER)));
    if (plain.byteLength !== dv.getUint32(40,false)) malformed('decrypted length mismatch');
    return plain;
  } catch {
    throw new Error('Decryption failed: incorrect password or encrypted data has been modified');
  }
}
