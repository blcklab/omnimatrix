/** M19 optional detached-authenticity layer carried inside an ordinary OmniMatrix payload. */
const MAGIC = Uint8Array.of(0x4f, 0x4d, 0x58, 0x53); // OMXS
const HEADER = 16;
const SIGNATURE_BYTES = 64; // WebCrypto ECDSA P-256 is IEEE P1363 r||s
const MAX_PAYLOAD = 16 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal:true});
export interface SignedPayloadInput {
  readonly issuerId: string;
  readonly payload: Uint8Array;
  /** A P-256 private CryptoKey or EC P-256 private JWK. Never serialize keys into the symbol. */
  readonly privateKey: CryptoKey | JsonWebKey;
}
export interface ParsedSignedPayload {
  readonly version: 1;
  readonly algorithm: 'ES256';
  /** This is a self-asserted key identifier, not a trusted identity. */
  readonly issuerId: string;
  readonly payload: Uint8Array;
  readonly signature: Uint8Array;
}
export type SignatureVerification =
  | {readonly status:'verified'; readonly signed:ParsedSignedPayload}
  | {readonly status:'invalid-signature'; readonly signed:ParsedSignedPayload};
export type TrustVerification =
  | {readonly status:'trusted'; readonly signed:ParsedSignedPayload}
  | {readonly status:'unknown-issuer'; readonly signed:ParsedSignedPayload}
  | {readonly status:'invalid-signature'; readonly signed:ParsedSignedPayload};

