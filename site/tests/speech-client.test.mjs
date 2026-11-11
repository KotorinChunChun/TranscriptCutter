import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SpeechClient} from '../speech-client.ts';
import {segmentsToVtt} from '../segments-vtt.ts';
import {parseVtt} from '../src/lib/vtt.ts';
test('connection selection and subtitle PATCH use the same in-memory client instance without auth headers',async()=>{
 const original=globalThis.fetch,requests=[];globalThis.fetch=async(url,options={})=>{requests.push({url,...options});return new Response(JSON.stringify(url==='/speech/api/health'?{appId:'meeting-transcriber',protocolVersion:3,authMode:'lan'}:url==='/speech/v1/models'?{data:[]}:{url:'http://192.168.49.12:8769',updated:1}),{status:200,headers:{'Content-Type':'application/json'}});};
 try{const client=new SpeechClient();await client.configure('http://192.168.49.12:8769','');await client.connect();await client.editSegments('a'.repeat(32),[{id:1,text:'合成'}]);const patch=requests.at(-1);assert.equal(patch.method,'PATCH');assert.deepEqual(JSON.parse(patch.body),{edits:[{id:1,text:'合成'}]});assert.equal(patch.headers['X-TC-Client'],requests[0].headers['X-TC-Client']);assert.equal(patch.headers.Authorization,undefined);assert.equal(patch.headers['X-Local-Token'],undefined);}finally{globalThis.fetch=original;}
});
test('segmented result pagination preserves absolute seconds and speaker during VTT handoff',async()=>{
 const client=new SpeechClient();const paths=[];
 client.request=async path=>{paths.push(path);return path.includes('after=0&')?{segments:[{id:2,start:60.125,end:65.5,text:'日本語 😀',speaker:'話者A'}],next:2,total:2}:{segments:[{id:5,start:66,end:70,text:'続き',speaker:'話者B'}],next:5,total:2};};
 const rows=await client.segments('a'.repeat(32));assert.equal(rows.length,2);assert.match(paths[1],/after=2&/);const cues=parseVtt(segmentsToVtt(rows)).cues;assert.equal(cues[0].start,60125);assert.equal(cues[0].end,65500);assert.equal(cues[0].speaker,'話者A');assert.equal(cues[0].text,'日本語 😀');
});
test('upload uses file classification, source File and recognition bounds without retries',async()=>{
 const Original=globalThis.XMLHttpRequest;let sent,request;
 globalThis.XMLHttpRequest=class{constructor(){request=this;this.upload={};this.status=200;this.responseText='{"job":{"status":"queued"}}';}open(method,url){this.method=method;this.url=url;}setRequestHeader(){}send(file){sent=file;queueMicrotask(()=>this.onload());}};
 try{const file=new File(['synthetic'],'synthetic.mp4');const client=new SpeechClient();await client.upload(file,{x_meeting:{engineId:'whisper',modelId:'tiny'}},'cpu',false,60,90,()=>{});const url=new URL(request.url,'http://localhost');assert.equal(url.searchParams.get('clientId'),'transcript-cutter');assert.equal(url.searchParams.get('workload'),'file');assert.equal(url.searchParams.get('start'),'60');assert.equal(url.searchParams.get('end'),'90');assert.equal(url.searchParams.get('diarize'),'false');assert.equal(sent,file);}finally{globalThis.XMLHttpRequest=Original;}
});
test('incremental reads preserve a stable page target while recognition appends more rows',async()=>{
 const client=new SpeechClient();let calls=0;client.request=async path=>{calls++;return calls===1?{segments:[{id:3}],next:3,total:4}:{segments:[{id:4}],next:4,total:100};};const updates=await client.segments('job',2,2);assert.deepEqual(updates.map(s=>s.id),[3,4]);assert.equal(calls,2);
});
