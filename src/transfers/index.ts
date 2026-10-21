/** M22: optional, self-contained multisymbol transport. Independent of the M0.1 optical format. */
import {crc32IsoHdlc} from '../protocol/crc32.js';

const MAGIC=Uint8Array.of(0x4f,0x4d,0x58,0x54); // OMXT
const HEADER=80;
const MAX_TOTAL=16*1024*1024;
const MAX_CHUNKS=4096;
const MIN_CHUNK=128;
const MAX_CHUNK=4096;
const subtle=()=>{if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required (HTTPS or localhost)');return globalThis.crypto.subtle;};
function bad(reason:string):never {throw new TypeError(`Invalid OmniMatrix transfer: ${reason}`);}
function hashId(bytes:Uint8Array):string {return [...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');}
function assertBytes(bytes:Uint8Array):void {if(!(bytes instanceof Uint8Array))bad('Uint8Array required');}
function same(a:Uint8Array,b:Uint8Array):boolean {return a.length===b.length&&a.every((n,i)=>n===b[i]);}
export interface TransferCreateOptions {readonly chunkBytes?:number; readonly transferId?:Uint8Array;}
export interface TransferChunk {readonly version:1; readonly transferId:string; readonly index:number; readonly count:number; readonly chunkBytes:number; readonly totalBytes:number; readonly digest:Uint8Array; readonly data:Uint8Array;}
export interface TransferProgress {readonly transferId:string|null;readonly received:number;readonly total:number;readonly bytesReceived:number;readonly totalBytes:number;readonly missing:number[];readonly completed:boolean;}
export type TransferAcceptance={readonly status:'added'|'duplicate'|'complete';readonly progress:TransferProgress;readonly payload?:Uint8Array};
export function isTransferChunk(bytes:Uint8Array):boolean {return bytes instanceof Uint8Array&&bytes.length>=4&&MAGIC.every((n,i)=>n===bytes[i]);}
/** Encode independently scannable OMXT v1 chunks; SHA-256 protects the fully reassembled bytes. */
export async function createTransferChunks(data:Uint8Array,options:TransferCreateOptions={}):Promise<Uint8Array[]> {
  assertBytes(data);
  if(data.length<1||data.length>MAX_TOTAL)bad('payload must be between 1 and 16 MiB');
  const chunkBytes=options.chunkBytes??2048;
  if(!Number.isInteger(chunkBytes)||chunkBytes<MIN_CHUNK||chunkBytes>MAX_CHUNK)bad('chunkBytes must be 128..4096');
  const count=Math.ceil(data.length/chunkBytes);
  if(count>MAX_CHUNKS)bad('too many chunks (maximum 4096)');
  const transferId=options.transferId?Uint8Array.from(options.transferId):new Uint8Array(16);
  if(options.transferId && (!(options.transferId instanceof Uint8Array)||options.transferId.length!==16))bad('transferId must be 16 bytes');
  if(!options.transferId){if(!globalThis.crypto?.getRandomValues)bad('secure random generator required');globalThis.crypto.getRandomValues(transferId);}
  const digest=new Uint8Array(await subtle().digest('SHA-256',data));
  const chunks:Uint8Array[]=[];
  for(let i=0;i<count;i++){
    const body=data.subarray(i*chunkBytes,Math.min(data.length,(i+1)*chunkBytes));
    const chunk=new Uint8Array(HEADER+body.length),view=new DataView(chunk.buffer);
    chunk.set(MAGIC,0);chunk[4]=1;chunk[5]=0;view.setUint16(6,HEADER,false);
    chunk.set(transferId,8);view.setUint16(24,i,false);view.setUint16(26,count,false);
    view.setUint16(28,chunkBytes,false);view.setUint16(30,0,false);view.setUint32(32,data.length,false);
    view.setUint16(36,body.length,false);view.setUint16(38,0,false);chunk.set(digest,40);
    view.setUint32(72,crc32IsoHdlc(body),false);
    view.setUint32(76,crc32IsoHdlc(chunk.subarray(0,76)),false);
    chunk.set(body,HEADER);chunks.push(chunk);
  }
  return chunks;
}
/** Parse and strictly validate a single chunk. Header and body CRCs are not cryptographic authentication. */
export function parseTransferChunk(input:Uint8Array):TransferChunk {
  assertBytes(input);if(!isTransferChunk(input))bad('OMXT magic missing');if(input.length<HEADER)bad('truncated chunk header');
  const view=new DataView(input.buffer,input.byteOffset,input.byteLength);
  if(input[4]!==1||input[5]!==0||view.getUint16(6,false)!==HEADER)bad('unsupported version or flags');
  if(view.getUint16(30,false)!==0||view.getUint16(38,false)!==0)bad('reserved fields must be zero');
  const index=view.getUint16(24,false),count=view.getUint16(26,false),chunkBytes=view.getUint16(28,false);
  const totalBytes=view.getUint32(32,false),dataLength=view.getUint16(36,false);
  if(!Number.isInteger(chunkBytes)||chunkBytes<MIN_CHUNK||chunkBytes>MAX_CHUNK||count<1||count>MAX_CHUNKS||index>=count)bad('invalid chunk geometry');
  if(totalBytes<1||totalBytes>MAX_TOTAL||Math.ceil(totalBytes/chunkBytes)!==count)bad('invalid transfer length or count');
  const expectedLength=Math.min(chunkBytes,totalBytes-index*chunkBytes);
  if(expectedLength<=0||dataLength!==expectedLength||input.length!==HEADER+dataLength)bad('invalid chunk data length');
  if(crc32IsoHdlc(input.subarray(0,76))!==view.getUint32(76,false))bad('header CRC-32 mismatch');
  const body=input.subarray(HEADER);
  if(crc32IsoHdlc(body)!==view.getUint32(72,false))bad('chunk CRC-32 mismatch');
  return {version:1,transferId:hashId(input.subarray(8,24)),index,count,chunkBytes,totalBytes,digest:input.slice(40,72),data:body.slice()};
}
/** Collect out-of-order chunks, reject mismatched transfers/conflicting duplicates; never expose partial data. */
export class TransferCollector {
  private chunks=new Map<number,Uint8Array>();
  private first:TransferChunk|null=null;
  private complete:Uint8Array|null=null;
  reset():void {this.chunks.clear();this.first=null;this.complete=null;}
  progress():TransferProgress {
    const a=this.first;
    return {transferId:a?.transferId??null,received:this.chunks.size,total:a?.count??0,bytesReceived:[...this.chunks.values()].reduce((n,b)=>n+b.byteLength,0),totalBytes:a?.totalBytes??0,
      missing:a?Array.from({length:a.count},(_,i)=>i).filter(i=>!this.chunks.has(i)):[],completed:this.complete!==null};
  }
  async add(input:Uint8Array):Promise<TransferAcceptance> {
    const c=parseTransferChunk(input),a=this.first;
    if(a && (c.transferId!==a.transferId||c.count!==a.count||c.chunkBytes!==a.chunkBytes||c.totalBytes!==a.totalBytes||!same(c.digest,a.digest)))bad('chunk belongs to a different transfer or has conflicting metadata');
    const existing=this.chunks.get(c.index);
    if(existing){if(!same(existing,c.data))bad('conflicting duplicate chunk');return {status:this.complete?'complete':'duplicate',progress:this.progress(),...(this.complete?{payload:this.complete.slice()}:{})};}
    if(this.complete)bad('transfer already completed');
    if(!this.first)this.first=c;
    this.chunks.set(c.index,c.data);
    if(this.chunks.size<c.count)return {status:'added',progress:this.progress()};
    const assembled=new Uint8Array(c.totalBytes);let offset=0;
    for(let i=0;i<c.count;i++){const data=this.chunks.get(i);if(!data)bad('missing chunk');assembled.set(data,offset);offset+=data.length;}
    const digest=new Uint8Array(await subtle().digest('SHA-256',assembled));
    if(!same(digest,c.digest)){this.chunks.delete(c.index);bad('reassembled SHA-256 mismatch');}
    this.complete=assembled;
    return {status:'complete',progress:this.progress(),payload:assembled.slice()};
  }
}
