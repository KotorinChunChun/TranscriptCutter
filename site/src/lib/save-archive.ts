export type ArchiveFile={name:string;blob:Blob};
const encoder=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let bit=0;bit<8;bit++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
function record(size:number,signature:number){const bytes=new Uint8Array(size),view=new DataView(bytes.buffer);view.setUint32(0,signature,true);return {bytes,view};}
/** Store ZIP64 entries without buffering an entire media file in a JS array. */
export async function createSaveArchive(files:readonly ArchiveFile[],signal?:AbortSignal,onProgress?:(fraction:number)=>void):Promise<Blob>{
 signal?.throwIfAborted();
 const names=new Set<string>();
 for(const file of files){
  if(!file.name||/^[\\/]|^[A-Za-z]:|[\u0000-\u001f]/.test(file.name)||file.name.split(/[\\/]/).includes('..')||file.name.includes('\\')||names.has(file.name)||encoder.encode(file.name).length>65535)throw Error('保存ファイル名が不正または重複しています。');
  names.add(file.name);
 }
 const parts:BlobPart[]=[],central:Uint8Array<ArrayBuffer>[]=[];
 let offset=0n,completed=0,lastProgress=0;
 const total=files.reduce((sum,file)=>sum+file.blob.size,0);
 for(const file of files){
  signal?.throwIfAborted();
  let crc=0xffffffff;
  const reader=file.blob.stream().getReader();
  try{while(true){signal?.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;for(const byte of chunk.value)crc=(crc>>>8)^crcTable[(crc^byte)&255];completed+=chunk.value.length;if(Date.now()-lastProgress>100){lastProgress=Date.now();onProgress?.(total?completed/total:1);}}}
  finally{if(signal?.aborted)await reader.cancel();reader.releaseLock();}
  signal?.throwIfAborted();crc=(crc^0xffffffff)>>>0;
  const name=encoder.encode(file.name),size=BigInt(file.blob.size);
  const local=record(30+name.length+20,0x04034b50),l=local.view;
  l.setUint16(4,45,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true);l.setUint32(14,crc,true);l.setUint32(18,0xffffffff,true);l.setUint32(22,0xffffffff,true);l.setUint16(26,name.length,true);l.setUint16(28,20,true);local.bytes.set(name,30);
  const le=30+name.length;l.setUint16(le,1,true);l.setUint16(le+2,16,true);l.setBigUint64(le+4,size,true);l.setBigUint64(le+12,size,true);
  const entry=record(46+name.length+28,0x02014b50),c=entry.view;
  c.setUint16(4,45,true);c.setUint16(6,45,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,0xffffffff,true);c.setUint32(24,0xffffffff,true);c.setUint16(28,name.length,true);c.setUint16(30,28,true);c.setUint32(42,0xffffffff,true);entry.bytes.set(name,46);
  const ce=46+name.length;c.setUint16(ce,1,true);c.setUint16(ce+2,24,true);c.setBigUint64(ce+4,size,true);c.setBigUint64(ce+12,size,true);c.setBigUint64(ce+20,offset,true);
  central.push(entry.bytes);parts.push(local.bytes,file.blob);offset+=BigInt(local.bytes.length)+size;
 }
 const directoryStart=offset,directorySize=central.reduce((sum,bytes)=>sum+BigInt(bytes.length),0n);
 parts.push(...central);
 const end64=record(56,0x06064b50),e=end64.view;
 e.setBigUint64(4,44n,true);e.setUint16(12,45,true);e.setUint16(14,45,true);e.setBigUint64(24,BigInt(files.length),true);e.setBigUint64(32,BigInt(files.length),true);e.setBigUint64(40,directorySize,true);e.setBigUint64(48,directoryStart,true);
 const locator=record(20,0x07064b50);locator.view.setBigUint64(8,directoryStart+directorySize,true);locator.view.setUint32(16,1,true);
 const end=record(22,0x06054b50);end.view.setUint16(8,0xffff,true);end.view.setUint16(10,0xffff,true);end.view.setUint32(12,0xffffffff,true);end.view.setUint32(16,0xffffffff,true);
 signal?.throwIfAborted();parts.push(end64.bytes,locator.bytes,end.bytes);onProgress?.(1);
 return new Blob(parts,{type:'application/zip'});
}