function invalid(reason:string):never {throw new TypeError(`Invalid OmniMatrix signed payload: ${reason}`);}
function validateIssuer(issuer:string):Uint8Array {
  if(typeof issuer !== 'string'|| !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}$/.test(issuer)) invalid('issuerId must be 1–64 printable ASCII characters');
  return encoder.encode(issuer);
}
function validatePayload(payload:Uint8Array):void {
  if(!(payload instanceof Uint8Array)||payload.length>MAX_PAYLOAD) invalid('payload must be Uint8Array no larger than 16 MiB');
}
function subtle():SubtleCrypto {
  if(typeof crypto==='undefined'||!crypto.subtle) throw new Error('Web Crypto SubtleCrypto is required for ES256 signatures (secure context or Node 22+)');
  return crypto.subtle;
}
function looksCryptoKey(value:CryptoKey|JsonWebKey):value is CryptoKey {
  return !!value && typeof value==='object' && 'algorithm' in value && 'usages' in value && 'type' in value;
}
async function resolveKey(value:CryptoKey|JsonWebKey, operation:'sign'|'verify'):Promise<CryptoKey> {
  if(!value || typeof value !== 'object') invalid('missing key');
  if(looksCryptoKey(value)) {
    const algo=value.algorithm as {name?:string;namedCurve?:string};
    if(algo.name!=='ECDSA'||algo.namedCurve!=='P-256'||value.type!==(operation==='sign'?'private':'public')||!value.usages.includes(operation)) invalid('key must be an appropriate P-256 ECDSA key');
    return value;
  }
  if(value.kty !== 'EC'||value.crv !== 'P-256'||typeof value.x!=='string'||typeof value.y!=='string') invalid('JWK must contain a P-256 EC public point');
  if(operation==='sign' && typeof value.d!=='string') invalid('signing requires a P-256 private JWK');
  if(operation==='verify' && typeof value.d==='string') invalid('verify using a public JWK only; remove private parameters');
  try {
    return await subtle().importKey('jwk',value,{name:'ECDSA',namedCurve:'P-256'},false,[operation]);
  }catch {return invalid('invalid or incompatible P-256 JWK');}
}
/** Recognizes magic only; validate with parseSignedPayload before trusting any metadata. */
export function isSignedPayload(bytes:Uint8Array):boolean {
  return bytes instanceof Uint8Array && bytes.length>=4 && MAGIC.every((v,i)=>bytes[i]===v);
}
/** Parse signed bytes; does NOT establish authenticity or issuer trust. */
export function parseSignedPayload(bytes:Uint8Array):ParsedSignedPayload {
  if(!(bytes instanceof Uint8Array)||!isSignedPayload(bytes)) invalid('missing OMXS magic');
  if(bytes.length < HEADER + SIGNATURE_BYTES + 1) invalid('truncated header');
  if(bytes[4]!==1||bytes[5]!==1) invalid('unsupported version or algorithm');
  const issuerLength=bytes[6]!;
  if(issuerLength<1||issuerLength>64||bytes[7]!==0||bytes[12]!==0||bytes[13]!==0||bytes[14]!==0||bytes[15]!==0) invalid('invalid issuer length or reserved flags');
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const payloadLength=view.getUint32(8,false);
  if(payloadLength>MAX_PAYLOAD||HEADER+issuerLength+payloadLength+SIGNATURE_BYTES !== bytes.length) invalid('invalid lengths or trailing bytes');
  let issuerId:string;
  try {issuerId=decoder.decode(bytes.subarray(HEADER,HEADER+issuerLength));validateIssuer(issuerId);} catch {return invalid('invalid issuer encoding');}
  return {version:1,algorithm:'ES256',issuerId,payload:bytes.slice(HEADER+issuerLength,bytes.length-SIGNATURE_BYTES),signature:bytes.slice(bytes.length-SIGNATURE_BYTES)};
}
/** Creates an OMXS v1 signature envelope. The entire header, issuer id and payload are signed. */
export async function signPayload(input:SignedPayloadInput):Promise<Uint8Array> {
  if(!input||typeof input !== 'object') invalid('missing input');
  validatePayload(input.payload);
  const issuer=validateIssuer(input.issuerId);
  const key=await resolveKey(input.privateKey,'sign');
  const signedBytes=new Uint8Array(HEADER+issuer.length+input.payload.length);
  signedBytes.set(MAGIC);
  signedBytes[4]=1;signedBytes[5]=1;signedBytes[6]=issuer.length;
  new DataView(signedBytes.buffer).setUint32(8,input.payload.length,false);
  signedBytes.set(issuer,HEADER);
  signedBytes.set(input.payload,HEADER+issuer.length);
  const signature=new Uint8Array(await subtle().sign({name:'ECDSA',hash:'SHA-256'},key,signedBytes));
  if(signature.length!==SIGNATURE_BYTES) throw new Error('Expected P-256 ECDSA signature in 64-byte IEEE P1363 format');
  const result=new Uint8Array(signedBytes.length+signature.length);
  result.set(signedBytes);result.set(signature,signedBytes.length);
  return result;
}
/** Verifies authenticity against an explicitly supplied P-256 public key; does not establish trust. */
export async function verifySignedPayload(bytes:Uint8Array,publicKey:CryptoKey|JsonWebKey):Promise<SignatureVerification> {
  const signed=parseSignedPayload(bytes);
  const key=await resolveKey(publicKey,'verify');
  const valid=await subtle().verify({name:'ECDSA',hash:'SHA-256'},key,signed.signature,bytes.subarray(0,bytes.length-SIGNATURE_BYTES));
  return {status:valid?'verified':'invalid-signature',signed};
}
/** Only issuer IDs explicitly mapped to public keys can be trusted. No network lookup or implicit trust. */
export async function verifyTrustedSignedPayload(bytes:Uint8Array,issuers:ReadonlyMap<string,CryptoKey|JsonWebKey>):Promise<TrustVerification> {
  const signed=parseSignedPayload(bytes);
  if(!(issuers instanceof Map)) invalid('trusted issuers must be an explicit Map');
  const key=issuers.get(signed.issuerId);
  if(!key) return {status:'unknown-issuer',signed};
  const result=await verifySignedPayload(bytes,key);
  return {status:result.status==='verified'?'trusted':'invalid-signature',signed};
}
