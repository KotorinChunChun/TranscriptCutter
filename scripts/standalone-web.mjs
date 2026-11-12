import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createWebServer} from './serve-web.mjs';

export async function startStandalone({assets,directory=dirname(process.execPath),version,args=process.argv.slice(2),env=process.env,openBrowser=defaultOpen,registryPath='C:/develop/DevServer/local/servers.json'}){
 if(args.includes('--version')){console.log(`TranscriptCutter Web v${version}`);return null;}
 if(args.some(arg=>arg!=='--no-open'))throw Error('使用できる引数: --no-open または --version');
 let registry='';try{registry=await readFile(registryPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 const requested=env.TC_WEB_PORT===undefined?0:Number(env.TC_WEB_PORT),stateDir=env.TC_WEB_STATE_DIR||(env.LOCALAPPDATA?join(env.LOCALAPPDATA,'TranscriptCutter','web'):null);
 const reserved=port=>new RegExp(`\\b${port}\\b`).test(registry);
 if(!Number.isInteger(requested)||requested!==0&&(requested<1024||requested>65535||reserved(requested)))throw Error('指定ポートは予約済み、または不正です。');
 let preferred=0;if(stateDir&&requested===0){try{const saved=JSON.parse(await readFile(resolve(stateDir,'launcher.json'),'utf8'));if(Number.isInteger(saved.webPort)&&saved.webPort>=1024&&saved.webPort<=65535&&!reserved(saved.webPort))preferred=saved.webPort;}catch{/* First launch or unavailable preferences: choose an unused loopback port. */}}
 const server=createWebServer({directory,assets,speechUrl:env.TC_TRANSCRIPTION_URL||'http://127.0.0.1:8769',speechToken:env.TC_TRANSCRIPTION_TOKEN||''});
 const listen=port=>new Promise((resolve,reject)=>{const fail=error=>reject(error);server.once('error',fail);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',fail);resolve();});});
 if(preferred){try{await listen(preferred);}catch(error){if(!['EADDRINUSE','EACCES'].includes(error.code))throw error;}}
 for(let attempt=0;!server.listening&&attempt<32;attempt++){await listen(requested);if(reserved(server.address().port)){await new Promise(resolve=>server.close(resolve));if(requested)throw Error('指定ポートは予約済みです。');}}
 if(!server.listening)throw Error('利用可能なポートを確保できません。');
 const port=server.address().port;
 if(stateDir){try{await mkdir(stateDir,{recursive:true});await writeFile(resolve(stateDir,'launcher.json'),JSON.stringify({webPort:port})+'\n');}catch{console.error('起動先を保存できませんでした。次回のURLが変わる場合があります。');}}
 server.requestTimeout=0;
 const url=`http://127.0.0.1:${port}/`;
 console.log(`TranscriptCutter Web v${version}: ${url}`);
 if(!args.includes('--no-open')){try{await openBrowser(url);}catch{console.error('ブラウザーを開けませんでした。表示されたURLをブラウザーで開いてください。');}}
 return server;
}
function defaultOpen(url){
 return new Promise((resolve,reject)=>{
  const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'});
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('browser')));
 });
}
