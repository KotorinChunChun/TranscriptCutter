import http from 'node:http';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,extname,relative,isAbsolute} from 'node:path';
const root=resolve(process.argv[2]||''),repo=resolve(import.meta.dirname,'..');
if(!process.argv[2])throw Error('Pass the experiment output directory');
JSON.parse(await readFile(resolve(root,'report.json'),'utf8'));
const sample=resolve(repo,'runtime/sample-workflow-1794579124688/第2回AI勉強会-20261109_先頭1分.mp4');
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.wav':'audio/wav','.mp4':'video/mp4','.vtt':'text/vtt; charset=utf-8'};
const server=http.createServer(async(req,res)=>{try{
 const host=req.headers.host;if(![`127.0.0.1:${server.address().port}`,`localhost:${server.address().port}`].includes(host)){res.writeHead(403).end();return;}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
 const path=decodeURIComponent(new URL(req.url,'http://'+host).pathname);let file;
 res.setHeader('Cache-Control','no-store');
 if(path==='/')file=resolve(repo,'scripts/word-timing-report.html');
 else if(path==='/report.js')file=resolve(repo,'scripts/word-timing-report-client.mjs');
 else if(path==='/sample.mp4')file=sample;
 else if(path==='/app'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>単語時刻比較用 - TranscriptCutter - v0.1.1</title><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script type="module" src="/app.js"></script>');return;}
 else if(path==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(`const p=document.createElement('div');p.style='position:fixed;bottom:0;right:0;z-index:99999;background:#fff5d8;padding:4px;font:16px system-ui';const b=document.createElement('button');b.style='font:inherit';b.textContent='先頭1分＋時刻なし／ありVTTを読込';p.append(b);const a=document.createElement('a');a.href='/';a.textContent=' 比較レポート';p.append(a);document.body.append(p);b.onclick=async()=>{b.disabled=true;try{const r=await(await fetch('/files/report.json')).json();const inputs=[['/sample.mp4','指定サンプル_先頭1分.mp4','video/mp4'],['/files/'+encodeURIComponent(r.runs[0].vttFile),'単語時刻なし.vtt','text/vtt'],['/files/'+encodeURIComponent(r.runs[1].vttFile),'単語時刻あり.vtt','text/vtt']];const dt=new DataTransfer();for(const [url,name,type] of inputs){const response=await fetch(url);if(!response.ok)throw Error('読込失敗');dt.items.add(new File([await response.blob()],name,{type}));}const target=document.querySelector('.app-shell');target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));b.textContent='投入済（VTTには単語時刻を格納していません）';}catch(e){b.textContent=e.message;b.disabled=false;}};`);return;}
 else if(/^\/(app\.(js|css)|browser-whisper-worker.js)$/.test(path))file=resolve(repo,'dist-web',path.slice(1));
 else if(path.startsWith('/files/')){file=resolve(root,path.slice(7));const rel=relative(root,file);if(rel.startsWith('..')||isAbsolute(rel))throw Error('path');}
 else if(path==='/connection'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({url:'http://127.0.0.1:1/',connected:false}));return;}
 else{res.writeHead(404).end();return;}
 const s=await stat(file);res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.setHeader('Accept-Ranges','bytes');
 let start=0,end=s.size-1;const range=req.headers.range;
 if(range){const m=/^bytes=(\d+)-(\d*)$/.exec(range);if(!m){res.writeHead(416).end();return;}start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end;if(start>end){res.writeHead(416).end();return;}res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${s.size}`);}
 res.setHeader('Content-Length',end-start+1);if(req.method==='HEAD'){res.end();return;}createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
 }catch{if(!res.headersSent)res.writeHead(404);res.end();}});
const reserved=new Set();const walk=x=>{if(typeof x==='number'&&x>0&&x<65536)reserved.add(x);else if(x&&typeof x==='object')Object.values(x).forEach(walk);};walk(JSON.parse(await readFile('C:/develop/DevServer/local/servers.json','utf8')));
for(;;){await new Promise(r=>server.listen(0,'127.0.0.1',r));if(!reserved.has(server.address().port))break;await new Promise(r=>server.close(r));}
const url=`http://127.0.0.1:${server.address().port}/`;await writeFile(resolve(root,'server.json'),JSON.stringify({pid:process.pid,url,root},null,2));console.log(url);
