export const whisperCache='transcript-cutter-browser-whisper-v1';
export const whisperRuntime='https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';
export const runtimeFiles=['transformers.min.js','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm'];
export const browserWhisperModels=[
 {id:'tiny',label:'Whisper Tiny',repo:'onnx-community/whisper-tiny',revision:'ff4177021cc41f7db950912b73ea4fdf7d01d8e7'},
 {id:'base',label:'Whisper Base',repo:'onnx-community/whisper-base',revision:'27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c'},
] as const;
export type BrowserWhisperModel=typeof browserWhisperModels[number];
export function whisperSegments(chunks:{text:string;timestamp:[number|null,number|null]}[],from:number,to:number,nextId:number){
 return chunks.flatMap(chunk=>{
  const a=chunk.timestamp?.[0],b=chunk.timestamp?.[1];
  if(typeof a!=='number'||!Number.isFinite(a)||a<0||!chunk.text.trim()||b!==null&&(typeof b!=='number'||!Number.isFinite(b)))return [];
  const start=Math.max(from,Math.min(to,from+a)),end=b===null?to:Math.max(from,Math.min(to,from+b));
  return end>start?[{id:nextId++,start,end,text:chunk.text.trim(),timestampType:'segment'}]:[];
 });
}
