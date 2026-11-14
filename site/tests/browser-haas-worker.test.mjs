import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserHaasWorker} from '../browser-haas-worker.ts';
import {regionsFromSegments,validateHaasRange,planHaasChunks} from '../browser-asr-regions.mjs';

const runtime={module:'blob:module',mjs:'blob:mjs',wasm:'blob:wasm'};
const assets=Object.fromEntries(['haasEncoder','haasEncoderData','haasPrediction','haasJoint','haasFrontend','haasDecoding','haasTokens','silero','nemotronEmbed','nemotronStep','nemotronMel','nemotronSilence'].map(key=>[key,`blob:${key}`]));
function fixture({empty=false,invalidShape=false,failSilero=false,chunkPlan,importRuntime}={}) {
 const messages=[],created=[],aligned=[];let clock=0,nemoLoads=0,nemoRuns=0,haasRuns=0,released=0;
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}}
 const ort={env:{wasm:{}},Tensor,InferenceSession:{async create(url,options){created.push({url,options});return {async run(){haasRuns++;return {enc_proj:new Tensor('float32',new Float32Array(11*640),[1,11,640]),enc_length:new Tensor('int64',new BigInt64Array([invalidShape?12n:10n]),[1])};},async release(){released++;}};}}};
 const overrides={
  importRuntime:importRuntime??(async()=>ort),now:()=>++clock,
  fetchAsset:async()=>({ok:true,status:200,json:async()=>({})}),
  loadSilero:async(_ort,options)=>{assert.equal(options.modelUrl,assets.silero);if(failSilero)throw Error('silero load failed');return {async run(_audio,progress){progress(1);return {sourceSegments:empty?[]:[{start:0,end:1}]};},async dispose(){released++;}};},
  loadNemotron:async(_ort,options)=>{nemoLoads++;assert.equal(options.embedUrl,assets.nemotronEmbed);return {async run(_audio,progress){nemoRuns++;progress(1);return {probs:new Float32Array(100*8),numFrames:100};},async dispose(){released++;}};},
  preprocess:()=>({data:new Float32Array(128*16),dims:[1,128,16],length:new BigInt64Array([10n])}),
  decode:async()=>({text:'原文',ids:[1,2],timestamps:[0,1]}),
  align:input=>{aligned.push(input);return [{id:input.nextId,start:input.from,end:input.to,text:input.text,...(input.probs?{speaker:'話者1'}:{})}];},
  ...(chunkPlan?{planChunks:chunkPlan}:{}),
 };
 const handler=createBrowserHaasWorker(value=>messages.push(value),overrides);
 return {handler,messages,ort,created,aligned,get nemoLoads(){return nemoLoads;},get nemoRuns(){return nemoRuns;},get haasRuns(){return haasRuns;},get released(){return released;}};
}
const load=(f,diarize=false,extra={})=>f.handler({data:{id:1,action:'load',runtime,assets,diarize,...extra}});
const run=(f,diarize=false,extra={})=>f.handler({data:{id:2,action:'recognize',audio:new Float32Array(16000),from:10,to:11,diarize,...extra}});
const result=(f,id=2)=>f.messages.findLast(m=>m.id===id&&m.result)?.result;

test('話者識別OFFではNemotronモデルを読み込まずCPU設定と元時刻を保つ',async()=>{
 const f=fixture();await load(f);await run(f);
 assert.equal(f.nemoLoads,0);assert.equal(f.nemoRuns,0);
 assert.deepEqual(f.ort.env.wasm,{numThreads:1,proxy:false,wasmPaths:{mjs:runtime.mjs,wasm:runtime.wasm}});
 assert.ok(f.created.every(s=>s.options.executionProviders[0]==='wasm'));
 assert.deepEqual(f.created[0].options.externalData,[{path:'encoder.onnx.data',data:assets.haasEncoderData}]);
 const out=result(f);assert.equal(out.executionDevice,'wasm');assert.equal(out.segments[0].start,10);assert.equal(out.segments[0].end,11);assert.equal(out.segments[0].speaker,undefined);assert.equal(out.retainedSeconds,1);
 assert.equal(f.messages.filter(m=>m.progress?.segments).at(-1).progress.processedUntil,11);
});

