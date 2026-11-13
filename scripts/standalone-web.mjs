import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createWebServer} from './serve-web.mjs';
import {readBundle,claimBundleState,startSupervisedServer} from './bundled-server.mjs';

export async function startStandalone({assets,directory=dirname(process.execPath),version,args=process.argv.slice(2),env=process.env,openBrowser=defaultOpen,registryPath='C:/develop/DevServer/local/servers.json',network,setupUrl,supervisorArgs}){
 if(args.includes('--version')){console.log(`TranscriptCutter Web v${version}`);return null;}
 if(args.some(arg=>arg!=='--no-open'))throw Error('使用できる引数: --no-open または --version');
 let registry='';try{registry=await readFile(registryPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 const bundle=await readBundle(directory);
 const requested=env.TC_WEB_PORT===undefined?0:Number(env.TC_WEB_PORT),stateDir=env.TC_WEB_STATE_DIR||(env.LOCALAPPDATA?join(env.LOCALAPPDATA,'TranscriptCutter',bundle?'all-in-one':'web'):null);
 const reserved=port=>port!==network?.port&&new RegExp(`\\b${port}\\b`).test(registry);
 if(!Number.isInteger(requested)||requested!==0&&(requested<1024||requested>65535||reserved(requested)))throw Error('指定ポートは予約済み、または不正です。');
 let saved={};if(stateDir){try{saved=JSON.parse(await readFile(resolve(stateDir,'launcher.json'),'utf8'));}catch{/* First launch or unavailable preferences. */}}
 let preferred=0;if(requested===0&&Number.isInteger(saved.webPort)&&saved.webPort>=1024&&saved.webPort<=65535&&!reserved(saved.webPort))preferred=saved.webPort;
 let claim,owned,server,cleanupPromise;
 const cleanup=()=>cleanupPromise??=(async()=>{await owned?.stop();await claim?.release?.();})();
 try{
 if(bundle){
  if(!stateDir)throw Error('一体版の保存先を取得できません。');
  claim=await claimBundleState(stateDir);
  if(claim.existingUrl){console.log(`TranscriptCutter Web v${version}: ${claim.existingUrl}`);if(!args.includes('--no-open'))await openBrowser(claim.existingUrl);return null;}
  if(!env.TC_TRANSCRIPTION_URL)owned=await startSupervisedServer({directory,stateDir,registry,preferred:saved.serverPort,supervisorArgs});
 }
 const launcherInfo=claim?.identity?{product:'TranscriptCutter',version,instanceId:bundle.instanceId,launcherId:claim.identity.nonce,setupUrl,mode:network?.lan?'lan':'local'}:undefined;
 server=createWebServer({directory,assets,speechUrl:env.TC_TRANSCRIPTION_URL||owned?.url||'http://127.0.0.1:8769',speechToken:env.TC_TRANSCRIPTION_TOKEN||'',launcherInfo,codexWorkDir:stateDir?join(stateDir,'codex-work'):undefined,codexEnv:{...process.env,...env},network,management:!!owned});
 const listen=port=>new Promise((resolve,reject)=>{const fail=error=>reject(error);server.once('error',fail);server.listen(port,network?.lan?'0.0.0.0':'127.0.0.1',()=>{server.removeListener('error',fail);resolve();});});
 if(preferred){try{await listen(preferred);}catch(error){if(!['EADDRINUSE','EACCES'].includes(error.code))throw error;}}
 for(let attempt=0;!server.listening&&attempt<32;attempt++){await listen(requested);if(reserved(server.address().port)){await new Promise(resolve=>server.close(resolve));if(requested)throw Error('指定ポートは予約済みです。');}}
 if(!server.listening)throw Error('利用可能なポートを確保できません。');
 const port=server.address().port;
 if(stateDir){try{await mkdir(stateDir,{recursive:true});await writeFile(resolve(stateDir,'launcher.json'),JSON.stringify({webPort:port,...(bundle?{serverPort:owned?.port??saved.serverPort,launcherId:claim.identity.nonce}:{})})+'\n');}catch(error){if(bundle)throw error;console.error('起動先を保存できませんでした。次回のURLが変わる場合があります。');}}
 server.requestTimeout=0;server.managedServerUrl=owned?.url;
 const url=network?.publicUrl??`http://127.0.0.1:${port}/`;
 console.log(`TranscriptCutter Web v${version}: ${url}`);
 if(owned)console.log(`専用TranscriptionServer v${bundle.serverVersion}: ${owned.url}`);
 if(!args.includes('--no-open')){try{await openBrowser(url);}catch{console.error('ブラウザーを開けませんでした。表示されたURLをブラウザーで開いてください。');}}
 server.cleanup=cleanup;server.once('close',()=>{void cleanup().catch(()=>console.error('終了記録を保存できませんでした。'));});
 return server;
 }catch(error){if(server?.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}await cleanup();throw error;}
}
export function defaultOpen(url){
 return new Promise((resolve,reject)=>{
  const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'});
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('browser')));
 });
}
