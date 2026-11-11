import {createServer} from 'node:http';
import http from 'node:http';
import https from 'node:https';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const allowed=/^\/(?:api\/(?:health|jobs(?:\/[a-fA-F0-9]{32}(?:\/(?:segments|cancel))?)?)|v1\/models)$/;
export function createWebServer({directory=resolve('dist-web'),speechUrl='http://127.0.0.1:8769',speechToken=''}={}){
 const root=resolve(directory),target=new URL(speechUrl);
 if(!['http:','https:'].includes(target.protocol)||target.username||target.password||target.search||target.hash||target.pathname!=='/')throw Error('文字起こし接続先の形式を確認してください。');
 const server=createServer(async(req,res)=>{
  const port=server.address()?.port;const hosts=[`127.0.0.1:${port}`,`localhost:${port}`];const host=req.headers.host??'';
  if(!hosts.includes(host)||req.headers.origin&&req.headers.origin!==`http://${host}`){res.writeHead(403).end('接続元を確認してください。');return;}
  const url=new URL(req.url,`http://${host}`);
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  if(url.pathname.startsWith('/speech/')){
   const path=url.pathname.slice(7);if(!allowed.test(path)||!['GET','POST','PATCH'].includes(req.method)){res.writeHead(404).end();return;}
   const headers={host:target.host};for(const name of ['content-type','content-length','x-local-token'])if(req.headers[name])headers[name]=req.headers[name];
   if(speechToken){delete headers['x-local-token'];headers.authorization=`Bearer ${speechToken}`;}
   const transport=target.protocol==='https:'?https:http;
   const upstream=transport.request(new URL(path+url.search,target),{method:req.method,headers},reply=>{
    res.writeHead(reply.statusCode??502,{'Content-Type':reply.headers['content-type']??'application/json'});reply.pipe(res);
   });
   upstream.on('error',()=>{if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'文字起こしサーバーへ接続できません。起動状態と接続設定を確認してください。'}));}else res.destroy();});
   req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});req.pipe(upstream);return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  try{
   const requested=decodeURIComponent(url.pathname);let path=resolve(root,'.'+requested);if(path!==root&&!path.startsWith(root+sep))throw Error();if((await stat(path)).isDirectory())path=resolve(path,'index.html');
   const body=await readFile(path);const type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.ico':'image/x-icon','.wasm':'application/wasm'}[extname(path)]??'application/octet-stream';
   res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'self'");
   res.writeHead(200,{'Content-Type':type});res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404).end('見つかりません。');}
 });
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const registry=await readFile('C:/develop/DevServer/local/servers.json','utf8');
 const requested=process.env.TC_WEB_PORT?Number(process.env.TC_WEB_PORT):0;
 if(requested&&(!Number.isInteger(requested)||requested<1024||requested>65535||new RegExp(`\\b${requested}\\b`).test(registry)))throw Error('指定ポートは予約済み、または不正です。');
 const server=createWebServer({speechUrl:process.env.TC_TRANSCRIPTION_URL||'http://127.0.0.1:8769',speechToken:process.env.TC_TRANSCRIPTION_TOKEN||''});
 server.on('error',error=>{console.error(`Webサーバーを起動できません: ${error.code??'unknown'}`);process.exitCode=1;});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(requested,'127.0.0.1',resolve);});
 const port=server.address().port;if(new RegExp(`\\b${port}\\b`).test(registry)){server.close();throw Error('割当ポートが台帳に予約されています。再実行してください。');}
 server.requestTimeout=0;
 console.log(`TranscriptCutter v0.2611.2: http://127.0.0.1:${port}/`);
 const close=()=>server.close(()=>process.exit(0));process.on('SIGTERM',close);process.on('SIGINT',close);
}
