import {sha256} from '@noble/hashes/sha2.js';
import {browserHaasCache,haasAssets,haasAssetKey,haasMarkerKey,haasManifestId,type HaasAsset,type HaasBundle} from './browser-haas-config';
import type {Segment} from './speech-client';

export type HaasProgress={file?:string;loaded?:number;total?:number;status?:string;message?:string;stage?:string;fraction?:number;processedUntil?:number;segments?:Segment[]};
export type HaasResult={segments:Segment[];executionDevice:'wasm';timings:Record<string,number>;retainedSeconds:number;removedSeconds:number;[key:string]:unknown};
const aborted=()=>new DOMException('ローカル文字起こしを中止しました。','AbortError');
const checkAbort=(signal:AbortSignal)=>{if(signal.aborted)throw aborted();};
const origin=()=>location.origin;

/** Verify bytes while streaming; large weights never need one extra hash-sized buffer. */
export async function verifyHaasAsset(response:Response,asset:HaasAsset,signal:AbortSignal,onProgress:(p:HaasProgress)=>void=()=>{}){
 checkAbort(signal);if(!response.ok||!response.body)throw Error(`${asset.id}を取得できません (${response.status})`);
 const reader=response.body.getReader(),hash=sha256.create();let loaded=0,last=0;
 try{
  for(;;){checkAbort(signal);const part=await reader.read();if(part.done)break;loaded+=part.value.byteLength;if(loaded>asset.bytes)throw Error(`${asset.id}のサイズが一致しません。`);hash.update(part.value);
   const now=performance.now();if(now-last>100||loaded===asset.bytes){last=now;onProgress({file:asset.id,loaded,total:asset.bytes,status:'progress'});}
  }
  checkAbort(signal);const digest=Array.from(hash.digest(),b=>b.toString(16).padStart(2,'0')).join('');
  if(loaded!==asset.bytes||digest!==asset.sha256)throw Error(`${asset.id}の整合性を確認できません。再導入してください。`);
  onProgress({file:asset.id,loaded,total:asset.bytes,status:'done'});
 }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}

/** Cache the verified response atomically per asset; never mark a partial bundle ready. */
export async function storeHaasAsset(cache:Pick<Cache,'match'|'put'|'delete'>,asset:HaasAsset,signal:AbortSignal,onProgress:(p:HaasProgress)=>void,assetOrigin:string,fetcher:typeof fetch=fetch){
 const key=haasAssetKey(asset,assetOrigin),old=await cache.match(key);
 if(old){try{await verifyHaasAsset(old,asset,signal,onProgress);return;}catch(error){checkAbort(signal);await cache.delete(key);}}
 checkAbort(signal);const response=await fetcher(asset.url,{signal,redirect:'follow'});
 if(!response.ok)throw Error(`${asset.id}を取得できません (${response.status})`);
 const headers=new Headers({'Content-Type':asset.id.startsWith('ort')&&asset.id!=='ortWasm'?'text/javascript':asset.id==='ortWasm'?'application/wasm':'application/octet-stream'});
 const validation=verifyHaasAsset(response.clone(),asset,signal,onProgress);
 const stored=cache.put(key,new Response(response.body,{status:200,headers}));
 const results=await Promise.allSettled([validation,stored]);
 const failed=results.find((r):r is PromiseRejectedResult=>r.status==='rejected');
 if(failed){await cache.delete(key);throw failed.reason;}
 checkAbort(signal);
}

export async function browserHaasInstalled(kind:HaasBundle='haas'){
 if(!globalThis.caches)return false;
 try{const cache=await caches.open(browserHaasCache),entry=await cache.match(haasMarkerKey(kind,origin()));if(!entry)return false;
  const manifest=await entry.json();if(manifest.schema!==1||manifest.id!==haasManifestId(kind))return false;
  return (await Promise.all(haasAssets(kind).map(a=>cache.match(haasAssetKey(a,origin()))))).every(Boolean);
 }catch{return false;}
}
export async function browserHaasCached(kind:HaasBundle='haas'){
 if(!globalThis.caches)return false;
 try{const cache=await caches.open(browserHaasCache);return (await Promise.all(haasAssets(kind).map(a=>cache.match(haasAssetKey(a,origin()))))).some(Boolean);}catch{return false;}
}
export async function removeBrowserHaas(kind:HaasBundle='haas'){
 if(!globalThis.caches)throw Error('このブラウザーではモデルを管理できません。');
 const cache=await caches.open(browserHaasCache);let count=0;
 for(const asset of haasAssets(kind))if(await cache.delete(haasAssetKey(asset,origin())))count++;
 await cache.delete(haasMarkerKey(kind,origin()));return count;
}
export async function installBrowserHaas(kind:HaasBundle,signal:AbortSignal,onProgress:(p:HaasProgress)=>void){
 if(!globalThis.caches)throw Error('このブラウザーではモデルを保存できません。');
 const cache=await caches.open(browserHaasCache);checkAbort(signal);await cache.delete(haasMarkerKey(kind,origin()));
 const estimate=await navigator.storage?.estimate?.();let required=0;
 for(const asset of haasAssets(kind))if(!await cache.match(haasAssetKey(asset,origin())))required+=asset.bytes;
 if(estimate?.quota&&estimate.usage!==undefined&&estimate.quota-estimate.usage<required)throw Error(`モデルの保存領域が不足しています。約${Math.ceil(required/1e6)} MBを確保してください。`);
 for(const asset of haasAssets(kind))await storeHaasAsset(cache,asset,signal,onProgress,origin());
 checkAbort(signal);await cache.put(haasMarkerKey(kind,origin()),new Response(JSON.stringify({schema:1,id:haasManifestId(kind),installedAt:new Date().toISOString()}),{headers:{'Content-Type':'application/json'}}));
}

