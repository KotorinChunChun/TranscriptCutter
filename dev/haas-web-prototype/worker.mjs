import * as ort from './ort/ort.wasm.min.mjs';
import {logMel,splitAtQuietPoints} from './frontend.mjs';
import {decodeTdt} from './decoder.mjs';
ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths=new URL('./ort/',import.meta.url).href;
let encoder,prediction,joint,frontend,decoding,tokens;
const status=message=>postMessage({status:message});
self.onmessage=async({data})=>{const start=performance.now();try{
 if(data.action==='load'){
  status('設定を読み込み中');[frontend,decoding,tokens]=await Promise.all(['frontend','decoding','tokens'].map(name=>fetch('./model/common/'+name+'.json').then(r=>r.json())));
  status('Haasエンコーダーを読み込み中（約355MB）');encoder=await ort.InferenceSession.create('./model/int4-onecomp/encoder.onnx',{executionProviders:['wasm'],externalData:[{path:'encoder.onnx.data',data:'./model/int4-onecomp/encoder.onnx.data'}]});
  status('復号モデルを読み込み中');prediction=await ort.InferenceSession.create('./model/common/prediction.onnx',{executionProviders:['wasm']});joint=await ort.InferenceSession.create('./model/common/joint.onnx',{executionProviders:['wasm']});
  postMessage({action:'loaded',seconds:(performance.now()-start)/1000,inputs:encoder.inputNames,outputs:encoder.outputNames});return;
 }
 if(data.action==='recognize'){
  if(!encoder)throw Error('モデルを読み込んでください');const audio=data.audio;
  const chunks=splitAtQuietPoints(audio),segments=[];let featureSeconds=0,encoderSeconds=0,decodeSeconds=0;
  for(let i=0;i<chunks.length;i++){
   const [from,to]=chunks[i],chunkStart=performance.now();status(`音声特徴量を計算中 ${i+1}/${chunks.length}`);const feature=logMel(audio.subarray(from,to),frontend);const featureDone=performance.now();
   status(`Haasエンコーダーを実行中 ${i+1}/${chunks.length}`);const output=await encoder.run({mel:new ort.Tensor('float32',feature.data,feature.dims),mel_length:new ort.Tensor('int64',feature.length,[1])});const encoderDone=performance.now();
   status(`日本語へ復号中 ${i+1}/${chunks.length}`);const result=await decodeTdt({ort,encoded:output.enc_proj,frameCount:Number(output.enc_length.data[0]),prediction,joint,config:decoding,tokens});const done=performance.now();
   const segment={start:from/16000,end:to/16000,text:result.text,ids:result.ids,timestamps:result.timestamps,frames:Number(output.enc_length.data[0]),seconds:(done-chunkStart)/1000};segments.push(segment);featureSeconds+=(featureDone-chunkStart)/1000;encoderSeconds+=(encoderDone-featureDone)/1000;decodeSeconds+=(done-encoderDone)/1000;postMessage({action:'segment',segment,index:i+1,total:chunks.length});
  }
  postMessage({action:'result',text:segments.map(s=>s.text).join(''),segments,seconds:(performance.now()-start)/1000,featureSeconds,encoderSeconds,decodeSeconds,inputSeconds:audio.length/16000,timestampType:'chunk_estimated'});return;
 }
 }catch(error){postMessage({action:'error',message:error.stack??String(error),seconds:(performance.now()-start)/1000});}};
