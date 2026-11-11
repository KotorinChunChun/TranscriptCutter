import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeName,summarize,report,nextAction} from '../scripts/benchmark-models.mjs';
test('comparison identifies partial results and does not give failed jobs a throughput score',()=>{
 const summary=summarize({id:'a',status:'error',rangeStart:60,rangeEnd:90,metadata:{runSeconds:6,actualDevice:'cpu'},error:'失敗'},[{text:'合成'}],7);
 assert.equal(summary.durationSeconds,30);assert.equal(summary.realTimeFactor,null);assert.equal(summary.characters,2);
 const complete=summarize({status:'complete',rangeStart:60,rangeEnd:90,metadata:{runSeconds:6}},[],7);assert.equal(complete.realTimeFactor,0.2);
 const md=report({label:'このPC',machine:{hostname:'fixture',cpu:'CPU',memoryBytes:1024**3,os:'test'},video:{name:'test.mp4'},results:[{...summary,model:'whisper/base',vtt:'partial.vtt'}]});assert.match(md,/\[部分\]\(partial.vtt\)/);assert.match(md,/別サーバー/);
});
test('artifact names reject path separators while retaining Japanese source names',()=>{assert.equal(safeName('会議/whisper:base'),'会議-whisper-base');});
test('a collector interrupted during upload cannot silently submit the same model again',()=>{
 assert.equal(nextAction({status:'uploading'}),'uncertain');assert.equal(nextAction({status:'upload_uncertain'}),'uncertain');assert.equal(nextAction({status:'running',jobId:'a'}),'resume');assert.equal(nextAction({status:'not_started'}),'submit');assert.equal(nextAction({status:'error',jobId:'a'}),'skip');
});
test('remote server reports never label the client PC hardware as the processing machine',()=>{
 const md=report({label:'server-B',executionScope:'remote-server',machine:{hostname:'server-B',cpu:'未取得',memoryBytes:null,os:'未取得'},clientMachine:{cpu:'client CPU'},video:{name:'test'},results:[]});assert.match(md,/別サーバー（接続先のハードウェア情報は未検証）/);assert.match(md,/RAM 未取得/);assert.doesNotMatch(md,/client CPU|RAM 0.0/);
});
test('missing server runSeconds is kept distinct from a duration derived from Rust timestamps',()=>{
 const r=summarize({status:'complete',duration:10,metadata:{startedAt:'2026-11-12T00:00:00Z',completedAt:'2026-11-12T00:00:05Z'}},[],7);assert.equal(r.runSeconds,null);assert.equal(r.derivedRunSeconds,5);assert.equal(r.timingSource,'timestamps');assert.equal(r.realTimeFactor,0.5);
});
