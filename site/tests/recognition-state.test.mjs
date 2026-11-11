import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RecognitionResults,transcriptionName,recognitionProgress,recognitionElapsed} from '../recognition-state.ts';
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
test('a stale network error does not replace the new job status',async()=>{
 let fail;const wait=new Promise((_,reject)=>fail=reject);const reader=new RecognitionResults({request:async()=>wait,segments:async()=>[]});reader.select('old');const pending=reader.refresh();reader.select('new');fail(Error('old offline'));assert.equal(await pending,null);
});
test('completed Rust jobs use their finish time and never grow when viewed later',()=>{
 const job={status:'complete',metadata:{startedAt:'2026-11-12T00:00:00Z',completedAt:'2026-11-12T00:00:05Z'}};
 assert.deepEqual(recognitionElapsed(job,Date.parse('2026-11-12T01:00:00Z')),{seconds:5,source:'timestamps'});
 assert.equal(recognitionElapsed({...job,metadata:{...job.metadata,runSeconds:4.9}},0).seconds,4.9);
 assert.equal(recognitionElapsed({status:'error',metadata:{startedAt:job.metadata.startedAt}},Date.now()).seconds,null);
});
