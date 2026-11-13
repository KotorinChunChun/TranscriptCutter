import {ALL_FORMATS,Input,BlobSource,AudioBufferSink} from 'mediabunny';
import {browserWhisperModels,whisperCache,whisperRuntime,runtimeFiles,type BrowserWhisperModel} from './browser-whisper-config';
import {measure} from './processing-metrics';
import {isWhisperModelCacheUrl,removeWhisperModelCache} from './browser-whisper-cache';
type Progress={file?:string;status?:string;loaded?:number;total?:number;progress?:number};
const abortError=()=>new DOMException('ブラウザー処理を中止しました。','AbortError');
const marker=(model:BrowserWhisperModel)=>new URL(`/__tc-whisper/${model.id}/${model.revision}`,location.origin).href;
export async function browserWhisperInstalled(model:BrowserWhisperModel){
 if(!globalThis.caches)return false;
 try{const cache=await caches.open(whisperCache),entry=await cache.match(marker(model));if(!entry)return false;const {files}=await entry.json();return Array.isArray(files)&&files.length>=runtimeFiles.length+2&&(await Promise.all(files.map((url:string)=>cache.match(url)))).every(Boolean);}catch{return false;}
}
export async function browserWhisperCached(model:BrowserWhisperModel){
 if(!globalThis.caches)return false;
 try{return (await(await caches.open(whisperCache)).keys()).some(request=>isWhisperModelCacheUrl(request.url,model,location.origin));}catch{return false;}
}
export async function removeBrowserWhisper(model:BrowserWhisperModel){
 if(!globalThis.caches)throw Error('このブラウザーではモデルを管理できません。');
 return removeWhisperModelCache(await caches.open(whisperCache),model,location.origin);
}
export class BrowserWhisper {
 private worker:Worker|null=null;private urls:string[]=[];private sequence=0;private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:unknown)=>void;progress?:(value:Progress)=>void}>();private loadingModel='';
 stop(){this.worker?.terminate();this.worker=null;this.loadingModel='';for(const url of this.urls)URL.revokeObjectURL(url);this.urls=[];for(const request of this.pending.values())request.reject(abortError());this.pending.clear();}
 private call(action:string,value:Record<string,unknown>,progress?:(value:Progress)=>void,transfer:Transferable[]=[]){
  return new Promise<any>((resolve,reject)=>{const id=++this.sequence;this.pending.set(id,{resolve,reject,progress});this.worker!.postMessage({id,action,...value},transfer);});
 }
 async prepare(model:BrowserWhisperModel,install:boolean,signal:AbortSignal,onProgress:(value:Progress)=>void){
  if(this.loadingModel===model.id&&this.worker)return;
  this.stop();if(!install&&!await browserWhisperInstalled(model))throw Error('先にこのブラウザーへモデルを導入してください。');
  const cache=await caches.open(whisperCache),bodies:Blob[]=[];
  for(const file of runtimeFiles){
   if(signal.aborted)throw abortError();const url=whisperRuntime+file;let response=await cache.match(url);
   if(!response){if(!install)throw Error('実行環境のキャッシュがありません。再導入してください。');response=await fetch(url,{signal});if(!response.ok)throw Error(`実行環境を取得できません: ${response.status}`);
    const total=Number(response.headers.get('Content-Length'))||undefined,reader=response.body!.getReader(),chunks:Uint8Array[]=[];let loaded=0;
    while(true){const part=await reader.read();if(part.done)break;chunks.push(part.value);loaded+=part.value.length;onProgress({file,loaded,total,status:'progress'});}
    const blob=new Blob(chunks as BlobPart[],{type:file.endsWith('.wasm')?'application/wasm':'text/javascript'});response=new Response(blob,{headers:{'Content-Type':blob.type}});await cache.put(url,response.clone());
   }
   bodies.push(await response.blob());
  }
  if(signal.aborted)throw abortError();this.urls=bodies.map(blob=>URL.createObjectURL(blob));
  this.worker=new Worker(new URL('/browser-whisper-worker.js',location.origin),{type:'module'});
  this.worker.onmessage=({data})=>{const request=this.pending.get(data.id);if(!request)return;if(data.progress){request.progress?.(data.progress);return;}this.pending.delete(data.id);data.error?request.reject(Error(data.error)):request.resolve(data.result);};
  this.worker.onerror=()=>{const requests=[...this.pending.values()];this.pending.clear();this.stop();for(const request of requests)request.reject(Error('ブラウザーWhisperの実行環境を起動できません。'));};
  const cancel=()=>this.stop();signal.addEventListener('abort',cancel,{once:true});
  try{
   await this.call('load',{model:model.id,runtime:this.urls[0],mjs:this.urls[1],wasm:this.urls[2],install},onProgress);
   if(signal.aborted)throw abortError();this.loadingModel=model.id;
   if(install){const keys=await cache.keys(),files=keys.map(request=>request.url).filter(url=>url.startsWith(whisperRuntime)||url.includes('/'+model.repo+'/'));await cache.put(marker(model),new Response(JSON.stringify({files}),{headers:{'Content-Type':'application/json'}}));}
  }catch(error){this.stop();throw error;}finally{signal.removeEventListener('abort',cancel);}
 }
 async recognize(audio:Float32Array,signal:AbortSignal){
  if(signal.aborted)throw abortError();const cancel=()=>this.stop();signal.addEventListener('abort',cancel,{once:true});
  try{return await this.call('recognize',{audio},undefined,[audio.buffer]);}finally{signal.removeEventListener('abort',cancel);}
 }
}
export async function openWhisperAudio(file:File){
 const input=new Input({formats:ALL_FORMATS,source:new BlobSource(file)});
 try{const track=await input.getPrimaryAudioTrack();if(!track||!await track.canDecode())throw Error('このブラウザーで音声を読み取れません。対応する動画・音声形式を使用してください。');const duration=await input.computeDuration();if(!Number.isFinite(duration)||duration<=0)throw Error('音声の長さを確認できません。');return {input,sink:new AudioBufferSink(track),duration};}catch(error){input.dispose();throw error;}
}
export async function whisperAudioChunk(sink:AudioBufferSink,from:number,to:number,signal:AbortSignal,details:Record<string,unknown>){
 return measure('browser-audio-decode',{...details,from,to},async()=>{
  const context=new OfflineAudioContext(1,Math.ceil((to-from)*16000),16000);
  for await(const part of sink.buffers(from,to)){
   if(signal.aborted)throw abortError();const offset=Math.max(0,from-part.timestamp),at=Math.max(0,part.timestamp-from),length=Math.min(part.buffer.duration-offset,to-from-at);if(length<=0)continue;
   const source=context.createBufferSource();source.buffer=part.buffer;source.connect(context.destination);source.start(at,offset,length);
  }
  const buffer=await context.startRendering();if(signal.aborted)throw abortError();return buffer.getChannelData(0).slice();
 });
}
export {browserWhisperModels};
