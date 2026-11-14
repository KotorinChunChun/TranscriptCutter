export type WhisperDevice='wasm'|'webgpu';
export type WhisperGpuStatus={available:boolean;reason:string;adapter?:string};
export type WhisperGpuApi={requestAdapter:(options:{powerPreference:string})=>Promise<{isFallbackAdapter?:boolean;info?:{description?:string;vendor?:string};requestDevice:()=>Promise<any>}|null>};
export const whisperDeviceLabel=(device:WhisperDevice)=>device==='webgpu'?'GPU（WebGPU）':'CPU（WASM）';
export const whisperDtype=(device:WhisperDevice)=>device==='webgpu'?{encoder_model:'fp32',decoder_model_merged:'q4'} as const:'q8';
export const whisperMarkerPath=(model:{id:string;revision:string},device?:WhisperDevice)=>`/__tc-whisper/${model.id}/${model.revision}${device?'/'+device:''}`;
export function whisperManifestMatches(value:{device?:unknown;dtype?:any},device:WhisperDevice){
 if(value.device===undefined)return device==='wasm';
 return value.device===device&&(device==='wasm'?value.dtype==='q8':value.dtype?.encoder_model==='fp32'&&value.dtype?.decoder_model_merged==='q4');
}
export const whisperDevices=(status:WhisperGpuStatus,allowed:readonly WhisperDevice[]=['wasm','webgpu']):WhisperDevice[]=>allowed.filter(device=>device==='wasm'||status.available);
export function resolveWhisperDevice(preferred:string|undefined,status:WhisperGpuStatus,allowed:readonly WhisperDevice[]=['wasm','webgpu']):WhisperDevice{return preferred==='webgpu'&&status.available&&allowed.includes('webgpu')?'webgpu':'wasm';}
export async function probeWhisperWebGPU(gpu:WhisperGpuApi|undefined,secure:boolean):Promise<WhisperGpuStatus>{
 if(!secure||!gpu)return {available:false,reason:!secure?'WebGPUにはHTTPSまたはlocalhostが必要です。':'このブラウザーではWebGPUを利用できません。'};
 let device:any;
 try{
  const adapter=await gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter||adapter.isFallbackAdapter)return {available:false,reason:'利用可能なGPUアダプターがありません。'};
  device=await adapter.requestDevice();device.pushErrorScope('validation');
  const module=device.createShaderModule({code:'@compute @workgroup_size(1) fn main() {}'});
  const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}}),encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
  pass.setPipeline(pipeline);pass.dispatchWorkgroups(1);pass.end();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();
  const error=await device.popErrorScope();if(error)throw Error(error.message);
  return {available:true,reason:'WebGPUを利用できます。',adapter:adapter.info?.description||adapter.info?.vendor||'WebGPU'};
 }catch{return {available:false,reason:'この環境ではWebGPUデバイスを初期化できません。'};}
 finally{device?.destroy();}
}
