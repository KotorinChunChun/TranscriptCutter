import {logMel} from './browser-haas-frontend.mjs';
import {decodeTdt} from './browser-haas-decoder.mjs';
import {loadSilero} from './browser-silero.mjs';
import {loadNemotron} from './browser-nemotron-core.mjs';
import {alignHaasChunk} from './browser-speaker-alignment.mjs';
import {regionsFromSegments,validateHaasRange,planHaasChunks} from './browser-asr-regions.mjs';

type AnyFunction=(...args:any[])=>any;
type Post=(message:unknown)=>void;
type Segment={id:number;start:number;end:number;text:string;speaker?:string;[key:string]:unknown};
type Loaded={ort:any;encoder:any;prediction:any;joint:any;silero:any;nemotron:any;frontend:any;decoding:any;tokens:any;diarize:boolean;timings:Record<string,number>;loadPending:boolean;dispose:()=>Promise<void>};
type Dependencies={importRuntime:(url:string)=>Promise<any>;fetchAsset:(url:string)=>Promise<Pick<Response,'ok'|'status'|'json'>>;loadSilero:AnyFunction;loadNemotron:AnyFunction;preprocess:AnyFunction;decode:AnyFunction;align:AnyFunction;selectRegions:AnyFunction;planChunks:AnyFunction;now:()=>number};
const defaults:Dependencies={
 importRuntime:(url:string)=>import(/* @vite-ignore */ url),fetchAsset:(url:string)=>fetch(url),
 loadSilero:loadSilero as AnyFunction,loadNemotron:loadNemotron as AnyFunction,
 preprocess:logMel as AnyFunction,decode:decodeTdt as AnyFunction,align:alignHaasChunk as AnyFunction,
 selectRegions:regionsFromSegments as AnyFunction,planChunks:planHaasChunks as AnyFunction,now:()=>performance.now(),
};
const blobUrl=(value:unknown,name:string)=>{
 if(typeof value!=='string'||value.length>4096)throw Error(`${name}の保存済み資産を確認してください。`);
 try{if(new URL(value).protocol==='blob:')return value;}catch{/* Reject non-URL assets. */}
 throw Error(`${name}は導入済みのブラウザー資産から読み込んでください。`);
};

