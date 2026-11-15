// Synthetic loopback fixtures only. Never configure or stop a real server.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {RecognitionResults} from '../site/recognition-state.ts';
import {SpeechClient} from '../site/speech-client.ts';
import {createWebServer} from '../scripts/serve-web.mjs';
const checks=[];
const row=(id,text)=>({id,start:id-1,end:id,text});
let offline=false,rows=[row(1,'旧1'),row(2,'旧2')];const paths=[];
const reader=new RecognitionResults({request:async path=>{paths.push(path);if(offline)throw Error('synthetic disconnect');return {job:{id:'a'.repeat(32),status:'running',segmentCount:rows.length}};},segments:async(id,after)=>rows.filter(r=>r.id>after)});
reader.select('a'.repeat(32));await reader.refresh();offline=true;try{await reader.refresh();}catch{}offline=false;
const recovered=await reader.refresh();checks.push({name:'same-job-after-disconnect',passed:recovered.job.id==='a'.repeat(32)&&paths.every(p=>p.endsWith('/'+'a'.repeat(32))),actual:recovered.segments.map(r=>r.text)});
rows=[row(1,'再実行1')];let result=await reader.refresh();checks.push({name:'reset-with-smaller-count',passed:JSON.stringify(result.segments)===JSON.stringify(rows),actual:result.segments.map(r=>r.text),expected:rows.map(r=>r.text)});
rows=[row(1,'再実行1'),row(2,'再実行2'),row(3,'再実行3')];result=await reader.refresh();checks.push({name:'reset-already-overtook-old-cursor',passed:JSON.stringify(result.segments)===JSON.stringify(rows),actual:result.segments.map(r=>r.text),expected:rows.map(r=>r.text)});
const Original=globalThis.XMLHttpRequest;let posts=0;
globalThis.XMLHttpRequest=class{constructor(){this.upload={};this.status=503;this.responseText='{"error":"更新待機","code":"server_draining"}';}open(){}setRequestHeader(){}getResponseHeader(name){return name.toLowerCase()==='retry-after'?'7':null;}send(){posts++;queueMicrotask(()=>this.onload());}};
try{await new SpeechClient().upload(new File(['synthetic'],'fixture.wav'),{x_meeting:{engineId:'whisper',modelId:'tiny'}},'cpu',false,0,1,()=>{});}catch(error){checks.push({name:'upload-503-no-repost',passed:posts===1,posts,errorStatus:error.status,retryAfterExposed:error.retryAfter??null});}finally{globalThis.XMLHttpRequest=Original;}
const registry=await readFile('C:/develop/DevServer/local/servers.json','utf8');
async function listen(server){for(;;){await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});if(!new RegExp('\\b'+server.address().port+'\\b').test(registry))return `http://127.0.0.1:${server.address().port}/`;await new Promise(r=>server.close(r));}}
async function close(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
const fixture=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/api/health'){res.end(JSON.stringify({appId:'meeting-transcriber',protocolVersion:3,authMode:'local',token:'synthetic'}));return;}res.writeHead(503,{'Retry-After':'7'}).end('{"error":"更新待機"}');});
let proxy;try{const target=await listen(fixture);proxy=createWebServer({speechUrl:target,assets:new Map()});const url=await listen(proxy);const response=await fetch(url+'speech/api/jobs');checks.push({name:'proxy-retry-after',passed:response.status===503&&response.headers.get('retry-after')==='7',status:response.status,actual:response.headers.get('retry-after'),expected:'7'});}finally{if(proxy)await close(proxy);await close(fixture);}
const report={recordedAt:new Date().toISOString(),scope:'synthetic-only; no live server contacted',checks};
await mkdir(new URL('../runtime/server115-preparation/',import.meta.url),{recursive:true});await writeFile(new URL('../runtime/server115-preparation/baseline.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
