// Browser-only experiment adapter for the MIT-licensed snakers4/silero-vad ONNX model.
// Contract: src/silero_vad/utils_vad.py, OnnxWrapper.__call__/audio_forward.
// Source/model revision: 066409f3d9db45a30d21dfcbf9147826ffdd7052.
// Model SHA256: 1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3.
const RATE=16000, WINDOW=512, CONTEXT=64, STATE_SIZE=2*128;
const sameShape=(actual,expected)=>actual?.length===expected.length&&actual.every((v,i)=>v===expected[i]);

function segmentsFromProbabilities(probs,duration) {
  const segments=[];
  let start=-1;
  for(let frame=0;frame<=probs.length;frame++) {
    const active=frame<probs.length&&probs[frame]>.5;
    if(active&&start<0)start=frame;
    if(!active&&start>=0) {
      const from=start*WINDOW/RATE,to=Math.min(duration,frame*WINDOW/RATE);
      if(to>from)segments.push({start:from,end:to});
      start=-1;
    }
  }
  return segments;
}

/** The caller configures ORT WASM threading and owns the surrounding Web Worker. */
export async function loadSilero(ort,{modelUrl='./model/silero/silero_vad.onnx',onProgress=()=>{}}={}) {
  let session;
  try {
    onProgress('Silero VADモデルを読み込み中');
    session=await ort.InferenceSession.create(new URL(modelUrl,import.meta.url).href,{executionProviders:['wasm']});
    if(!['input','state','sr'].every(name=>session.inputNames?.includes(name)) ||
       !['output','stateN'].every(name=>session.outputNames?.includes(name))) {
      throw Error('Silero ONNXの入出力名が対応する契約と一致しません');
    }
    let disposed=false,running=false;
    return {
      async run(audio,onProgress=()=>{}) {
        if(disposed)throw Error('Sileroモデルは解放済みです');
        if(running)throw Error('Sileroはすでに実行中です');
        if(!(audio instanceof Float32Array)||!audio.length||!audio.every(Number.isFinite)) {
          throw Error('Sileroの入力は16kHzの有限なFloat32 PCMにしてください');
        }
        running=true;
        try {
          const numFrames=Math.ceil(audio.length/WINDOW),probs=new Float32Array(numFrames);
          let state=new ort.Tensor('float32',new Float32Array(STATE_SIZE),[2,1,128]);
          const context=new Float32Array(CONTEXT);
          const sampleRate=new ort.Tensor('int64',new BigInt64Array([BigInt(RATE)]),[]);
          for(let frame=0;frame<numFrames;frame++) {
            const input=new Float32Array(CONTEXT+WINDOW),from=frame*WINDOW;
            input.set(context);
            input.set(audio.subarray(from,Math.min(from+WINDOW,audio.length)),CONTEXT);
            const result=await session.run({input:new ort.Tensor('float32',input,[1,CONTEXT+WINDOW]),state,sr:sampleRate});
            const probability=result.output?.data;
            const nextState=result.stateN;
            if(probability?.length!==1||!Number.isFinite(probability[0])||probability[0]<0||probability[0]>1) {
              throw Error('Sileroの発話確率が不正です');
            }
            if(!sameShape(nextState?.dims,[2,1,128])||nextState.data?.length!==STATE_SIZE||!nextState.data.every(Number.isFinite)) {
              throw Error('Sileroの出力状態が不正です');
            }
            probs[frame]=probability[0];
            state=nextState;
            context.set(input.subarray(input.length-CONTEXT));
            if((frame+1)%32===0||frame+1===numFrames)onProgress((frame+1)/numFrames);
          }
          const duration=audio.length/RATE;
          return {probs,numFrames,frameSeconds:WINDOW/RATE,sourceSegments:segmentsFromProbabilities(probs,duration),duration};
        } finally {running=false;}
      },
      async dispose() {
        if(running)throw Error('実行中のSileroを解放できません');
        if(disposed)return;
        disposed=true;
        await session.release();
      },
    };
  } catch(error) {
    if(session)await Promise.allSettled([session.release()]);
    throw error;
  }
}
