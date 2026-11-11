// Local-only synthetic API for observing polling and stage switching in a real browser.
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {createWebServer} from './serve-web.mjs';
const id='a'.repeat(32),startedAt=new Date().toISOString();let count=12,status='running',requests=0;
const job=()=>({id,status,phase:status==='running'?'transcribing':status,fileName:'合成検証.mp4',engine:'whisper',modelId:'tiny',clientId:'transcript-cutter',workload:'file',segmentCount:count,duration:90,rangeStart:60,rangeEnd:90,processedUntil:60+Math.min(29,count/20),metadata:{startedAt,executionDevice:'cpu'},...(status==='error'?{error:'合成した時刻エラー',message:'確定済みの字幕を保持しています。'}:{})});
const api=createServer((req,res)=>{res.setHeader('Content-Type','application/json');const url=new URL(req.url,'http://127.0.0.1');let value;
 if(url.pathname==='/fixture/error'&&req.method==='POST'){status='error';value={ok:true,requests};}
 else if(url.pathname==='/api/health')value={appId:'meeting-transcriber',protocolVersion:3,serverVersion:'fixture',token:'synthetic-only',authMode:'local'};
 else if(url.pathname==='/v1/models')value={data:[{id:'whisper/tiny',x_meeting:{engineId:'whisper',engineLabel:'合成検証',modelId:'tiny',label:'Tiny',processingMethods:[{id:'cpu',label:'CPU'}],defaultProcessingMethod:'cpu'}}]};
 else if(url.pathname==='/api/jobs')value={jobs:[job()]};
 else if(url.pathname===`/api/jobs/${id}`){requests++;if(status==='running')count+=7;value={job:job()};}
 else if(url.pathname===`/api/jobs/${id}/segments`){const after=Number(url.searchParams.get('after')??0);value={segments:Array.from({length:Math.max(0,count-after)},(_,n)=>({id:after+n+1,start:60+(after+n)/20,end:60+(after+n+1)/20,text:`合成字幕${after+n+1}`})),total:count,next:count};}
 else{res.writeHead(404).end('{}');return;}res.end(JSON.stringify(value));
});
const registry=await readFile('C:/develop/DevServer/local/servers.json','utf8');
async function listen(server){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;if(new RegExp(`\\b${port}\\b`).test(registry)){server.close();throw Error('予約済みポートです。');}return `http://127.0.0.1:${port}`;}
const apiUrl=await listen(api),web=createWebServer({speechUrl:apiUrl}),webUrl=await listen(web);
await writeFile('runtime/recognition-harness.json',JSON.stringify({apiUrl,webUrl,id}));console.log(JSON.stringify({apiUrl,webUrl,id}));
process.on('SIGINT',()=>{web.close();api.close();process.exit(0);});
