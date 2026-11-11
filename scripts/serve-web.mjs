import {createServer} from 'node:http';
import http from 'node:http';
import https from 'node:https';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {connectSpeech,serverUrl,ConnectionError} from './speech-connection.mjs';
const allowed=/^\/(?:api\/(?:health|jobs(?:\/[a-fA-F0-9]{32}(?:\/(?:segments|cancel))?)?)|v1\/models)$/;
export function createWebServer({directory=fileURLToPath(new URL('../dist-web/',import.meta.url)),speechUrl='http://127.0.0.1:8769',speechToken=''}={}){
 const root=resolve(directory),initial=serverUrl(speechUrl),sessions=new Map();
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
 const fail=(res,error)=>json(res,error instanceof ConnectionError?error.status:502,{error:error instanceof ConnectionError?error.message:'接続操作に失敗しました。',code:error instanceof ConnectionError?error.code:'connection_failed'});
 const sessionFor=req=>{
  const id=req.headers['x-tc-client']??'legacy-default';
  if(typeof id!=='string'||id!=='legacy-default'&&!/^[a-zA-Z0-9-]{16,64}$/.test(id))throw new ConnectionError('接続セッションが不正です。',400);
  if(!sessions.has(id)){if(sessions.size>=256)sessions.delete(sessions.keys().next().value);sessions.set(id,{url:initial.href,key:speechToken,connection:null,pending:null,revision:0});}
  return sessions.get(id);
 };
 const handshake=async(session,refresh=false)=>{
  if(refresh&&session.connection){const previous=session.connection;session.key=previous.health.authMode==='bearer'&&previous.target.href===session.url?previous.headers.Authorization.slice(7):'';session.connection=null;}
  if(session.connection)return session.connection;
  if(!session.pending){const revision=session.revision;session.pending=connectSpeech(session.url,session.key).then(connection=>{if(revision!==session.revision)throw new ConnectionError('接続先が変更されました。再接続してください。',409);session.connection=connection;session.key='';return connection;}).finally(()=>{if(revision===session.revision)session.pending=null;});}
  return session.pending;
 };
 const server=createServer(async(req,res)=>{
  const port=server.address()?.port;const hosts=[`127.0.0.1:${port}`,`localhost:${port}`];const host=req.headers.host??'';
  if(!hosts.includes(host)||req.headers.origin&&req.headers.origin!==`http://${host}`){res.writeHead(403).end('接続元を確認してください。');return;}
  const url=new URL(req.url,`http://${host}`);
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/connection'){
   try{
    const session=sessionFor(req);
    if(req.method==='GET'){json(res,200,{url:session.url,authMode:session.connection?.health.authMode??null});return;}
    if(req.method!=='POST'){res.writeHead(405).end();return;}
    if(!(req.headers['content-type']??'').startsWith('application/json'))throw new ConnectionError('接続設定の形式が不正です。',400);
    let text='';for await(const chunk of req){text+=chunk;if(text.length>16384)throw new ConnectionError('接続設定が大きすぎます。',413);}
    session.revision++;session.url='';session.key='';session.connection=null;session.pending=null;
    let config;try{config=JSON.parse(text);}catch{throw new ConnectionError('接続設定の形式が不正です。',400);}
    const target=serverUrl(config.url);
    if(typeof config.key!=='string')throw new ConnectionError('接続キーの形式が不正です。',400);
    session.url=target.href;session.key=config.key;
    const connection=await handshake(session);json(res,200,{url:session.url,...connection.health});
   }catch(error){fail(res,error);}return;
  }
  if(url.pathname.startsWith('/speech/')){
   const path=url.pathname.slice(7);if(!allowed.test(path)||!['GET','POST','PATCH'].includes(req.method)){res.writeHead(404).end();return;}
   let session,connection;try{session=sessionFor(req);connection=await handshake(session,path==='/api/health');}catch(error){fail(res,error);return;}
   if(path==='/api/health'){json(res,200,{...connection.health,url:session.url});return;}
   const target=connection.target;
   const headers={host:target.host,...connection.headers};for(const name of ['content-type','content-length'])if(req.headers[name])headers[name]=req.headers[name];
   const transport=target.protocol==='https:'?https:http;
   const upstream=transport.request(new URL(path+url.search,target),{method:req.method,headers},reply=>{
    if(reply.statusCode>=300&&reply.statusCode<400){reply.resume();fail(res,new ConnectionError('サーバーが別URLを返しました。接続先を確認してください。',502,'redirect_refused'));return;}
    if(reply.statusCode===401){reply.resume();if(session.connection===connection)session.connection=null;fail(res,new ConnectionError('サーバー接続キーを確認し、接続設定から再接続してください。',401,'bearer_key_required'));return;}
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
 let registry='';try{registry=await readFile('C:/develop/DevServer/local/servers.json','utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 const requested=process.env.TC_WEB_PORT?Number(process.env.TC_WEB_PORT):0;
 if(requested&&(!Number.isInteger(requested)||requested<1024||requested>65535||new RegExp(`\\b${requested}\\b`).test(registry)))throw Error('指定ポートは予約済み、または不正です。');
 const server=createWebServer({speechUrl:process.env.TC_TRANSCRIPTION_URL||'http://127.0.0.1:8769',speechToken:process.env.TC_TRANSCRIPTION_TOKEN||''});
 server.on('error',error=>{console.error(`Webサーバーを起動できません: ${error.code??'unknown'}`);process.exitCode=1;});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(requested,'127.0.0.1',resolve);});
 const port=server.address().port;if(new RegExp(`\\b${port}\\b`).test(registry)){server.close();throw Error('割当ポートが台帳に予約されています。再実行してください。');}
 server.requestTimeout=0;
 console.log(`TranscriptCutter v0.2611.5: http://127.0.0.1:${port}/`);
 const close=()=>server.close(()=>process.exit(0));process.on('SIGTERM',close);process.on('SIGINT',close);
}
