import {browserWhisperModels,whisperCache} from './browser-whisper-config';
const worker=globalThis as unknown as {onmessage:((event:MessageEvent)=>void)|null;postMessage:(value:unknown)=>void};
let pipeline:any=null;
worker.onmessage=async({data})=>{
 const {id,action}=data;
 try{
  if(action==='load'){
   const model=browserWhisperModels.find(m=>m.id===data.model);if(!model)throw Error('管理対象外のブラウザーモデルです。');
   const runtime=data.runtime as string;
   const lib=await import(/* @vite-ignore */ runtime);
   const cache=await caches.open(whisperCache);
   lib.env.allowLocalModels=false;lib.env.useBrowserCache=false;lib.env.useCustomCache=true;
   lib.env.customCache={match:(request:Request)=>cache.match(request),put:(request:Request,response:Response)=>cache.put(request,response)};
   lib.env.backends.onnx.wasm.numThreads=1;lib.env.backends.onnx.wasm.proxy=false;
   lib.env.backends.onnx.wasm.wasmPaths={mjs:data.mjs,wasm:data.wasm};
   pipeline=await lib.pipeline('automatic-speech-recognition',model.repo,{revision:model.revision,device:'wasm',dtype:'q8',local_files_only:!data.install,progress_callback:(progress:unknown)=>worker.postMessage({id,progress})});
   worker.postMessage({id,result:true});
  }else if(action==='recognize'){
   if(!pipeline)throw Error('ブラウザーWhisperが準備されていません。');
   const result=await pipeline(data.audio,{language:'japanese',task:'transcribe',return_timestamps:true,chunk_length_s:30,stride_length_s:0});
   worker.postMessage({id,result});
  }else throw Error('操作が不正です。');
 }catch(error){worker.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