export class BrowserHaas {
 private worker:Worker|null=null;private urls:string[]=[];private sequence=0;private prepared:string='';
 private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:unknown)=>void;progress?:(p:HaasProgress)=>void}>();
 private shutdown(error:unknown=aborted()){
  this.worker?.terminate();this.worker=null;this.prepared='';for(const url of this.urls)URL.revokeObjectURL(url);this.urls=[];
  for(const request of this.pending.values())request.reject(error);this.pending.clear();
 }
 stop(){this.shutdown();}
 private call(action:string,value:Record<string,unknown>,progress?:(p:HaasProgress)=>void,transfer:Transferable[]=[]){
  if(!this.worker)throw Error('Silero＋Haasが準備されていません。');
  return new Promise<any>((resolve,reject)=>{const id=++this.sequence;this.pending.set(id,{resolve,reject,progress});this.worker!.postMessage({id,action,...value},transfer);});
 }
 async prepare(signal:AbortSignal,onProgress:(p:HaasProgress)=>void,diarize=false){
  checkAbort(signal);const key=diarize?'diarized':'plain';if(this.worker&&this.prepared===key)return;
  this.stop();if(!await browserHaasInstalled('haas'))throw Error('Silero VAD＋Haasを先に導入してください。');
  if(diarize&&!await browserHaasInstalled('nemotron'))throw Error('Nemotron 3 Diarizationを先に導入してください。');
  const cancel=()=>this.stop();signal.addEventListener('abort',cancel,{once:true});
  try{
   const cache=await caches.open(browserHaasCache),assets:Record<string,string>={};
   for(const asset of [...haasAssets('haas'),...(diarize?haasAssets('nemotron'):[])]){
    checkAbort(signal);const response=await cache.match(haasAssetKey(asset,origin()));if(!response)throw Error(`${asset.id}のキャッシュがありません。再導入してください。`);
    const url=URL.createObjectURL(await response.blob());this.urls.push(url);assets[asset.id]=url;
   }
   checkAbort(signal);this.worker=new Worker(new URL('/browser-haas-worker.js',origin()),{type:'module'});
   this.worker.onmessage=({data})=>{const request=this.pending.get(data.id);if(!request)return;if(data.progress){request.progress?.(data.progress);return;}this.pending.delete(data.id);data.error?request.reject(Error(data.error)):request.resolve(data.result);};
   this.worker.onerror=()=>this.shutdown(Error('ローカル文字起こしの実行環境でエラーが発生しました。'));
   await this.call('load',{runtime:{module:assets.ortModule,mjs:assets.ortMjs,wasm:assets.ortWasm},assets,diarize},onProgress);
   checkAbort(signal);this.prepared=key;
  }catch(error){this.stop();throw error;}finally{signal.removeEventListener('abort',cancel);}
 }
 async recognize(audio:Float32Array,bounds:{from:number;to:number;diarize:boolean},signal:AbortSignal,onProgress:(p:HaasProgress)=>void,onSegments?:(segments:Segment[],processedUntil:number)=>void):Promise<HaasResult>{
  checkAbort(signal);const cancel=()=>this.stop();signal.addEventListener('abort',cancel,{once:true});
  try{return await this.call('recognize',{audio,...bounds},p=>{onProgress(p);if(p.segments&&typeof p.processedUntil==='number')onSegments?.(p.segments,p.processedUntil);},[audio.buffer]);}
  finally{signal.removeEventListener('abort',cancel);}
 }
}