test('話者識別ONは同じ音声の確率とrange起点を渡しSilero入力を縮めない',async()=>{
 const f=fixture();await load(f,true);await run(f,true);
 assert.equal(f.nemoLoads,1);assert.equal(f.nemoRuns,1);assert.equal(f.aligned[0].audioFrom,10);assert.equal(f.aligned[0].numFrames,100);assert.equal(f.aligned[0].from,10);
 assert.equal(result(f).retainedSeconds,1);assert.equal(result(f).segments[0].speaker,'話者1');assert.ok(result(f).timings.nemotronSeconds>0);
});

test('全無発話はHaasもNemotron推論も行わず選択範囲の最後まで完了する',async()=>{
 const f=fixture({empty:true});await load(f,true);await run(f,true);
 const out=result(f);assert.equal(f.haasRuns,0);assert.equal(f.nemoRuns,0);assert.deepEqual(out.segments,[]);assert.deepEqual(out.removed,[{start:10,end:11}]);assert.equal(out.recognitionCalls,0);
 assert.equal(f.messages.filter(m=>m.progress).at(-1).progress.processedUntil,11);
});

test('確定字幕は累積でappendされ、load時間を再使用時に二重計上しない',async()=>{
 const chunkPlan=(_audio,_regions,from)=>[{fromSample:0,toSample:8000,from,to:from+.5},{fromSample:8000,toSample:16000,from:from+.5,to:from+1}];
 const f=fixture({chunkPlan});await load(f);await run(f);
 const partial=f.messages.filter(m=>m.progress?.stage==='transcribing'&&m.progress?.segments);
 assert.deepEqual(partial.map(m=>m.progress.segments.map(s=>s.id)),[[1],[1,2]]);assert.ok(result(f).timings.modelLoadSeconds>0);
 await f.handler({data:{id:3,action:'recognize',audio:new Float32Array(16000),from:20,to:21,diarize:false}});
 assert.equal(result(f,3).timings.modelLoadSeconds,0);assert.ok(result(f,3).timings.lastModelLoadSeconds>0);
});

test('未導入や不正shape/range/話者設定を拒否する',async()=>{
 const f=fixture();await run(f);assert.match(f.messages.at(-1).error,/準備/);
 await load(f);await run(f,true);assert.match(f.messages.at(-1).error,/設定/);
 await run(f,false,{to:12});assert.match(f.messages.at(-1).error,/長さ/);
 const bad=fixture({invalidShape:true});await load(bad);await run(bad);assert.match(bad.messages.at(-1).error,/形状/);
 const remote=fixture();await load(remote,false,{runtime:{...runtime,module:'https://example.invalid/runtime.js'}});assert.match(remote.messages.at(-1).error,/導入済み/);assert.equal(remote.created.length,0);
});

test('load失敗時は作成済みsessionを解放し、平行操作は拒否する',async()=>{
 const failed=fixture({failSilero:true});await load(failed);assert.equal(failed.released,3);assert.match(failed.messages.at(-1).error,/silero load failed/);
 let release;const waiting=new Promise(resolve=>{release=resolve;});
 const f=fixture({importRuntime:async()=>{await waiting;throw Error('stopped');}}),pending=load(f);
 await f.handler({data:{id:3,action:'load',runtime,assets,diarize:false}});assert.match(f.messages.at(-1).error,/処理中/);release();await pending;
});

test('区間結合と静かな位置の分割でも選択範囲の元時刻を復元する',()=>{
 const audio=new Float32Array(16000*60),selected=regionsFromSegments([{start:1,end:3},{start:5,end:7},{start:40,end:43}],60);
 assert.deepEqual(selected.regions,[{start:.75,end:7.25},{start:39.75,end:43.25}]);
 const chunks=planHaasChunks(audio,selected.regions,100);
 assert.deepEqual(chunks.map(c=>[c.from,c.to]),[[100.75,107.25],[139.75,143.25]]);
 assert.throws(()=>validateHaasRange(new Float32Array(319),0,.019),/20/);
 assert.throws(()=>validateHaasRange(new Float32Array(16000),0,2),/長さ/);
});