/** Factory is injectable for protocol tests; production fetches only owner-provided blob URLs. */
export function createBrowserHaasWorker(post:Post,overrides:Partial<Dependencies>={}) {
 const deps={...defaults,...overrides};
 const seconds=(start:number)=>(deps.now()-start)/1000;
 let loaded:Loaded|null=null,busy=false;
 const load=async(data:any,progress:(value:unknown)=>void):Promise<Loaded>=>{
  const started=deps.now(),cleanups:Array<()=>Promise<unknown>>=[];
  try{
   if(typeof data.diarize!=='boolean')throw Error('話者識別の設定が不正です。');
   const runtime=data.runtime??{},assets=data.assets??{};
   for(const name of ['module','mjs','wasm'])blobUrl(runtime[name],`実行環境${name}`);
   for(const name of ['haasEncoder','haasEncoderData','haasPrediction','haasJoint','haasFrontend','haasDecoding','haasTokens','silero'])blobUrl(assets[name],name);
   if(data.diarize)for(const name of ['nemotronEmbed','nemotronStep','nemotronMel','nemotronSilence'])blobUrl(assets[name],name);
   const ort=await deps.importRuntime(runtime.module);
   ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths={mjs:runtime.mjs,wasm:runtime.wasm};
   const json=async(name:string)=>{const response=await deps.fetchAsset(assets[name]);if(!response.ok)throw Error(`保存済み設定の読込に失敗しました (${response.status})`);return response.json();};
   progress({stage:'loading',message:'Haasモデルを読み込み中'});
   const [frontend,decoding,tokens]=await Promise.all(['haasFrontend','haasDecoding','haasTokens'].map(json));
   const session=async(url:string,extra:Record<string,unknown>={})=>{const value=await ort.InferenceSession.create(url,{executionProviders:['wasm'],...extra});cleanups.push(()=>value.release());return value;};
   const encoder=await session(assets.haasEncoder,{externalData:[{path:'encoder.onnx.data',data:assets.haasEncoderData}]}),prediction=await session(assets.haasPrediction),joint=await session(assets.haasJoint);
   const haasLoadSeconds=seconds(started);
   let stage=deps.now();
   const silero=await deps.loadSilero(ort,{modelUrl:assets.silero,onProgress:(message:string)=>progress({stage:'loading',message})});cleanups.push(()=>silero.dispose());
   const sileroLoadSeconds=seconds(stage);let nemotron:any=null,nemotronLoadSeconds=0;
   if(data.diarize){stage=deps.now();nemotron=await deps.loadNemotron(ort,{embedUrl:assets.nemotronEmbed,stepUrl:assets.nemotronStep,melUrl:assets.nemotronMel,silenceUrl:assets.nemotronSilence},(message:string)=>progress({stage:'loading',message}));cleanups.push(()=>nemotron.dispose());nemotronLoadSeconds=seconds(stage);}
   return {ort,encoder,prediction,joint,silero,nemotron,frontend,decoding,tokens,diarize:data.diarize,timings:{modelLoadSeconds:seconds(started),haasLoadSeconds,sileroLoadSeconds,nemotronLoadSeconds},loadPending:true,dispose:async()=>{await Promise.allSettled(cleanups.reverse().map(cleanup=>cleanup()));}};
  }catch(error){await Promise.allSettled(cleanups.reverse().map(cleanup=>cleanup()));throw error;}
 };
 return async({data}:{data:any})=>{
  const {id,action}=data??{};
  if(busy){post({id,error:'ブラウザー認識はすでに処理中です。'});return;}
  busy=true;
  const progress=(value:unknown)=>post({id,progress:value});
  try{
   if(!Number.isSafeInteger(id)||id<0)throw Error('認識操作IDが不正です。');
   if(action==='load'){
    await loaded?.dispose();loaded=null;
    loaded=await load(data,progress);
    post({id,result:{loaded:true,executionDevice:'wasm',diarize:loaded.diarize,timings:{...loaded.timings}}});
   }else if(action==='recognize'){
    if(!loaded)throw Error('Silero VAD＋Haasが準備されていません。');
    if(typeof data.diarize!=='boolean'||data.diarize!==loaded.diarize)throw Error('話者識別の設定が変わりました。モデルを準備し直してください。');
    const {audio,from,to}=data;validateHaasRange(audio,from,to);
    const start=deps.now(),duration=audio.length/16000;
    progress({stage:'voice-detection',message:'Sileroで発話区間を調べています',fraction:0,processedUntil:from});
    let stage=deps.now();
    const vad=await loaded.silero.run(audio,(fraction:number)=>progress({stage:'voice-detection',message:`Silero発話検出 ${Math.round(fraction*100)}%`,fraction,processedUntil:from}));
    const sileroSeconds=seconds(stage);stage=deps.now();
    const selected=deps.selectRegions(vad.sourceSegments,duration,{pad:.25,mergeGap:3});
    const chunks=deps.planChunks(audio,selected.regions,from,{chunkSeconds:25});
    const regionSeconds=seconds(stage);let diarization:any=null,nemotronSeconds=0;
    if(loaded.diarize&&chunks.length){
     stage=deps.now();progress({stage:'diarizing',message:'Nemotronで話者を識別しています',fraction:0,processedUntil:from});
     diarization=await loaded.nemotron.run(audio,(fraction:number)=>progress({stage:'diarizing',message:`Nemotron話者識別 ${Math.round(fraction*100)}%`,fraction,processedUntil:from}));nemotronSeconds=seconds(stage);
    }
    const segments:Segment[]=[],haasStart=deps.now();let featureSeconds=0,encoderSeconds=0,decodeSeconds=0,alignmentFallbacks=0;
    for(let index=0;index<chunks.length;index++){
     const chunk=chunks[index],chunkStart=deps.now();progress({stage:'transcribing',message:`Haasで認識中 ${index+1}/${chunks.length}`,fraction:index/chunks.length,processedUntil:segments.length?segments.at(-1)!.end:from});
     const features=deps.preprocess(audio.subarray(chunk.fromSample,chunk.toSample),loaded.frontend),featureEnd=deps.now();
     const encoded=await loaded.encoder.run({mel:new loaded.ort.Tensor('float32',features.data,features.dims),mel_length:new loaded.ort.Tensor('int64',features.length,[1])});
     const frameCount=Number(encoded.enc_length?.data?.[0]),tensor=encoded.enc_proj;
     if(!Number.isSafeInteger(frameCount)||frameCount<=0||tensor?.dims?.length!==3||tensor.dims[0]!==1||tensor.dims[2]!==640||frameCount>tensor.dims[1]||tensor.data?.length!==tensor.dims[1]*640)throw Error('Haasの出力形状を確認できません。');
     const encoderEnd=deps.now();
     const result=await deps.decode({ort:loaded.ort,encoded:tensor,frameCount,prediction:loaded.prediction,joint:loaded.joint,config:loaded.decoding,tokens:loaded.tokens}),decodeEnd=deps.now();
     featureSeconds+=(featureEnd-chunkStart)/1000;encoderSeconds+=(encoderEnd-featureEnd)/1000;decodeSeconds+=(decodeEnd-encoderEnd)/1000;
     if(result.text?.trim()){
      let cues=deps.align({...result,tokens:loaded.tokens,from:chunk.from,to:chunk.to,audioFrom:from,nextId:segments.length+1,...(diarization?{probs:diarization.probs,numFrames:diarization.numFrames}:{})}) as Segment[];
      const plain=(value:string)=>value.replace(/\s/g,'');
      if(!Array.isArray(cues)||!cues.length||cues.some((s,i)=>!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<chunk.from||s.end>chunk.to||s.end<=s.start||i>0&&s.start<cues[i-1].end)||plain(cues.map(s=>s.text).join(''))!==plain(result.text)){
       alignmentFallbacks++;cues=[{id:segments.length+1,start:chunk.from,end:chunk.to,text:result.text,timestampType:'segment-estimated',alignmentFallback:true,...(loaded.diarize?{speaker:'話者不明'}:{})}];
      }
      for(const cue of cues)segments.push({...cue,id:segments.length+1});
     }
     progress({stage:'transcribing',message:`Haasで認識中 ${index+1}/${chunks.length}`,fraction:(index+1)/chunks.length,processedUntil:chunk.to,segments:[...segments]});
    }
    const haasSeconds=seconds(haasStart),recognitionSeconds=seconds(start),modelLoadSeconds=loaded.loadPending?loaded.timings.modelLoadSeconds:0;loaded.loadPending=false;
    const absolute=(regions:any[])=>regions.map(r=>({...r,start:r.start+from,end:r.end+from}));
    progress({stage:'complete',message:'認識が完了しました',fraction:1,processedUntil:to,segments:[...segments]});
    post({id,result:{segments,executionDevice:'wasm',diarize:loaded.diarize,recognitionCalls:chunks.length,inputSeconds:duration,retainedSeconds:selected.retainedSeconds,removedSeconds:duration-selected.retainedSeconds,regions:absolute(selected.regions),removed:absolute(selected.removed),alignmentFallbacks,timestampType:'tdt-token-candidate',timings:{modelLoadSeconds,lastModelLoadSeconds:loaded.timings.modelLoadSeconds,sileroSeconds,nemotronSeconds,regionSeconds,haasSeconds,featureSeconds,encoderSeconds,decodeSeconds,recognitionSeconds,totalSeconds:modelLoadSeconds+recognitionSeconds},settings:{provider:'wasm',threads:1,threshold:.5,pad:.25,mergeGap:3,chunkSeconds:25,diarize:loaded.diarize}}});
   }else if(action==='dispose'){await loaded?.dispose();loaded=null;post({id,result:true});}
   else throw Error('対応していないブラウザー認識操作です。');
  }catch(error){post({id,error:error instanceof Error?error.message:String(error)});}
  finally{busy=false;}
 };
}
const worker=globalThis as unknown as {postMessage?:(value:unknown)=>void;onmessage?:((event:MessageEvent)=>void)|null};
if(typeof worker.postMessage==='function')worker.onmessage=createBrowserHaasWorker(value=>worker.postMessage!(value));
