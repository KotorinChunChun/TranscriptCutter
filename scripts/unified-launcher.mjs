import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {extractProgram} from './embedded-program.mjs';
import {claimBundleState} from './bundled-server.mjs';
import {startStandalone,defaultOpen} from './standalone-web.mjs';
import {launcherHtml,launcherCss,launcherJs} from './launcher-page.mjs';
import {currentLanAddresses,ipStatus,lanUrl,requireAllocatedPort,inspectLanCertificate,saveServerRequest} from './lan-certificates.mjs';
import {createClientTrustGuide} from './client-trust-guide.mjs';

export async function launchNetwork(config,registryPath){
 if(config.mode==='local')return undefined;
 if(config.mode!=='lan')throw Error('利用方式を選択してください。');
 const url=lanUrl(config.publicUrl),port=Number(url.port||443);await requireAllocatedPort(port,registryPath);
 const certificate=await inspectLanCertificate(config);
 const guideValue=String(config.clientGuidePort??'').trim(),guidePort=guideValue?Number(guideValue):0;
 if(guideValue){if(guidePort===port)throw Error('HTTP導入案内とHTTPS公開URLには別のポートを指定してください。');await requireAllocatedPort(guidePort,registryPath);if(!certificate.rootDer)throw Error('HTTP導入案内を公開するには、社内共通CAの公開証明書を指定してください。');}
 return {lan:true,port,publicUrl:url.href,hosts:[url.host],tls:certificate.tls,certificate:certificate.details,rootDer:certificate.rootDer,guidePort};
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
 let app,bootstrap,guide,guideInfo=null,certificatePreview=null,appUrl='',config={mode:'local',publicUrl:'',certPath:'',keyPath:'',rootCaPath:'',clientGuidePort:''},saved=false,changing=false,startupError='',latestRequest=null;
 const configPath=join(stateDir,'mode.json'),nonce=randomUUID();let setupUrl,directory;
 const start=async next=>{
  const network=await launchNetwork(next,registryPath);
  if(app?.managedServerUrl){
   const get=async path=>{const response=await fetch(new URL(path,app.managedServerUrl),{signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error('サーバーの処理状態を確認できません。');return response.json();};
   const status=await get('api/status'),management=await get('api/management');
   if(status.running?.length||Object.values(status.queued||{}).some(n=>n>0)||management.busy)throw Error('認識・導入処理が終わってから利用方式を変更してください。');
  }
  let pendingGuide;
  if(network?.guidePort&&(!guide||guide.address().port!==network.guidePort)){
   // Preflight the additional listener before stopping an existing transcription server.
   pendingGuide=createClientTrustGuide({getHosts:()=>guideInfo?[`${new URL(guideInfo.publicUrl).hostname}:${guideInfo.guidePort}`]:[],getInfo:()=>guideInfo});
   try{await new Promise((r,j)=>{pendingGuide.once('error',j);pendingGuide.listen(network.guidePort,'0.0.0.0',r);});}catch{await closeServer(pendingGuide);throw Error(`HTTP導入案内のポート ${network.guidePort} を使えません。使用中のアプリを確認し、別の予約済みポートを指定してください。`);}
  }
  try{
   await closeServer(app);app=null;appUrl='';
   app=await startService({directory,assets,version,args:['--no-open'],env:{...env,TC_WEB_STATE_DIR:join(stateDir,'services'),TC_TRANSCRIPTION_URL:'',TC_TRANSCRIPTION_TOKEN:'',...(network?{TC_WEB_PORT:String(network.port)}:{})},registryPath,network,setupUrl,supervisorArgs});
   if(!app)throw Error('専用サービスはすでに起動しています。');
  }catch(error){await closeServer(pendingGuide);throw error;}
  if(pendingGuide){await closeServer(guide);guide=pendingGuide;}else if(!network?.guidePort){await closeServer(guide);guide=null;}
  guideInfo=network?.rootDer?network:null;certificatePreview=network?.rootDer?network:null;
  appUrl=network?.publicUrl??`http://127.0.0.1:${app.address().port}/`;config=next;
 };
 try{
  directory=await extractProgram(payload,stateDir);
  try{config=JSON.parse(await readFile(configPath,'utf8'));saved=true;}catch(error){if(error.code!=='ENOENT')throw Error('利用方式の保存内容を確認してください。');}
  if(!saved){
   let port=19120;try{const registry=JSON.parse(await readFile(registryPath,'utf8'));const own=registry.servers.find(s=>s.visibility==='lan'&&s.application_id?.startsWith('transcript-cutter')&&s.allocation_status==='allocated');if(own)port=own.port;}catch{}
   const address=currentLanAddresses()[0];
   config={...config,publicUrl:address?`https://${address}:${port}/`:''};
  }
  try{latestRequest=JSON.parse(await readFile(join(stateDir,'certificate-request.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('証明書申請の保存記録を確認してください。');}
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  bootstrap=createServer(async(req,res)=>{
   const host=req.headers.host,port=bootstrap.address().port;
   if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)||req.headers.origin&&req.headers.origin!==`http://${host}`){res.writeHead(403).end();return;}
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'");
   if(req.url==='/launcher'&&req.method==='GET'){json(res,200,{product:'TranscriptCutter',instanceId:'transcript-cutter',launcherId:claim.identity.nonce});return;}
   if(req.url==='/setup/state'&&req.method==='GET'){json(res,200,{nonce,config,appUrl,startupError,network:ipStatus(config),certificateRequest:latestRequest,certificate:guideInfo?.certificate??null,clientGuideUrl:guideInfo?.guidePort?`http://${new URL(guideInfo.publicUrl).hostname}:${guideInfo.guidePort}/`:''});return;}
   if(req.url==='/setup/root-ca.cer'&&req.method==='GET'){const publicCa=certificatePreview?.rootDer;if(!publicCa){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':'application/pkix-cert','Content-Disposition':'attachment; filename="TranscriptCutter-RootCA.cer"'});res.end(publicCa);return;}
   if(req.url==='/setup/certificate-request.csr'&&req.method==='GET'){
    if(!/^[a-f0-9-]{36}$/.test(latestRequest?.id??'')){res.writeHead(404).end();return;}
    try{const csr=await readFile(join(stateDir,'certificate-requests',latestRequest.id,'server.csr'));res.writeHead(200,{'Content-Type':'application/pkcs10','Content-Disposition':'attachment; filename="TranscriptCutter-server.csr"'});res.end(csr);}catch{json(res,404,{error:'保存した証明書申請が見つかりません。再作成してください。'});}return;
   }
   if(['/setup/certificate-request','/setup/certificate-check'].includes(req.url)&&req.method==='POST'){
    if(req.headers.origin!==`http://${host}`||req.headers['x-tc-setup']!==nonce||!String(req.headers['content-type']).startsWith('application/json')){json(res,403,{error:'設定画面から操作してください。'});return;}
    if(changing){json(res,409,{error:'別の設定処理中です。'});return;}changing=true;
    try{let text='';for await(const chunk of req){text+=chunk;if(text.length>16384)throw Error('設定が大きすぎます。');}const value=JSON.parse(text);lanUrl(value.publicUrl);
     if(req.url==='/setup/certificate-request'){const result=await saveServerRequest(stateDir,currentLanAddresses());const {csr,...record}=result;latestRequest=record;json(res,200,{request:record});}
     else{const result=await inspectLanCertificate(value);certificatePreview={rootDer:result.rootDer,certificate:result.details};json(res,200,{certificate:result.details});}
    }catch(error){json(res,400,{error:error.message});}finally{changing=false;}return;
   }
   if(req.url==='/setup/config'&&req.method==='POST'){
    if(req.headers.origin!==`http://${host}`||req.headers['x-tc-setup']!==nonce||!String(req.headers['content-type']).startsWith('application/json')){json(res,403,{error:'設定画面から操作してください。'});return;}
    if(changing){json(res,409,{error:'起動処理中です。'});return;}changing=true;
    try{let body='';for await(const chunk of req){body+=chunk;if(body.length>16384)throw Error('設定が大きすぎます。');}const value=JSON.parse(body),next={mode:value.mode,publicUrl:String(value.publicUrl||''),certPath:String(value.certPath||''),keyPath:String(value.keyPath||''),rootCaPath:String(value.rootCaPath||''),clientGuidePort:String(value.clientGuidePort||'')};await start(next);startupError='';await writeFile(configPath,JSON.stringify(next,null,2)+'\n');json(res,200,{config,appUrl,certificate:guideInfo?.certificate??null,clientGuideUrl:guideInfo?.guidePort?`http://${new URL(guideInfo.publicUrl).hostname}:${guideInfo.guidePort}/`:''});}catch(error){json(res,400,{error:error.message});}finally{changing=false;}return;
   }
   if(req.method!=='GET'){res.writeHead(405).end();return;}
   const asset={'/':[launcherHtml,'text/html; charset=utf-8'],'/setup.js':[launcherJs,'text/javascript; charset=utf-8'],'/setup.css':[launcherCss,'text/css; charset=utf-8']}[req.url];
   if(!asset){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':asset[1]});res.end(asset[0]);
  });
  await new Promise((r,j)=>{bootstrap.once('error',j);bootstrap.listen(0,'127.0.0.1',r);});setupUrl=`http://127.0.0.1:${bootstrap.address().port}/`;
  await writeFile(join(stateDir,'launcher','launcher.json'),JSON.stringify({webPort:bootstrap.address().port,launcherId:claim.identity.nonce})+'\n');
  if(saved&&!args.includes('--setup')){try{await start(config);}catch(error){startupError=error.message;console.error('保存した利用方式で起動できません。設定画面から確認してください。');}}
  console.log(`TranscriptCutter 設定: ${setupUrl}`);
  if(!args.includes('--no-open'))await openBrowser(args.includes('--server')?setupUrl:appUrl||setupUrl);
  let cleanup;bootstrap.cleanup=()=>cleanup??=(async()=>{await closeServer(app);await closeServer(guide);await claim.release();})();bootstrap.once('close',()=>{void bootstrap.cleanup();});
  return bootstrap;
 }catch(error){await closeServer(app);await closeServer(guide);await closeServer(bootstrap);await claim.release();throw error;}
}
