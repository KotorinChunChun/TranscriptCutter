import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),{version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const receipt=JSON.parse(await readFile(join(root,'release',`v${version}`,`TranscriptCutter-installers-v${version}.json`),'utf8'));
const folder=join(root,'runtime','installer-acceptance',randomUUID());await mkdir(folder,{recursive:true});
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const registry=await readFile('C:/develop/DevServer/local/servers.json','utf8');
const reg=join(process.env.SystemRoot,'System32','reg.exe');
for(const id of ['TranscriptCutter-Web-User','TranscriptCutter-AllInOne-User']){try{execFileSync(reg,['query',`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${id}_is1`],{stdio:'ignore'});throw Error('既存のインストールがあります。隔離導入で上書きしません。');}catch(error){if(error.status!==1)throw error;}}
const existing=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/api/health')res.end(JSON.stringify({appId:'meeting-transcriber',protocolVersion:3,serverVersion:'fixture',authMode:'local',token:'fixture-only',ready:true}));else res.end(JSON.stringify({data:[]}));});
await new Promise(r=>existing.listen(0,'127.0.0.1',r));if(new RegExp(`\\b${existing.address().port}\\b`).test(registry))throw Error('合成APIのポートが予約済みです。再実行してください。');
const fake=`http://127.0.0.1:${existing.address().port}`,records=[];
let installedDir,activeChild;
async function launch(executable,env){
 const child=spawn(executable,['--no-open'],{cwd:dirname(executable),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='';const url=await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('EXE startup: '+output)),35000);child.once('error',e=>{clearTimeout(timer);j(e);});child.once('exit',c=>{clearTimeout(timer);j(Error('EXE exited '+c+': '+output));});child.stderr.on('data',b=>{output+=b;});child.stdout.on('data',b=>{output+=b;const match=output.match(/TranscriptCutter Web[^\n]+(http:\/\/127\.0\.0\.1:\d+\/)/);if(match){clearTimeout(timer);r(match[1]);}});});
 return {child,url};
}
const terminate=async child=>{if(child.exitCode===null&&!child.signalCode)await new Promise(r=>{child.once('exit',r);child.kill();});};
try{
 for(const all of [false,true]){
  const dir=join(folder,all?'完全一体版 日本語':'通常版 日本語'),state=join(folder,all?'full-state':'normal-state');await mkdir(state,{recursive:true});await writeFile(join(state,'保存確認.txt'),'保存データはアンインストールでも残す');
  const artifact=receipt.artifacts.find(a=>a.file.includes('AllInOne')===all);assert.ok(artifact);assert.equal(await hash(artifact.file),artifact.sha256);
  execFileSync(artifact.file,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS',`/GROUP=TranscriptCutter 受入確認 ${folder.split(/[\\/]/).at(-1)}`,`/DIR=${dir}`,`/LOG=${join(folder,all?'full-install.log':'normal-install.log')}`],{stdio:'pipe',timeout:120000});installedDir=dir;
  const manifest=JSON.parse(await readFile(join(dir,'配布ファイル.json'),'utf8'));assert.equal(manifest.version,version);
  for(const [path,info] of Object.entries(manifest.files))assert.equal(await hash(join(dir,path)),info.sha256,path);
  const env={...process.env,PATH:join(process.env.SystemRoot,'System32')+';'+process.env.SystemRoot,TC_WEB_PORT:'0',TC_WEB_STATE_DIR:state,TC_TRANSCRIPTION_TOKEN:''};if(all)delete env.TC_TRANSCRIPTION_URL;else env.TC_TRANSCRIPTION_URL=fake;
  const run=await launch(join(dir,'TranscriptCutter.exe'),env);activeChild=run.child;let serverUrl,initialPid,restartedPid;
  try{
   for(const [path,digest] of Object.entries(receipt.exe.assets)){const response=await fetch(new URL(path,run.url));assert.equal(response.status,200);assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),digest);}
   const connection=await(await fetch(run.url+'connection')).json();serverUrl=connection.url;
   if(all){
    const url=new URL(serverUrl);assert.equal(url.hostname,'127.0.0.1');assert.notEqual(url.port,'8769');assert.ok(!new RegExp(`\\b${url.port}\\b`).test(registry));
    const health=await(await fetch(new URL('api/health',serverUrl))).json();assert.equal(health.instanceId,'transcript-cutter');assert.equal(health.serverVersion,receipt.server.serverVersion);assert.equal(health.capabilities.jobDeletion,true);assert.equal(health.capabilities.sourceMediaDigest,true);assert.equal(health.capabilities.mediaDeduplication,true);
    const record=JSON.parse(await readFile(join(state,'server-process.json'),'utf8'));initialPid=record.pid;
    const models=await(await fetch(new URL('v1/models',serverUrl))).json();assert.ok(Array.isArray(models.data));assert.ok(!models.data.some(m=>m.x_meeting?.engineId==='nemotron-transcribe'&&m.x_meeting?.supported!==false));
    const repeat=await launch(join(dir,'TranscriptCutter.exe'),env);assert.equal(repeat.url,run.url);if(repeat.child.exitCode===null)await new Promise(r=>repeat.child.once('exit',r));
    const response=await fetch(new URL('api/management/restart',serverUrl),{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':health.token},body:JSON.stringify({confirm:'restart-server'})});assert.equal(response.status,200);
    for(let n=0;n<100;n++){try{const next=JSON.parse(await readFile(join(state,'server-process.json'),'utf8'));if(next.pid!==initialPid&&(await fetch(new URL('api/health',serverUrl),{signal:AbortSignal.timeout(500)})).ok){restartedPid=next.pid;break;}}catch{}await pause(100);}
    assert.ok(restartedPid);assert.notEqual(initialPid,restartedPid);
    await writeFile(join(state,'server-data','保持確認.txt'),'削除しない');
   }else assert.equal(new URL(serverUrl).origin,new URL(fake).origin);
  }finally{await terminate(run.child);activeChild=null;}
  if(all){let stopped=false;for(let n=0;n<80;n++){try{await fetch(new URL('api/health',serverUrl),{signal:AbortSignal.timeout(100)});}catch{stopped=true;break;}await pause(50);}assert.equal(stopped,true,'restart descendant must stop with launcher');}
  execFileSync(join(dir,'unins000.exe'),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',`/LOG=${join(folder,all?'full-uninstall.log':'normal-uninstall.log')}`],{stdio:'pipe',timeout:60000});
  installedDir=null;
  assert.equal(await readFile(join(state,'保存確認.txt'),'utf8'),'保存データはアンインストールでも残す');if(all)assert.equal(await readFile(join(state,'server-data','保持確認.txt'),'utf8'),'削除しない');
  await assert.rejects(access(join(dir,'TranscriptCutter.exe')));
  records.push({variant:all?'all-in-one':'normal',installer:artifact.file,sha256:artifact.sha256,installedFileHashesVerified:Object.keys(manifest.files).length,noNodePath:true,embeddedAssetsVerified:true,privateServerVersion:all?receipt.server.serverVersion:null,privateServerRestart:all,initialPid,restartedPid,duplicateReused:all,descendantsStopped:all,dataRetained:true,uninstalled:true});
 }
 assert.equal((await fetch(fake+'/api/health')).status,200);
 const report={version,folder,result:'passed',records,sharedServersChanged:false,modelDownloads:false,realTranscription:false};await writeFile(join(root,'runtime','installer-acceptance.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{try{if(activeChild)await terminate(activeChild);if(installedDir)execFileSync(join(installedDir,'unins000.exe'),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',`/LOG=${join(folder,'failure-uninstall.log')}`],{stdio:'pipe',timeout:60000});}finally{existing.closeAllConnections();await new Promise(r=>existing.close(r));}}
