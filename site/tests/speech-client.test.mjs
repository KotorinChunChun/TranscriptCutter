import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SpeechClient} from '../speech-client.ts';
import {segmentsToVtt} from '../segments-vtt.ts';
import {parseVtt} from '../src/lib/vtt.ts';
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
