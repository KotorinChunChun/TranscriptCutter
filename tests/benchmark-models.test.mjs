import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeName,summarize,report} from '../scripts/benchmark-models.mjs';
test('comparison identifies partial results and does not give failed jobs a throughput score',()=>{
 const summary=summarize({id:'a',status:'error',rangeStart:60,rangeEnd:90,metadata:{runSeconds:6,actualDevice:'cpu'},error:'失敗'},[{text:'合成'}],7);
 assert.equal(summary.durationSeconds,30);assert.equal(summary.realTimeFactor,null);assert.equal(summary.characters,2);
 const complete=summarize({status:'complete',rangeStart:60,rangeEnd:90,metadata:{runSeconds:6}},[],7);assert.equal(complete.realTimeFactor,0.2);
 const md=report({label:'このPC',machine:{hostname:'fixture',cpu:'CPU',memoryBytes:1024**3,os:'test'},video:{name:'test.mp4'},results:[{...summary,model:'whisper/base',vtt:'partial.vtt'}]});assert.match(md,/\[部分\]\(partial.vtt\)/);assert.match(md,/別サーバー/);
});
test('artifact names reject path separators while retaining Japanese source names',()=>{assert.equal(safeName('会議/whisper:base'),'会議-whisper-base');});
