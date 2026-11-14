export const whisperCache='transcript-cutter-browser-whisper-v1';
export const whisperRuntime='https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';
export const runtimeFiles=['transformers.min.js','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm'];
export const browserWhisperModels=[
 {id:'tiny',label:'Whisper Tiny',repo:'onnx-community/whisper-tiny',revision:'ff4177021cc41f7db950912b73ea4fdf7d01d8e7',devices:['wasm','webgpu'],modelBytes:{wasm:40844231,webgpu:119618694}},
 {id:'base',label:'Whisper Base',repo:'onnx-community/whisper-base',revision:'27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c',devices:['wasm','webgpu'],modelBytes:{wasm:76894629,webgpu:206070497}},
 {id:'small',label:'Whisper Small',repo:'onnx-community/whisper-small',revision:'36050c46d777d46dc4b5f43f6d90574fc38f8732',devices:['wasm','webgpu'],modelBytes:{wasm:249077005,webgpu:585975197}},
 {id:'medium',label:'Whisper Medium',repo:'Xenova/whisper-medium',revision:'8c5b90880ab9f79487ab33613413431bf661d595',devices:['wasm','webgpu'],modelBytes:{wasm:776129634,webgpu:1699148273}},
 // The current GPU dtype needs a 2.55 GB external encoder. Keep this candidate on
 // CPU until that WebGPU resource path has been validated separately.
 {id:'large-v3-turbo',label:'Whisper Large v3 Turbo',repo:'onnx-community/whisper-large-v3-turbo',revision:'360ebcde2559d60bb474678be3c1de9ef347d01a',devices:['wasm'],modelBytes:{wasm:1084758911,webgpu:null}},
] as const;
export type BrowserWhisperModel=typeof browserWhisperModels[number];
export function browserWhisperModelSize(model:BrowserWhisperModel,device:'wasm'|'webgpu'){
 const bytes=model.modelBytes[device];return bytes?`モデル本体 約${Math.ceil(bytes/1e6).toLocaleString('ja-JP')} MB`:'';
}
export const whisperLoadingPolicy=(install:boolean)=>({allowLocalModels:!install,allowRemoteModels:install,local_files_only:!install});
export function whisperSegments(chunks:{text:string;timestamp:[number|null,number|null]}[],from:number,to:number,nextId:number){
 return chunks.flatMap(chunk=>{
  const a=chunk.timestamp?.[0],b=chunk.timestamp?.[1];
  if(typeof a!=='number'||!Number.isFinite(a)||a<0||!chunk.text.trim()||b!==null&&(typeof b!=='number'||!Number.isFinite(b)))return [];
  const start=Math.max(from,Math.min(to,from+a)),end=b===null?to:Math.max(from,Math.min(to,from+b));
  return end>start?[{id:nextId++,start,end,text:chunk.text.trim(),timestampType:'segment'}]:[];
 });
}
