/** Node-only research output adapter; the library core stays runtime-neutral. */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
function crc32(buffer) {
  let crc=0xffffffff;
  for(const byte of buffer){crc ^= byte;for(let j=0;j<8;j++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
  return (crc^0xffffffff)>>>0;
}
function chunk(tag,data){
  const n=Buffer.alloc(4);n.writeUInt32BE(data.length,0);
  const tb=Buffer.from(tag,'ascii');
  const check=Buffer.alloc(4);check.writeUInt32BE(crc32(Buffer.concat([tb,data])));
  return Buffer.concat([n,tb,data,check]);
}
export function writePng(filename,image){
  const {width,height,data}=image;
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
  const raw=Buffer.alloc(height*(width*3+1));
  for(let y=0;y<height;y++) raw.set(data.subarray(y*width*3,(y+1)*width*3), y*(width*3+1)+1);
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:6})),chunk('IEND',Buffer.alloc(0))]);
  writeFileSync(filename,png);
}
