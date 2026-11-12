// Local-only, synthetic UI acceptance. Never connects to a real recognition server.
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {createWebServer} from './serve-web.mjs';
const id='b'.repeat(32),archivedId='c'.repeat(32);let startedAt=new Date().toISOString(),ready=true,count=12,status='running',finishedAt,archivedDeleted=false;
const archived=()=>({...job(),id:archivedId,status:'complete',phase:'complete',fileName:'保存済み合成.wav',segmentCount:1,createdAt:'2026-11-11T00:00:00Z'});
const job=()=>({id,status,phase:status==='running'?'transcribing':status,fileName:'合成検証.wav',engine:'whisper',modelId:'tiny',clientId:'transcript-cutter',workload:'file',segmentCount:count,duration:90,rangeStart:60,rangeEnd:90,processedUntil:status==='complete'?90:60+Math.min(29,count/20),metadata:{startedAt,completedAt:finishedAt,executionDevice:'cpu'},...(status==='error'?{error:'合成した認識エラー'}:{})});
const api=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');const url=new URL(req.url,'http://127.0.0.1');let value;
 if(url.pathname==='/fixture/state'&&req.method==='POST'){let text='';for await(const chunk of req)text+=chunk;const state=JSON.parse(text);if(typeof state.ready==='boolean')ready=state.ready;if(['running','complete','error','cancelled'].includes(state.status)){status=state.status;finishedAt=status==='running'?undefined:new Date().toISOString();}value={ready,status};}
 else if(url.pathname==='/api/health')value={appId:'meeting-transcriber',protocolVersion:3,serverVersion:'合成検証',token:'synthetic-only',authMode:'lan',ready,capabilities:{jobDeletion:true},reason:ready?'':'認識環境・モデルの準備が必要です'};
 else if(url.pathname==='/v1/models')value={data:ready?['tiny','base','unsupported'].map(model=>({id:'whisper/'+model,x_meeting:{engineId:'whisper',engineLabel:'合成検証',modelId:model,label:'Whisper '+model,diarization:true,availability:model==='unsupported'?'unavailable':'installed',supported:model!=='unsupported',processingMethods:[{id:'cpu',label:'CPU'}],defaultProcessingMethod:'cpu'}})):[]};
 else if(url.pathname==='/api/jobs'&&req.method==='POST'){for await(const chunk of req){}await writeFile('C:/develop/TranscriptCutter/runtime/setup-upload-query.json',JSON.stringify(Object.fromEntries(url.searchParams)));status='running';startedAt=new Date().toISOString();count=1;value={job:job()};}
 else if(url.pathname==='/api/jobs'){const jobs=[job(),...(archivedDeleted?[]:[archived()])];value={jobs,total:jobs.length,nextOffset:null};}
 else if(url.pathname===`/api/jobs/${archivedId}/delete`&&req.method==='POST'){let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);if(req.headers['x-local-token']!=='synthetic-only'||body.confirm!=='delete-job'||body.clientId!=='transcript-cutter'){res.writeHead(400).end('{}');return;}archivedDeleted=true;await writeFile('C:/develop/TranscriptCutter/runtime/setup-delete-query.json',JSON.stringify({id:archivedId,...body,fixtureOnly:true}));value={deleted:true,id:archivedId};}
 else if(url.pathname===`/api/jobs/${id}/delete`){res.writeHead(409).end(JSON.stringify({error:'処理中の履歴は削除できません。'}));return;}
 else if(url.pathname===`/api/jobs/${archivedId}`){if(archivedDeleted){res.writeHead(404).end('{}');return;}value={job:archived()};}
 else if(url.pathname===`/api/jobs/${archivedId}/segments`){if(archivedDeleted){res.writeHead(404).end('{}');return;}value={segments:[{id:1,start:60,end:61,text:'保存済み合成字幕'}],total:1,next:1};}
 else if(url.pathname===`/api/jobs/${id}/cancel`){status='cancelled';finishedAt=new Date().toISOString();value={job:job()};}
 else if(url.pathname===`/api/jobs/${id}`){if(status==='running')count=Math.min(580,count+7);value={job:job()};}
 else if(url.pathname===`/api/jobs/${id}/segments`){const after=Number(url.searchParams.get('after')??0);value={segments:Array.from({length:Math.max(0,count-after)},(_,n)=>({id:after+n+1,start:60+(after+n)/20,end:60+(after+n+1)/20,text:`合成字幕${after+n+1}`})),total:count,next:count};}
 else if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<h1>合成検証用サーバー管理</h1>');return;}
 else{res.writeHead(404).end('{}');return;}res.end(JSON.stringify(value));
});
const registry=await readFile('C:/develop/DevServer/local/servers.json','utf8');
async function listen(server,requested=0){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(requested,'127.0.0.1',resolve);});const port=server.address().port;if(new RegExp(`\\b${port}\\b`).test(registry)){server.close();throw Error('予約済みポートです。');}return `http://127.0.0.1:${port}`;}
const assets=new Map(await Promise.all(['index.html','app.js','app.css','browser-whisper-worker.js'].map(async name=>{const body=await readFile('C:/develop/TranscriptCutter/dist-web/'+name);return ['/'+name,name==='index.html'?Buffer.from(body.toString().replace('</head>','<style>input.drop-input{display:block!important}</style></head>')):body];})));
const apiUrl=await listen(api),web=createWebServer({speechUrl:apiUrl,assets}),webUrl=await listen(web,Number(process.env.TC_FIXTURE_WEB_PORT??0));
await writeFile('C:/develop/TranscriptCutter/runtime/setup-harness.json',JSON.stringify({apiUrl,webUrl,id}));console.log(JSON.stringify({apiUrl,webUrl,id}));
process.on('SIGINT',()=>{web.close();api.close();process.exit(0);});
