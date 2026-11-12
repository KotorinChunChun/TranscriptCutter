// Local-only, synthetic UI acceptance. Never connects to a real recognition server.
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {createWebServer} from './serve-web.mjs';
const id='b'.repeat(32),startedAt=new Date().toISOString();let ready=true,count=12,status='running',finishedAt;
const job=()=>({id,status,phase:status==='running'?'transcribing':status,fileName:'合成検証.wav',engine:'whisper',modelId:'tiny',clientId:'transcript-cutter',workload:'file',segmentCount:count,duration:90,rangeStart:60,rangeEnd:90,processedUntil:status==='complete'?90:60+Math.min(29,count/20),metadata:{startedAt,completedAt:finishedAt,executionDevice:'cpu'},...(status==='error'?{error:'合成した認識エラー'}:{})});
const api=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');const url=new URL(req.url,'http://127.0.0.1');let value;
 if(url.pathname==='/fixture/state'&&req.method==='POST'){let text='';for await(const chunk of req)text+=chunk;const state=JSON.parse(text);if(typeof state.ready==='boolean')ready=state.ready;if(['running','complete','error','cancelled'].includes(state.status)){status=state.status;finishedAt=status==='running'?undefined:new Date().toISOString();}value={ready,status};}
 else if(url.pathname==='/api/health')value={appId:'meeting-transcriber',protocolVersion:3,serverVersion:'合成検証',token:'synthetic-only',authMode:'lan',ready,reason:ready?'':'認識環境・モデルの準備が必要です'};
 else if(url.pathname==='/v1/models')value={data:ready?[{id:'whisper/tiny',x_meeting:{engineId:'whisper',engineLabel:'合成検証',modelId:'tiny',label:'Whisper Tiny',processingMethods:[{id:'cpu',label:'CPU'}],defaultProcessingMethod:'cpu'}}]:[]};
 else if(url.pathname==='/api/jobs'&&req.method==='POST'){for await(const chunk of req){}status='running';count=1;value={job:job()};}
 else if(url.pathname==='/api/jobs')value={jobs:[job()]};
 else if(url.pathname===`/api/jobs/${id}/cancel`){status='cancelled';finishedAt=new Date().toISOString();value={job:job()};}
 else if(url.pathname===`/api/jobs/${id}`){if(status==='running')count=Math.min(580,count+7);value={job:job()};}
 else if(url.pathname===`/api/jobs/${id}/segments`){const after=Number(url.searchParams.get('after')??0);value={segments:Array.from({length:Math.max(0,count-after)},(_,n)=>({id:after+n+1,start:60+(after+n)/20,end:60+(after+n+1)/20,text:`合成字幕${after+n+1}`})),total:count,next:count};}
 else if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<h1>合成検証用サーバー管理</h1>');return;}
 else{res.writeHead(404).end('{}');return;}res.end(JSON.stringify(value));
});
const registry=await readFile('C:/develop/DevServer/local/servers.json','utf8');
async function listen(server){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;if(new RegExp(`\\b${port}\\b`).test(registry)){server.close();throw Error('予約済みポートです。');}return `http://127.0.0.1:${port}`;}
const apiUrl=await listen(api),web=createWebServer({speechUrl:apiUrl}),webUrl=await listen(web);
await writeFile('C:/develop/TranscriptCutter/runtime/setup-harness.json',JSON.stringify({apiUrl,webUrl,id}));console.log(JSON.stringify({apiUrl,webUrl,id}));
process.on('SIGINT',()=>{web.close();api.close();process.exit(0);});
