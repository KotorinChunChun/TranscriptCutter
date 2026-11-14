import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,appendFile,stat,rename} from 'node:fs/promises';
import {resolve,relative,isAbsolute,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('.',import.meta.url));
const project=resolve(source,'../..');
const runtime=resolve(project,'runtime/haas-nemotron-5min');
const reserved=new Set();
const walk=value=>{if(typeof value==='number')reserved.add(value);else if(value&&typeof value==='object')Object.values(value).forEach(walk);};
walk(JSON.parse(await readFile('C:/develop/DevServer/local/servers.json','utf8')));
const inside=(base,path)=>{const out=resolve(base,path),rel=relative(base,out);if(rel.startsWith('..')||isAbsolute(rel))throw Error('path');return out;};
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.mp4':'video/mp4','.wav':'audio/wav','.vtt':'text/vtt; charset=utf-8'};
const server=createServer(async(req,res)=>{try{
  const address=`127.0.0.1:${server.address().port}`;
  if(req.headers.host!==address || req.headers.origin && req.headers.origin!==`http://${address}`){res.writeHead(403).end();return;}
  res.setHeader('Cache-Control','no-store');
  const url=new URL(req.url,`http://${address}`),path=decodeURIComponent(url.pathname);
  if(path==='/report'&&req.method==='POST'){
    let body='';for await(const chunk of req){body+=chunk;if(body.length>4_000_000)throw Error('large');}
    const data=JSON.parse(body);
    await appendFile(resolve(runtime,'events.jsonl'),JSON.stringify({...data,recordedAt:new Date().toISOString()})+'\n');
    if(data.action==='result'&&['haas','nemotron-haas'].includes(data.mode)){
      const resultPath=resolve(runtime,`${data.mode}.json`);await writeFile(`${resultPath}.tmp`,JSON.stringify(data,null,2));await rename(`${resultPath}.tmp`,resultPath);
    }
    res.end('ok');return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  if(path==='/results.json'){
    const runs=[];for(const mode of ['haas','nemotron-haas'])try{runs.push(JSON.parse(await readFile(resolve(runtime,`${mode}.json`),'utf8')));}catch{}
    let review=null;try{review=JSON.parse(await readFile(resolve(runtime,'review.json'),'utf8'));}catch{}
    res.setHeader('Content-Type',mime['.json']);res.end(JSON.stringify({runs,review}));return;
  }
  let file;
  if(path==='/sample.mp4')file=resolve(project,'dev/data/media/20261109_第2回_Copilot勉強会.part_0-5minutes.mp4');
  else if(path==='/reference.vtt')file=resolve(project,'runtime/five-minute-diarized/full-diarized.vtt');
  else if(path==='/vendor/nemotron-diar.mjs')file=resolve(runtime,'upstream-diar.js');
  else if(path.startsWith('/model/nemotron/'))file=inside(resolve(runtime,'model/nemotron'),path.slice('/model/nemotron/'.length));
  else if(path.startsWith('/model/haas/'))file=inside(resolve(project,'runtime/haas-browser-check/model'),path.slice('/model/haas/'.length));
  else if(path.startsWith('/ort/'))file=inside(resolve(project,'runtime/haas-browser-check/ort'),path.slice('/ort/'.length));
  else if(path.startsWith('/haas/'))file=inside(resolve(project,'dev/haas-web-prototype'),path.slice('/haas/'.length));
  else file=inside(source,path==='/'?'index.html':path.slice(1));
  const info=await stat(file);if(!info.isFile())throw Error('not file');
  const type=path==='/vendor/nemotron-diar.mjs'?mime['.mjs']:mime[extname(file)]??'application/octet-stream';
  res.setHeader('Content-Type',type);res.setHeader('Accept-Ranges','bytes');
  let from=0,to=info.size-1;
  if(req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match){res.writeHead(416).end();return;}from=Number(match[1]);to=match[2]?Math.min(Number(match[2]),to):to;if(from>to){res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}res.statusCode=206;res.setHeader('Content-Range',`bytes ${from}-${to}/${info.size}`);}
  res.setHeader('Content-Length',to-from+1);
  if(req.method==='HEAD')res.end();else createReadStream(file,{start:from,end:to}).on('error',()=>res.destroy()).pipe(res);
}catch{if(!res.headersSent)res.writeHead(404);res.end();}});
for(;;){await new Promise(r=>server.listen(0,'127.0.0.1',r));if(!reserved.has(server.address().port))break;await new Promise(r=>server.close(r));}
const url=`http://127.0.0.1:${server.address().port}/`;
await writeFile(resolve(runtime,'server.json'),JSON.stringify({url,pid:process.pid,startedAt:new Date().toISOString()}));
console.log(url);
