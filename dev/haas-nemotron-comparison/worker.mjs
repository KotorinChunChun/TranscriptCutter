import * as ort from './ort/ort.wasm.min.mjs';
import {logMel, splitAtQuietPoints} from './haas/frontend.mjs';
import {decodeTdt} from './haas/decoder.mjs';
import {loadNemotron} from './nemotron.mjs';
import {loadSilero} from './silero.mjs';
import {speechRegions,regionsFromSegments} from './speech-regions.mjs';

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL('./ort/', import.meta.url).href;
const progress = (stage, message, fraction) => postMessage({action:'progress',stage,message,fraction});
const seconds = since => (performance.now() - since) / 1000;
const json = async name => {
  const response = await fetch(`./model/haas/common/${name}.json`);
  if (!response.ok) throw Error(`${name}: HTTP ${response.status}`);
  return response.json();
};
let busy = false;
self.onmessage = async ({data}) => {
  if (data.action !== 'run' || busy) return;
  busy = true;
  const started = performance.now();
  const sessions = [];
  let nemo,silero;
  try {
    const {mode, audio} = data;
    if (!['haas','nemotron-haas','nemotron-grouped-haas','silero-grouped-haas'].includes(mode) || !(audio instanceof Float32Array) || data.sampleRate !== 16000) throw Error('入力形式が一致しません');
    const duration = audio.length / 16000;
    const grouped=mode.includes('grouped'),mergeGap=grouped?3:.5,chunkSeconds=grouped?25:28;
    progress('load','Haasモデルを読み込み中',0);
    const [frontend, decoding, tokens] = await Promise.all(['frontend','decoding','tokens'].map(json));
    const encoder = await ort.InferenceSession.create('./model/haas/int4-onecomp/encoder.onnx', {
      executionProviders:['wasm'],
      externalData:[{path:'encoder.onnx.data',data:'./model/haas/int4-onecomp/encoder.onnx.data'}],
    });
    sessions.push(encoder);
    const prediction = await ort.InferenceSession.create('./model/haas/common/prediction.onnx',{executionProviders:['wasm']});
    sessions.push(prediction);
    const joint = await ort.InferenceSession.create('./model/haas/common/joint.onnx',{executionProviders:['wasm']});
    sessions.push(joint);
    const haasLoadSeconds = seconds(started);
    let nemotronLoadSeconds=0,sileroLoadSeconds=0,sileroSeconds=0,diarizationSeconds=0,regionSeconds=0;
    let selected = {regions:[{start:0,end:duration}],removed:[],speakerSegments:[],retainedSeconds:duration,speechSeconds:duration};
    if (mode.startsWith('nemotron')) {
      let stageStart=performance.now();
      nemo=await loadNemotron(ort,{baseUrl:'./model/nemotron/',onProgress:message=>progress('load',message,0)});
      nemotronLoadSeconds=seconds(stageStart);
      stageStart=performance.now();
      const diar=await nemo.run(audio,fraction=>progress('nemotron',`Nemotronで発話区間を解析中 ${Math.round(fraction*100)}%`,fraction));
      diarizationSeconds=seconds(stageStart);
      stageStart=performance.now();
      selected=speechRegions(diar.probs,diar.numFrames,duration,{threshold:.5,pad:.25,mergeGap});
      regionSeconds=seconds(stageStart);
    } else if(mode==='silero-grouped-haas') {
      let stageStart=performance.now();
      silero=await loadSilero(ort,{modelUrl:'./model/silero/silero_vad.onnx',onProgress:message=>progress('load',message,0)});
      sileroLoadSeconds=seconds(stageStart);
      stageStart=performance.now();
      const vad=await silero.run(audio,fraction=>progress('silero',`Sileroで発話区間を解析中 ${Math.round(fraction*100)}%`,fraction));
      sileroSeconds=seconds(stageStart);
      stageStart=performance.now();
      selected=regionsFromSegments(vad.sourceSegments,duration,{pad:.25,mergeGap});
      selected.sourceSegments=vad.sourceSegments;
      regionSeconds=seconds(stageStart);
    }
    const chunks=[];
    for (const region of selected.regions) {
      const from=Math.max(0,Math.round(region.start*16000));
      const to=Math.min(audio.length,Math.round(region.end*16000));
      if (to-from<320) throw Error('20ms未満の認識区間です');
      for (const [a,b] of splitAtQuietPoints(audio.subarray(from,to),{chunkSeconds})) chunks.push([from+a,from+b]);
    }
    const haasStart=performance.now(),segments=[];
    let featureSeconds=0,encoderSeconds=0,decodeSeconds=0;
    for (let i=0;i<chunks.length;i++) {
      const [from,to]=chunks[i],chunkStart=performance.now();
      progress('haas',`Haasで認識中 ${i+1}/${chunks.length}（元動画 ${(from/16000).toFixed(1)}秒〜）`,i/chunks.length);
      const features=logMel(audio.subarray(from,to),frontend),featureEnd=performance.now();
      const output=await encoder.run({mel:new ort.Tensor('float32',features.data,features.dims),mel_length:new ort.Tensor('int64',features.length,[1])});
      const encoderEnd=performance.now();
      const result=await decodeTdt({ort,encoded:output.enc_proj,frameCount:Number(output.enc_length.data[0]),prediction,joint,config:decoding,tokens});
      const ended=performance.now();
      featureSeconds+=(featureEnd-chunkStart)/1000;
      encoderSeconds+=(encoderEnd-featureEnd)/1000;
      decodeSeconds+=(ended-encoderEnd)/1000;
      const segment={start:from/16000,end:to/16000,text:result.text,ids:result.ids,timestamps:result.timestamps,seconds:(ended-chunkStart)/1000};
      segments.push(segment);
      postMessage({action:'segment',mode,index:i+1,total:chunks.length,segment});
    }
    const haasSeconds=seconds(haasStart);
    postMessage({action:'result',mode,runId:crypto.randomUUID(),inputSeconds:duration,
      loadSeconds:haasLoadSeconds+nemotronLoadSeconds+sileroLoadSeconds,haasLoadSeconds,nemotronLoadSeconds,sileroLoadSeconds,
      diarizationSeconds,sileroSeconds,detectorSeconds:diarizationSeconds+sileroSeconds,regionSeconds,haasSeconds,totalSeconds:seconds(started),featureSeconds,encoderSeconds,decodeSeconds,
      retainedSeconds:selected.retainedSeconds,removedSeconds:duration-selected.retainedSeconds,
      speechSeconds:selected.speechSeconds,regions:selected.regions,removed:selected.removed,speakerSegments:selected.speakerSegments,sourceSegments:selected.sourceSegments,
      segments,timestampType:'original_chunk_estimated',settings:{threshold:.5,pad:.25,mergeGap,chunkSeconds,grouping:grouped?'nearby-gaps-3s-chunks-25s':'original',detector:mode==='haas'?'none':mode.startsWith('silero')?'silero':'nemotron',threads:1,provider:'wasm',haasRevision:'e46a4b107ffba60336eb3de9745da6f628cfae35',nemotronRevision:'46642c09b3bd014c5ceb19d20524fa2f1dc27dee',sileroRevision:'066409f3d9db45a30d21dfcbf9147826ffdd7052',ort:'1.31.1'},
    });
  } catch(error) {
    postMessage({action:'error',message:error.stack??String(error),elapsedSeconds:seconds(started)});
  } finally {
    for(const session of sessions) await session.release();
    await nemo?.dispose?.();
    await silero?.dispose?.();
    busy=false;
  }
};
