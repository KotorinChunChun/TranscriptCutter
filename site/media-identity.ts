import {sha256} from '@noble/hashes/sha2.js';
import type {Job} from './speech-client';
export async function hashMedia(file:Blob,signal?:AbortSignal,onProgress?:(fraction:number)=>void){
 const hash=sha256.create(),size=4*1024*1024;
 try{for(let offset=0;offset<file.size;offset+=size){signal?.throwIfAborted();hash.update(new Uint8Array(await file.slice(offset,offset+size).arrayBuffer()));onProgress?.(Math.min(1,(offset+size)/file.size));await new Promise(r=>setTimeout(r,0));}signal?.throwIfAborted();return [...hash.digest()].map(b=>b.toString(16).padStart(2,'0')).join('');}finally{hash.destroy();}
}
export function sourceIdentity(job:Job|null){
 if(!job)return null;const m=job.metadata??{};const hash=job.sourceSha256??m.mediaSha256??m.sourceSha256;const bytes=job.sourceBytes??m.mediaBytes??m.sourceBytes;
 return typeof hash==='string'&&/^[a-f0-9]{64}$/i.test(hash)?{sha256:hash.toLowerCase(),bytes:typeof bytes==='number'&&Number.isSafeInteger(bytes)&&bytes>=0?bytes:null}:null;
}
export function matchesSource(job:Job|null,hash:string,size:number){const expected=sourceIdentity(job);return !!expected&&expected.sha256===hash&&(expected.bytes===null||expected.bytes===size);}
