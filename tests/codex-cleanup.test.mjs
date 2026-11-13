import test from 'node:test';import assert from 'node:assert/strict';
import {validateCleanupInput,validateCleanupOutput,cleanupBatches,createCodexCleanup} from '../scripts/codex-cleanup.mjs';
const cue=(id,text)=>({id,start:1234,end:5678,text,speaker:'話者A',sourceIds:[id],sourceCount:1});
const row={id:'row1',candidates:[{sourceId:'a',name:'A',cues:[cue('a1','えっと、資本台帳です。')]},{sourceId:'b',name:'B',cues:[cue('b1','資産台帳です。')]}]};
const input=()=>({model:'test-model',rows:structuredClone([row]),rules:[],fillers:['えっと'],removeFillers:true});
const answer=()=>({decisions:[{rowId:'row1',items:[{sourceId:'b',cueId:'b1',text:'資産台帳です。'}]}]});
test('AI result takes timestamps and speakers only from validated source references',()=>{
 const source=validateCleanupInput(input());const result=validateCleanupOutput(answer(),source.rows);assert.equal(result[0].start,1234);assert.equal(result[0].end,5678);assert.equal(result[0].speaker,'話者A');assert.deepEqual(result[0].sourceIds,['b:b1']);
 const forged=answer();forged.decisions[0].items[0].cueId='not-a-source';assert.throws(()=>validateCleanupOutput(forged,source.rows));
 const duplicate=answer();duplicate.decisions[0].items.push(duplicate.decisions[0].items[0]);assert.throws(()=>validateCleanupOutput(duplicate,source.rows));
 assert.throws(()=>validateCleanupOutput({decisions:[]},source.rows));
});
test('input limits and batches constrain multiple subtitle sources',()=>{
 const bad=input();bad.rows[0].candidates.push(...structuredClone(bad.rows[0].candidates));assert.throws(()=>validateCleanupInput(bad));
 const rows=Array.from({length:70},(_,i)=>({...row,id:'r'+i}));assert.deepEqual(cleanupBatches(rows).map(b=>b.length),[24,24,22]);
 const mixed=answer();mixed.decisions[0].items.push({sourceId:'a',cueId:'a1',text:'同じ話'});assert.throws(()=>validateCleanupOutput(mixed,validateCleanupInput(input()).rows));
});
test('job lifecycle isolates owners, uses ephemeral read-only sessions and commits only complete output',async()=>{
 const calls=[];const rpc={request:async(method,params)=>{calls.push([method,params]);if(method==='config/read')return {config:{mcp_servers:{fixture:{transport:'stdio'}}}};if(method==='thread/start')return {thread:{id:'private-test'}};return {};},turn:async()=>JSON.stringify(answer())};
 const provider=createCodexCleanup({workDir:'C:/develop/TranscriptCutter/runtime/unit-ai',connect:async()=>rpc});
 const started=provider.start('owner-a',input());assert.throws(()=>provider.get(started.id,'owner-b'));assert.throws(()=>provider.start('owner-b',input()));
 let job;for(let i=0;i<10;i++){await new Promise(r=>setImmediate(r));job=provider.get(started.id,'owner-a');if(job.status!=='running')break;}
 assert.equal(job.status,'complete');assert.equal(job.done,1);const params=calls.find(c=>c[0]==='thread/start')[1];assert.equal(params.ephemeral,true);assert.equal(params.sandbox,'read-only');assert.equal(params.approvalPolicy,'never');assert.equal(params.config['mcp_servers.fixture.enabled'],false);provider.close();
});
test('cancellation never publishes a partial candidate and cannot cancel another owner',async()=>{
 const rpc={request:async method=>method==='thread/start'?{thread:{id:'cancel-test'}}:{config:{}},turn:async(_id,_prompt,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}))};
 const provider=createCodexCleanup({workDir:'C:/develop/TranscriptCutter/runtime/unit-ai',connect:async()=>rpc});const started=provider.start('owner',input());await new Promise(r=>setImmediate(r));assert.throws(()=>provider.cancel(started.id,'other'));provider.cancel(started.id,'owner');await new Promise(r=>setImmediate(r));const result=provider.get(started.id,'owner');assert.equal(result.status,'cancelled');assert.equal(result.result,undefined);provider.close();
});
