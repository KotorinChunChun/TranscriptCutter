import {browserWhisperModels,whisperCache,whisperLoadingPolicy} from './browser-whisper-config';
import {probeWhisperWebGPU,whisperDtype,type WhisperDevice,type WhisperGpuApi} from './browser-whisper-device';
const worker=globalThis as unknown as {onmessage:((event:MessageEvent)=>void)|null;postMessage:(value:unknown)=>void};
let pipeline:any=null,activeDevice:WhisperDevice='wasm';
worker.onmessage=async({data})=>{
 const {id,action}=data;
 try{
  if(action==='probe'){worker.postMessage({id,result:await probeWhisperWebGPU((navigator as unknown as {gpu?:WhisperGpuApi}).gpu,isSecureContext)});return;}
  if(action==='load'){
   if(data.device!==undefined&&data.device!=='wasm'&&data.device!=='webgpu')throw Error('処理方式が正しくありません。');
   const device:WhisperDevice=data.device??'wasm';
   if(device==='webgpu'){const status=await probeWhisperWebGPU((navigator as unknown as {gpu?:WhisperGpuApi}).gpu,isSecureContext);if(!status.available)throw Error(status.reason);}
   const model=browserWhisperModels.find(m=>m.id===data.model);if(!model)throw Error('管理対象外のブラウザーモデルです。');
   const runtime=data.runtime as string;
   const lib=await import(/* @vite-ignore */ runtime);
   const cache=await caches.open(whisperCache);
   const policy=whisperLoadingPolicy(data.install===true);lib.env.allowLocalModels=policy.allowLocalModels;lib.env.allowRemoteModels=policy.allowRemoteModels;lib.env.useBrowserCache=false;lib.env.useCustomCache=true;
   lib.env.customCache={match:(request:Request)=>cache.match(request),put:(request:Request,response:Response)=>cache.put(request,response)};
   lib.env.backends.onnx.wasm.numThreads=1;lib.env.backends.onnx.wasm.proxy=false;
   lib.env.backends.onnx.wasm.wasmPaths={mjs:data.mjs,wasm:data.wasm};
   pipeline=await lib.pipeline('automatic-speech-recognition',model.repo,{revision:model.revision,device,dtype:whisperDtype(device),local_files_only:policy.local_files_only,progress_callback:(progress:unknown)=>worker.postMessage({id,progress})});activeDevice=device;
   worker.postMessage({id,result:true});
  }else if(action==='recognize'){
   if(!pipeline)throw Error('ブラウザーWhisperが準備されていません。');
   const result=await pipeline(data.audio,{language:'japanese',task:'transcribe',return_timestamps:true,chunk_length_s:30,stride_length_s:0});
   worker.postMessage({id,result:{...result,executionDevice:activeDevice}});
  }else throw Error('操作が不正です。');
 }catch(error){worker.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
