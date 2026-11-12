import {readFile,writeFile,mkdir,open,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';

const pause=ms=>new Promise(r=>setTimeout(r,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
export async function readBundle(directory){
 let bundle;try{bundle=JSON.parse(await readFile(join(directory,'TranscriptCutter.bundle.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw Error('一体版の構成を読み込めません。再インストールしてください。');}
 if(bundle.product!=='TranscriptCutter'||bundle.schema!==1||bundle.instanceId!=='transcript-cutter'||!/^[a-f0-9]{64}$/.test(bundle.serverSha256)||!/^[a-f0-9]{40}$/.test(bundle.sourceCommit))throw Error('一体版の構成が不正です。');
 const executable=resolve(directory,'transcription-server','TranscriptionServer.exe');
 const build=JSON.parse(await readFile(resolve(directory,'transcription-server','BUILD.json'),'utf8'));
 if(build.version!==bundle.serverVersion||build.gitCommit!==bundle.sourceCommit||build.sourceDirty!==false||build.distribution!=='program-only'||build.releaseStatus!=='release'||build.bundledModels!==false||build.bundledMediaTools!==false||build.bundledRecognitionRuntimes!==false)throw Error('同梱サーバーの配布情報が一致しません。');
 if(createHash('sha256').update(await readFile(executable)).digest('hex')!==bundle.serverSha256)throw Error('同梱サーバーが変更されています。再インストールしてください。');
 let processOwner;
 if(bundle.processOwnerSha256){processOwner=resolve(directory,'TranscriptCutterProcess.exe');if(createHash('sha256').update(await readFile(processOwner)).digest('hex')!==bundle.processOwnerSha256)throw Error('プロセス管理プログラムが一致しません。');}
 return {...bundle,executable,processOwner};
}

// The lock is held by the launcher; a second launch opens its verified web URL.
// Never stop a PID recovered from disk: only this launch's ChildProcess is killed.
export async function claimBundleState(stateDir){
 await mkdir(stateDir,{recursive:true});const path=join(stateDir,'instance.lock');
 const identity={pid:process.pid,nonce:randomUUID(),instanceId:'transcript-cutter'};
 for(let n=0;n<100;n++){
  try{const handle=await open(path,'wx');try{await handle.writeFile(JSON.stringify(identity));}finally{await handle.close();}
   return {identity,release:async()=>{try{if(JSON.parse(await readFile(path,'utf8')).nonce===identity.nonce)await unlink(path);}catch(error){if(error.code!=='ENOENT')throw error;}}};
  }catch(error){if(error.code!=='EEXIST')throw error;}
  let existing;try{existing=JSON.parse(await readFile(path,'utf8'));}catch{await pause(100);continue;}
  if(!Number.isInteger(existing.pid)||existing.pid<=0||typeof existing.nonce!=='string')throw Error('一体版の起動記録が不正です。');
  if(!alive(existing.pid)){const raw=await readFile(path,'utf8');if(JSON.parse(raw).nonce===existing.nonce)await unlink(path);continue;}
  try{
   const saved=JSON.parse(await readFile(join(stateDir,'launcher.json'),'utf8'));
   if(saved.launcherId===existing.nonce&&Number.isInteger(saved.webPort)&&saved.webPort>=1024&&saved.webPort<=65535){
    const url=`http://127.0.0.1:${saved.webPort}/`,response=await fetch(url+'launcher',{redirect:'error',signal:AbortSignal.timeout(700)}),value=await response.json();
    if(value.product==='TranscriptCutter'&&value.launcherId===existing.nonce&&value.instanceId==='transcript-cutter')return {existingUrl:url};
   }
  }catch{/* The owning process may still be starting. */}
  await pause(100);
 }
 throw Error('一体版は起動中です。先に開いた起動画面を確認してください。');
}

async function freePort(reserved,preferred){
 const listener=createServer();
 const bind=port=>new Promise((r,j)=>{listener.once('error',j);listener.listen(port,'127.0.0.1',()=>{listener.removeListener('error',j);r();});});
 const close=()=>new Promise(r=>listener.close(r));
 if(preferred>=1024&&preferred<=65535&&preferred!==8769&&!reserved(preferred)){try{await bind(preferred);await close();return preferred;}catch(error){if(!['EADDRINUSE','EACCES'].includes(error.code))throw error;}}
 for(let n=0;n<32;n++){await bind(0);const port=listener.address().port;await close();if(port!==8769&&!reserved(port))return port;}
 throw Error('専用サーバーのポートを確保できません。');
}

export async function startBundledServer({bundle,stateDir,reserved,preferred=0,spawnProcess=spawn,startTimeout=20000,signal}){
 const settings=join(stateDir,'server-settings'),data=join(stateDir,'server-data'),record=join(stateDir,'server-process.json');
 await mkdir(settings,{recursive:true});await mkdir(data,{recursive:true});
 const port=await freePort(reserved,preferred),url=`http://127.0.0.1:${port}/`;
 const args=['--instance-id',bundle.instanceId,'--local','--host','127.0.0.1','--port',String(port),'--data-dir',data,'--settings-dir',settings,'--process-record',record,'--no-browser'];
 const child=spawnProcess(bundle.executable,args,{cwd:resolve(bundle.executable,'..'),windowsHide:true,stdio:['ignore','ignore','pipe']});
 let failed,ended=false;
 child.once('error',error=>{failed=error;});child.once('exit',()=>{ended=true;});child.stderr?.on('data',()=>{/* Do not expose server internals or credentials in launcher output. */});
 const kill=()=>{if(child.pid&&!ended)child.kill();};process.once('exit',kill);
 const stop=async()=>{process.removeListener('exit',kill);if(ended)return;await new Promise(r=>{const timer=setTimeout(r,4000);child.once('exit',()=>{clearTimeout(timer);r();});kill();});};
 try{
  const deadline=Date.now()+startTimeout;
  while(Date.now()<deadline){
   if(signal?.aborted)throw Error('起動を中止しました。');
   if(failed||ended)throw Error('専用サーバーを起動できません。使用中のポートや同梱ファイルを確認してください。');
   try{
    const response=await fetch(url+'api/health',{redirect:'error',signal:AbortSignal.timeout(700)});
    if(response.ok){const health=await response.json(),owner=JSON.parse(await readFile(record,'utf8'));
     if(health.appId==='meeting-transcriber'&&health.instanceId===bundle.instanceId&&owner.instanceId===bundle.instanceId&&owner.pid===(child.serverPid??child.pid)&&owner.port===port&&typeof owner.started_at==='string'&&resolve(owner.executable).toLowerCase()===resolve(bundle.executable).toLowerCase()){
      await writeFile(join(stateDir,'bundled-server.json'),JSON.stringify({pid:owner.pid,port,instanceId:bundle.instanceId,startedAt:owner.started_at,version:bundle.serverVersion,sha256:bundle.serverSha256})+'\n');
      return {url,port,child,stop};
     }
    }
   }catch{/* Wait only for the owned child and matching process record. */}
   await pause(100);
  }
  throw Error('専用サーバーの起動確認がタイムアウトしました。');
 }catch(error){await stop();throw error;}
}

// An EOF on this private pipe also arrives when Windows terminates the launcher.
// Keep server ownership in this small supervisor so a closed console cannot
// leave a second server using the same data directory on the next launch.
export async function runServerSupervisor({spawnProcess=spawn}={}){
 const abort=new AbortController();let owned;
 process.stdin.once('end',()=>{abort.abort();void owned?.stop().then(()=>process.exit(0));});
 process.stdin.resume();
 const config=await new Promise((r,j)=>{
  let text='';
  process.stdin.on('data',chunk=>{
   text+=chunk;
   if(text.length>32768){j(Error('構成が大きすぎます。'));return;}
   if(text.includes('\n')){try{r(JSON.parse(text.trim()));}catch{j(Error('構成が不正です。'));}}
  });
  process.stdin.once('error',j);process.stdin.once('end',()=>j(Error('起動元を終了しました。')));
 });
 const bundle=await readBundle(config.directory);if(!bundle)throw Error('一体版の構成がありません。');
 const registry=String(config.registry||'');
 if(bundle.processOwner){spawnProcess=(exe,args,options)=>{
  const child=spawn(bundle.processOwner,[exe,...args],{...options,stdio:['pipe','pipe','pipe']});let buffer='';
  child.stdout.on('data',data=>{buffer+=data;if(buffer.length>1024){child.kill();return;}if(buffer.includes('\n')){try{const {pid}=JSON.parse(buffer.trim());if(Number.isInteger(pid)&&pid>0)child.serverPid=pid;else child.kill();}catch{child.kill();}}});
  child.stdin.on('error',()=>{});return child;
 };}
 owned=await startBundledServer({bundle,stateDir:config.stateDir,preferred:config.preferred,reserved:port=>new RegExp(`\\b${port}\\b`).test(registry),signal:abort.signal,spawnProcess});
 if(abort.signal.aborted){await owned.stop();return;}
 process.stdout.on('error',()=>{abort.abort();void owned.stop().then(()=>process.exit(0));});
 process.stdout.write(JSON.stringify({ready:true,port:owned.port,pid:owned.child.pid})+'\n');
}

export async function startSupervisedServer({directory,stateDir,registry,preferred=0,supervisorArgs=['--tc-server-supervisor']}){
 const reservedPorts=[...new Set(String(registry).match(/\b\d{4,5}\b/g)??[])].filter(p=>Number(p)<=65535).join(',');
 const child=spawn(process.execPath,supervisorArgs,{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let ended=false,exitError;child.once('exit',()=>{ended=true;});child.once('error',error=>{exitError=error;});child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
 const stop=async()=>{if(ended)return;await new Promise(r=>{const timer=setTimeout(()=>{child.kill();r();},5000);child.once('exit',()=>{clearTimeout(timer);r();});child.stdin.end();});};
 try{
  const ready=await new Promise((r,j)=>{let buffer='';const timer=setTimeout(()=>j(Error('専用サーバーの起動確認がタイムアウトしました。')),25000);const fail=()=>{clearTimeout(timer);j(Error('専用サーバーを起動できません。'));};child.once('error',fail);child.once('exit',fail);child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>32768){fail();return;}if(buffer.includes('\n')){try{const data=JSON.parse(buffer.trim());if(data.ready!==true||!Number.isInteger(data.port)||data.port<1024||data.port>65535||data.port===8769)throw Error();clearTimeout(timer);r(data);}catch{fail();}}});
   child.stdin.write(JSON.stringify({directory,stateDir,registry:reservedPorts,preferred})+'\n');
  });
  return {url:`http://127.0.0.1:${ready.port}/`,port:ready.port,child,stop};
 }catch(error){await stop();throw exitError||error;}
}
