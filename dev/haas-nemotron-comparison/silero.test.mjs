import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSilero} from './silero.mjs';

function mock({probabilities=[.8],inputNames=['input','state','sr'],failLoad=false,invalidState=false}={}) {
  const calls=[],loads=[];
  let released=0;
  class Tensor {
    constructor(type,data,dims){Object.assign(this,{type,data,dims});}
  }
  const session={inputNames,outputNames:['output','stateN'],async run(feed){
    const index=calls.length;
    calls.push({input:feed.input.data.slice(),inputShape:feed.input.dims,state:feed.state.data.slice(),stateShape:feed.state.dims,sr:feed.sr.data[0],srShape:feed.sr.dims});
    const state=new Float32Array(256).fill(index+1);
    return {output:new Tensor('float32',new Float32Array([probabilities[index%probabilities.length]]),[1,1]),stateN:new Tensor('float32',state,invalidState?[1,256]:[2,1,128])};
  },async release(){released++;}};
  const ort={Tensor,InferenceSession:{async create(url,options){loads.push({url,options});if(failLoad)throw Error('load failed');return session;}}};
  return {ort,calls,loads,get released(){return released;}};
}

test('512サンプルと64文脈、状態を次窓へ渡しsrはscalarにする',async()=>{
  const m=mock(),vad=await loadSilero(m.ort);
  const audio=Float32Array.from({length:1024},(_,i)=>i/1024);
  const progress=[];
  const result=await vad.run(audio,value=>progress.push(value));
  assert.deepEqual(m.loads[0].options,{executionProviders:['wasm']});
  assert.deepEqual(m.calls[0].inputShape,[1,576]);
  assert.deepEqual(m.calls[0].stateShape,[2,1,128]);
  assert.equal(m.calls[0].sr,16000n);assert.deepEqual(m.calls[0].srShape,[]);
  assert.ok(m.calls[0].input.subarray(0,64).every(v=>v===0));
  assert.deepEqual(m.calls[0].input.subarray(64),audio.subarray(0,512));
  assert.deepEqual(m.calls[1].input.subarray(0,64),audio.subarray(448,512));
  assert.ok(m.calls[1].state.every(v=>v===1));
  assert.equal(result.numFrames,2);assert.equal(result.frameSeconds,.032);
  assert.deepEqual(result.sourceSegments,[{start:0,end:.064}]);assert.equal(progress.at(-1),1);
  await vad.dispose();
});

test('末尾をゼロ埋めし、発話の末尾を実音声長へclipする',async()=>{
  const m=mock({probabilities:[.1,.9]}),vad=await loadSilero(m.ort);
  const audio=new Float32Array(600).fill(.25),result=await vad.run(audio);
  assert.equal(result.duration,.0375);
  assert.deepEqual(result.sourceSegments,[{start:.032,end:.0375}]);
  assert.ok(m.calls[1].input.subarray(64,152).every(v=>v===.25));
  assert.ok(m.calls[1].input.subarray(152).every(v=>v===0));
  await vad.dispose();
});

test('全無発話と閾値ちょうどは発話区間にしない',async()=>{
  const m=mock({probabilities:[.1,.5]}),vad=await loadSilero(m.ort);
  const result=await vad.run(new Float32Array(1024));
  assert.deepEqual(result.sourceSegments,[]);assert.equal(result.probs.length,2);
  await vad.dispose();
});

test('1窓の短い発話も捨てず、runごと状態と文脈を初期化する',async()=>{
  const m=mock(),vad=await loadSilero(m.ort);
  const first=await vad.run(new Float32Array(512).fill(.75));
  const second=await vad.run(new Float32Array(512).fill(.5));
  assert.deepEqual(first.sourceSegments,[{start:0,end:.032}]);
  assert.deepEqual(second.sourceSegments,first.sourceSegments);
  assert.ok(m.calls[1].state.every(v=>v===0));
  assert.ok(m.calls[1].input.subarray(0,64).every(v=>v===0));
  await vad.dispose();
});

test('モデル読込/入出力契約の失敗と解放を扱う',async()=>{
  const failed=mock({failLoad:true});await assert.rejects(loadSilero(failed.ort),/load failed/);assert.equal(failed.released,0);
  const bad=mock({inputNames:['input']});await assert.rejects(loadSilero(bad.ort),/契約/);assert.equal(bad.released,1);
  const ok=mock(),vad=await loadSilero(ok.ort);await vad.dispose();await vad.dispose();assert.equal(ok.released,1);
  await assert.rejects(vad.run(new Float32Array(512)),/解放済み/);
});

test('非有限入力と不正なモデル出力を拒否し失敗後も解放できる',async()=>{
  const m=mock({invalidState:true}),vad=await loadSilero(m.ort);
  await assert.rejects(vad.run(new Float32Array([NaN])),/有限/);
  await assert.rejects(vad.run(new Float32Array(0)),/有限/);
  await assert.rejects(vad.run(new Float32Array(512)),/出力状態/);
  await vad.dispose();assert.equal(m.released,1);
});
