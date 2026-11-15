import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {networkInterfaces} from 'node:os';
import {X509Certificate,randomUUID} from 'node:crypto';
import {createSecureContext} from 'node:tls';
import {extractProgram} from './embedded-program.mjs';
import {claimBundleState} from './bundled-server.mjs';
import {startStandalone,defaultOpen} from './standalone-web.mjs';
import {launcherHtml,launcherCss,launcherJs} from './launcher-page.mjs';

export async function launchNetwork(config,registryPath){
 if(config.mode==='local')return undefined;
 if(config.mode!=='lan')throw Error('利用方式を選択してください。');
 let url;try{url=new URL(config.publicUrl);}catch{throw Error('公開URLを入力してください。');}
 const addresses=Object.values(networkInterfaces()).flat().filter(Boolean).filter(x=>x.family==='IPv4'&&!x.internal).map(x=>x.address);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!addresses.includes(url.hostname)||!(/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname)))throw Error('このPCのLAN IPv4アドレスを使ったHTTPS URLを指定してください。');
 const port=Number(url.port||443);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('公開ポートは1024〜65535で指定してください。');
 if(registryPath){let registry;try{registry=JSON.parse(await readFile(registryPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(registry&&!registry.servers.some(s=>s.port===port&&s.protocol==='TCP'&&s.visibility==='lan'&&s.allocation_status==='allocated'&&s.application_id?.startsWith('transcript-cutter')))throw Error('このPCのDevServerにTranscriptCutter用のLANポートを予約してください。');
 }
 if(!isAbsolute(config.certPath||'')||!isAbsolute(config.keyPath||''))throw Error('証明書と秘密鍵の絶対パスを指定してください。');
 let tls;try{tls={cert:await readFile(config.certPath),key:await readFile(config.keyPath)};createSecureContext(tls);const certificate=new X509Certificate(tls.cert);if(!certificate.checkIP(url.hostname)||Date.parse(certificate.validTo)<=Date.now()||Date.parse(certificate.validFrom)>Date.now())throw Error();}catch{throw Error('HTTPS証明書・秘密鍵の読取権限、対応IP、有効期限を確認してください。');}
 return {lan:true,port,publicUrl:url.href,hosts:[url.host],tls};
}
const closeServer=async server=>{if(!server)return;if(server.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}await server.cleanup?.();};
export async function startUnified({payload,assets,version,args=process.argv.slice(2),env=process.env,openBrowser=defaultOpen,registryPath='C:/develop/DevServer/local/servers.json',startService=startStandalone,supervisorArgs}){
 if(args.includes('--version')){console.log(`TranscriptCutter v${version} / TranscriptionServer v${payload.serverVersion}`);return null;}
 if(args.some(x=>!['--no-open','--setup','--server'].includes(x)))throw Error('使用できる引数: --no-open / --setup / --server / --version');
 const stateDir=env.TC_UNIFIED_STATE_DIR||(env.LOCALAPPDATA?join(env.LOCALAPPDATA,'TranscriptCutter','unified'):null);
 if(!stateDir)throw Error('保存先を取得できません。');
 await mkdir(stateDir,{recursive:true});
 const claim=await claimBundleState(join(stateDir,'launcher'));
 if(claim.existingUrl){console.log(`TranscriptCutter: ${claim.existingUrl}`);if(!args.includes('--no-open'))await openBrowser(claim.existingUrl);return null;}
 let app,bootstrap,appUrl='',config={mode:'local',publicUrl:'',certPath:'',keyPath:''},saved=false,changing=false;
 const configPath=join(stateDir,'mode.json'),nonce=randomUUID();let setupUrl,directory;
 const start=async next=>{
  const network=await launchNetwork(next,registryPath);
  if(app?.managedServerUrl){
   const get=async path=>{const response=await fetch(new URL(path,app.managedServerUrl),{signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error('サーバーの処理状態を確認できません。');return response.json();};
   const status=await get('api/status'),management=await get('api/management');
   if(status.running?.length||Object.values(status.queued||{}).some(n=>n>0)||management.busy)throw Error('認識・導入処理が終わってから利用方式を変更してください。');
  }
  await closeServer(app);app=null;appUrl='';
  app=await startService({directory,assets,version,args:['--no-open'],env:{...env,TC_WEB_STATE_DIR:join(stateDir,'services'),TC_TRANSCRIPTION_URL:'',TC_TRANSCRIPTION_TOKEN:'',...(network?{TC_WEB_PORT:String(network.port)}:{})},registryPath,network,setupUrl,supervisorArgs});
  if(!app)throw Error('専用サービスはすでに起動しています。');
  appUrl=network?.publicUrl??`http://127.0.0.1:${app.address().port}/`;config=next;
 };
 try{
  directory=await extractProgram(payload,stateDir);
  try{config=JSON.parse(await readFile(configPath,'utf8'));saved=true;}catch(error){if(error.code!=='ENOENT')throw Error('利用方式の保存内容を確認してください。');}
  if(!saved){
   let port=19120;try{const registry=JSON.parse(await readFile(registryPath,'utf8'));const own=registry.servers.find(s=>s.visibility==='lan'&&s.application_id?.startsWith('transcript-cutter')&&s.allocation_status==='allocated');if(own)port=own.port;}catch{}
   const address=Object.values(networkInterfaces()).flat().find(x=>x?.family==='IPv4'&&!x.internal)?.address;
   config={...config,publicUrl:address?`https://${address}:${port}/`:'',certPath:'C:/AI/Certificates/example-Dev-Server-chain.pem',keyPath:'C:/AI/Certificates/example-Dev-Server.key'};
  }
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  bootstrap=createServer(async(req,res)=>{
   const host=req.headers.host,port=bootstrap.address().port;
   if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)||req.headers.origin&&req.headers.origin!==`http://${host}`){res.writeHead(403).end();return;}
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'");
   if(req.url==='/launcher'&&req.method==='GET'){json(res,200,{product:'TranscriptCutter',instanceId:'transcript-cutter',launcherId:claim.identity.nonce});return;}
   if(req.url==='/setup/state'&&req.method==='GET'){json(res,200,{nonce,config,appUrl});return;}
   if(req.url==='/setup/config'&&req.method==='POST'){
    if(req.headers.origin!==`http://${host}`||req.headers['x-tc-setup']!==nonce||!String(req.headers['content-type']).startsWith('application/json')){json(res,403,{error:'設定画面から操作してください。'});return;}
    if(changing){json(res,409,{error:'起動処理中です。'});return;}changing=true;
    try{let body='';for await(const chunk of req){body+=chunk;if(body.length>16384)throw Error('設定が大きすぎます。');}const value=JSON.parse(body),next={mode:value.mode,publicUrl:String(value.publicUrl||''),certPath:String(value.certPath||''),keyPath:String(value.keyPath||'')};await start(next);await writeFile(configPath,JSON.stringify(next,null,2)+'\n');json(res,200,{config,appUrl});}catch(error){json(res,400,{error:error.message});}finally{changing=false;}return;
   }
   if(req.method!=='GET'){res.writeHead(405).end();return;}
   const asset={'/':[launcherHtml,'text/html; charset=utf-8'],'/setup.js':[launcherJs,'text/javascript; charset=utf-8'],'/setup.css':[launcherCss,'text/css; charset=utf-8']}[req.url];
   if(!asset){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':asset[1]});res.end(asset[0]);
  });
  await new Promise((r,j)=>{bootstrap.once('error',j);bootstrap.listen(0,'127.0.0.1',r);});setupUrl=`http://127.0.0.1:${bootstrap.address().port}/`;
  await writeFile(join(stateDir,'launcher','launcher.json'),JSON.stringify({webPort:bootstrap.address().port,launcherId:claim.identity.nonce})+'\n');
  if(saved&&!args.includes('--setup')){try{await start(config);}catch(error){console.error('保存した利用方式で起動できません。設定画面から確認してください。');}}
  console.log(`TranscriptCutter 設定: ${setupUrl}`);
  if(!args.includes('--no-open'))await openBrowser(args.includes('--server')?setupUrl:appUrl||setupUrl);
  let cleanup;bootstrap.cleanup=()=>cleanup??=(async()=>{await closeServer(app);await claim.release();})();bootstrap.once('close',()=>{void bootstrap.cleanup();});
  return bootstrap;
 }catch(error){await closeServer(app);await closeServer(bootstrap);await claim.release();throw error;}
}
