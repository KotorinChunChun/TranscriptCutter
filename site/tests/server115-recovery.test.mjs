import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SpeechClient,SpeechError,retryAfterSeconds} from '../speech-client.ts';
import {RecognitionResults,recognitionLabels,isActiveJob} from '../recognition-state.ts';
const row=(id,text)=>({id,start:id-1,end:id,text});
function fixture(){let generation=0,rows=[row(1,'旧1'),row(2,'旧2')],offline=false;const cursors=[],client=new SpeechClient();client.request=async path=>{if(offline)throw Error('offline');if(!path.includes('/segments?'))return {job:{id:'job',status:'queued',phase:'recovered',metadata:{resultGeneration:generation}}};const after=Number(new URL(path,'http://fixture').searchParams.get('after'));cursors.push(after);return {resultGeneration:generation,segments:rows.filter(r=>r.id>after),total:rows.length};};const reader=new RecognitionResults(client);reader.select('job');return {reader,client,cursors,set(g,r){generation=g;rows=r;},offline(v){offline=v;}};}
test('same job resets all old rows on generation change, including same/larger result counts and zero rows',async()=>{
 const f=fixture();await f.reader.refresh();f.offline(true);await assert.rejects(f.reader.refresh());f.offline(false);
 for(const [g,rows]of [[1,[row(1,'新1')]],[2,[row(1,'別1'),row(2,'別2'),row(3,'別3')]],[3,[]]]){f.set(g,rows);const result=await f.reader.refresh();assert.deepEqual(result.segments,rows);assert.equal(result.job.metadata.resultGeneration,g);assert.equal(f.cursors.at(-1),0);}
 assert.equal(isActiveJob({status:'queued',phase:'recovered'}),true);assert.equal(recognitionLabels({status:'queued',phase:'recovered'}).phaseLabel,'再起動後の再実行待ち');
});
test('segment page generation wins when restart happens after the first job read',async()=>{
 const f=fixture();await f.reader.refresh();const original=f.client.request;let changed=false;
 f.client.request=async path=>{if(path.includes('/segments?')&&!changed){changed=true;f.set(1,[row(1,'再実行')]);}return original(path);};
 const result=await f.reader.refresh();assert.deepEqual(f.cursors.slice(-2),[2,0]);assert.deepEqual(result.segments,[row(1,'再実行')]);assert.equal(result.job.metadata.resultGeneration,1);
});
test('generation changes between pages discard every earlier page',async()=>{
 const client=new SpeechClient();let generation=0;const cursors=[];client.request=async path=>{if(!path.includes('/segments?'))return {job:{id:'job',status:'running',metadata:{resultGeneration:generation}}};const after=Number(new URL(path,'http://fixture').searchParams.get('after'));cursors.push(after);if(cursors.length===1)return {resultGeneration:0,total:3,next:1,segments:[row(1,'旧ページ')]};generation=1;return {resultGeneration:1,total:1,segments:after?[]:[row(1,'新ページ')]};};const reader=new RecognitionResults(client);reader.select('job');assert.deepEqual((await reader.refresh()).segments,[row(1,'新ページ')]);assert.deepEqual(cursors,[0,1,0]);
});
test('final job mismatch retries; a consistent completed generation alone is published',async()=>{
 const f=fixture(),original=f.client.request;let jobReads=0;f.client.request=async path=>{if(!path.includes('/segments?')&&++jobReads===2)f.set(1,[row(1,'確定')]);return original(path);};const result=await f.reader.refresh();assert.deepEqual(result.segments,[row(1,'確定')]);assert.equal(result.job.metadata.resultGeneration,1);assert.equal(jobReads,4);
});
test('continuous result churn is bounded and leaves the last consistent snapshot recoverable',async()=>{
 const f=fixture();await f.reader.refresh();const original=f.client.request;let generation=0;f.client.request=async path=>{if(!path.includes('/segments?'))f.set(++generation,[row(1,'変化')]);return original(path);};await assert.rejects(f.reader.refresh(),/再生成中/);f.client.request=original;f.set(9,[row(1,'安定')]);assert.deepEqual((await f.reader.refresh()).segments,[row(1,'安定')]);
});
test('completion arriving after the page read cannot hide newly appended final subtitles',async()=>{
 const client=new SpeechClient();let rows=[row(1,'最初')],reads=0;client.request=async path=>{if(path.includes('/segments?'))return {resultGeneration:0,total:rows.length,segments:rows};if(++reads===2)rows=[row(1,'最初'),row(2,'最後')];return {job:{id:'job',status:reads>=2?'complete':'running',segmentCount:rows.length,metadata:{resultGeneration:0}}};};
 const reader=new RecognitionResults(client);reader.select('job');const result=await reader.refresh();assert.equal(result.job.status,'complete');assert.deepEqual(result.segments,rows);assert.equal(result.segments.length,2);assert.equal(reads,4);
});
test('Retry-After seconds and HTTP dates are parsed and malformed/negative values are ignored',()=>{assert.equal(retryAfterSeconds('5'),5);assert.equal(retryAfterSeconds('Sun, 15 Nov 2026 00:00:05 GMT',Date.parse('2026-11-15T00:00:00Z')),5);for(const v of [null,'-1','5x','1.5','Infinity'])assert.equal(retryAfterSeconds(v),null);});
test('503 exposes waiting information for fetch and upload without any duplicate POST',async()=>{
 const original=globalThis.fetch,OriginalXHR=globalThis.XMLHttpRequest;let posts=0;
 try{globalThis.fetch=async()=>new Response('{"error":"更新待機"}',{status:503,headers:{'Retry-After':'5'}});await assert.rejects(new SpeechClient().request('/api/jobs'),e=>e instanceof SpeechError&&e.retryAfterSeconds===5&&String(e).includes('5秒'));
 globalThis.XMLHttpRequest=class{constructor(){this.upload={};this.status=503;this.responseText='{"error":"更新待機"}';}open(){}setRequestHeader(){}getResponseHeader(){return '5';}send(){posts++;queueMicrotask(()=>this.onload());}};
 await assert.rejects(new SpeechClient().upload(new File(['fixture'],'a.wav'),{x_meeting:{engineId:'whisper',modelId:'tiny'}},'cpu',false,0,1,()=>{}),e=>e.status===503&&e.retryAfterSeconds===5&&String(e).includes('自動再送していません'));assert.equal(posts,1);
 }finally{globalThis.fetch=original;globalThis.XMLHttpRequest=OriginalXHR;}
});
