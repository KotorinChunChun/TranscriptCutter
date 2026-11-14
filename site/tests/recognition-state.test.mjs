import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RecognitionResults,transcriptionName,recognitionProgress,recognitionElapsed,recognitionLabels,isActiveJob} from '../recognition-state.ts';
test('incremental snapshots include saved subtitles from running and failed jobs',async()=>{
 let status='running',count=1;const calls=[];
 const reader=new RecognitionResults({request:async()=>({job:{id:'job',status,segmentCount:count}}),segments:async(id,after,known)=>{calls.push([after,known]);return after===0?[{id:1,start:0,end:1,text:'前'}]:[{id:2,start:1,end:2,text:'後'}];}});
 reader.select('job');assert.equal((await reader.refresh()).segments.length,1);status='error';count=2;const next=await reader.refresh();assert.equal(next.job.status,'error');assert.equal(next.segments.length,2);assert.deepEqual(calls,[[0,0],[1,1]]);
});
test('old requests cannot overwrite a newly selected job and concurrent refreshes do not duplicate',async()=>{
 let release;const wait=new Promise(r=>release=r);const reader=new RecognitionResults({request:async path=>{if(path.endsWith('/old'))await wait;return {job:{id:path.split('/').at(-1),status:'running'}};},segments:async()=>[]});
 reader.select('old');const old=reader.refresh();assert.equal(await reader.refresh(),null);reader.select('new');assert.equal((await reader.refresh()).job.id,'new');release();assert.equal(await old,null);
});
test('failed retrieval retains the cursor and manual refresh can recover edited rows',async()=>{
 let fail=false;const calls=[];const reader=new RecognitionResults({request:async()=>({job:{id:'job',status:'running'}}),segments:async(id,after)=>{calls.push(after);if(fail)throw Error('offline');return [{id:1,start:0,end:1,text:after?'new':'old'}];}});
 reader.select('job');await reader.refresh();fail=true;await assert.rejects(reader.refresh());fail=false;await reader.refresh();await reader.refresh(true);assert.deepEqual(calls,[0,1,1,0]);
});
test('names identify engine, model, host and partial output without URL credentials',()=>{
 const job={id:'1234567890',status:'error',engine:'whisper',modelId:'large-v3'};
 assert.match(transcriptionName(job,'会議.mp4','http://127.0.0.1:8769'),/会議__this-PC__whisper__large-v3__partial__12345678.vtt/);
 assert.match(transcriptionName({...job,status:'complete'},'会議.mp4','http://192.168.1.2:8769'),/server-192.168.1.2-8769.*complete/);
 assert.doesNotMatch(transcriptionName(job,'会議.mp4','http://user:password@server'),/password|user:/);
});
test('range progress excludes the skipped prefix of the source video',()=>{assert.deepEqual(recognitionProgress({rangeStart:60,rangeEnd:90,processedUntil:75}),{from:60,to:90,done:75,fraction:0.5});});

test('local Haas exports identify browser execution and keep the selected model',()=>{
 const name=transcriptionName({id:'1234567890',status:'complete',engine:'browser-haas',modelId:'haas-ja'},'会議.mp4','');
 assert.match(name,/会議__browser-this-PC__browser-haas__haas-ja__complete__12345678.vtt/);
});
test('a stale network error does not replace the new job status',async()=>{
 let fail;const wait=new Promise((_,reject)=>fail=reject);const reader=new RecognitionResults({request:async()=>wait,segments:async()=>[]});reader.select('old');const pending=reader.refresh();reader.select('new');fail(Error('old offline'));assert.equal(await pending,null);
});
test('completed Rust jobs use their finish time and never grow when viewed later',()=>{
 const job={status:'complete',metadata:{startedAt:'2026-11-12T00:00:00Z',completedAt:'2026-11-12T00:00:05Z'}};
 assert.deepEqual(recognitionElapsed(job,Date.parse('2026-11-12T01:00:00Z')),{seconds:5,source:'timestamps'});
 assert.equal(recognitionElapsed({...job,metadata:{...job.metadata,runSeconds:4.9}},0).seconds,4.9);
 assert.equal(recognitionElapsed({status:'error',metadata:{startedAt:job.metadata.startedAt}},Date.now()).seconds,null);
});

test('resource waiting shows the server reason only while queued and uses status for lifecycle',()=>{
 const waiting={id:'job',status:'queued',phase:'waiting_resources',metadata:{waitingReason:' RAM予算待ち '}};
 assert.deepEqual(recognitionLabels(waiting),{statusLabel:'待機中',phaseLabel:'資源待ち',waitingReason:'RAM予算待ち'});
 assert.equal(isActiveJob(waiting),true);
 for(const reason of [null,undefined,0,{},'   '])assert.equal(recognitionLabels({...waiting,metadata:{waitingReason:reason}}).waitingReason,'');
 for(const [status,label]of [['complete','完了'],['error','エラー'],['cancelled','中止'],['interrupted','中断']]){
  assert.deepEqual(recognitionLabels({...waiting,status}),{statusLabel:label,phaseLabel:label,waitingReason:''});
  assert.equal(isActiveJob({...waiting,status}),false);
 }
 assert.deepEqual(recognitionLabels({...waiting,status:'running',phase:'transcribing'}),{statusLabel:'認識中',phaseLabel:'字幕を認識中',waitingReason:''});
});

test('unknown or contradictory phases do not override queued, running or terminal status',()=>{
 for(const phase of ['future-server-phase','error','complete','__proto__','constructor',undefined]){
  assert.deepEqual(recognitionLabels({status:'queued',phase}),{statusLabel:'待機中',phaseLabel:'待機中',waitingReason:''});
  assert.deepEqual(recognitionLabels({status:'running',phase}),{statusLabel:'認識中',phaseLabel:'処理中',waitingReason:''});
  assert.deepEqual(recognitionLabels({status:'complete',phase}),{statusLabel:'完了',phaseLabel:'完了',waitingReason:''});
 }
 for(const status of ['future-status','__proto__','constructor'])assert.deepEqual(recognitionLabels({status,phase:'error'}),{statusLabel:'状態不明',phaseLabel:'状態不明',waitingReason:''});
 assert.deepEqual(recognitionLabels(null),{statusLabel:'未実行',phaseLabel:'未実行',waitingReason:''});
});

test('resource wait and future phases continue incremental polling through completion',async()=>{
 const states=[{status:'queued',phase:'waiting_resources',metadata:{waitingReason:'GPU枠待ち'}},{status:'queued',phase:'new-queue-phase',metadata:{waitingReason:'RAM予算待ち'}},{status:'running',phase:'new-recognition-phase',metadata:{waitingReason:null}},{status:'complete',phase:'new-completion-phase'}];
 let index=0;const cursors=[];
 const reader=new RecognitionResults({request:async()=>({job:{id:'job',...states[index]}}),segments:async(id,after)=>{cursors.push(after);return index>=2?[{id:index-1,start:index-2,end:index-1,text:index===2?'先':'後'}]:[];}});
 reader.select('job');
 for(index=0;index<states.length;index++){
  const result=await reader.refresh();assert.equal(result.job.phase,states[index].phase);assert.equal(result.segments.length,Math.max(0,index-1));
  assert.equal(isActiveJob(result.job),index<3);
  if(index>=2)assert.equal(recognitionLabels(result.job).waitingReason,'');
 }
 assert.deepEqual(cursors,[0,0,0,1]);
});
