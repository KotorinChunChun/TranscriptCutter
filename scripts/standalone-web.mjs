import {readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {createWebServer} from './serve-web.mjs';

export async function startStandalone({assets,version,args=process.argv.slice(2),env=process.env,openBrowser=defaultOpen,registryPath='C:/develop/DevServer/local/servers.json'}){
 if(args.includes('--version')){console.log(`TranscriptCutter Web v${version}`);return null;}
 if(args.some(arg=>arg!=='--no-open'))throw Error('使用できる引数: --no-open または --version');
 let registry='';try{registry=await readFile(registryPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 const requested=env.TC_WEB_PORT===undefined?0:Number(env.TC_WEB_PORT);
 const reserved=port=>new RegExp(`\\b${port}\\b`).test(registry);
 if(!Number.isInteger(requested)||requested!==0&&(requested<1024||requested>65535||reserved(requested)))throw Error('指定ポートは予約済み、または不正です。');
 const server=createWebServer({directory:dirname(process.execPath),assets,speechUrl:env.TC_TRANSCRIPTION_URL||'http://127.0.0.1:8769',speechToken:env.TC_TRANSCRIPTION_TOKEN||''});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(requested,'127.0.0.1',resolve);});
 const port=server.address().port;
 if(reserved(port)){await new Promise(resolve=>server.close(resolve));throw Error('割当ポートが台帳に予約されています。再実行してください。');}
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
