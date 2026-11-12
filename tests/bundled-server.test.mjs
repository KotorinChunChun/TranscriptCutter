import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readBundle,claimBundleState,startBundledServer} from '../scripts/bundled-server.mjs';
import {createWebServer} from '../scripts/serve-web.mjs';
const stop=server=>{server.closeAllConnections();return new Promise(r=>server.close(r));};
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
test('bundle identity validates its exact program-only release and refuses changed files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tc-bundle-'));
 try{
  assert.equal(await readBundle(dir),null);await mkdir(join(dir,'transcription-server'));
  await writeFile(join(dir,'transcription-server','TranscriptionServer.exe'),'fixture');
  const bundle={schema:1,product:'TranscriptCutter',instanceId:'transcript-cutter',serverVersion:'0.1.8',sourceCommit:'a'.repeat(40),serverSha256:createHash('sha256').update('fixture').digest('hex')};
  await writeFile(join(dir,'TranscriptCutter.bundle.json'),JSON.stringify(bundle));
  await writeFile(join(dir,'transcription-server','BUILD.json'),JSON.stringify({version:'0.1.8',gitCommit:bundle.sourceCommit,sourceDirty:false,distribution:'program-only',releaseStatus:'release',bundledModels:false,bundledMediaTools:false,bundledRecognitionRuntimes:false}));
  assert.equal((await readBundle(dir)).serverVersion,'0.1.8');
  await writeFile(join(dir,'transcription-server','TranscriptionServer.exe'),'modified');await assert.rejects(readBundle(dir),/変更/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('forced launcher termination closes the private pipe and releases its server',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tc-supervise-'));let parent;
 try{
  const moduleUrl=pathToFileURL(resolve('scripts/bundled-server.mjs')).href,exe=join(dir,'transcription-server','TranscriptionServer.exe');await mkdir(join(dir,'transcription-server'));await writeFile(exe,'fixture');
  await writeFile(join(dir,'TranscriptCutter.bundle.json'),JSON.stringify({schema:1,product:'TranscriptCutter',instanceId:'transcript-cutter',serverVersion:'fixture',sourceCommit:'a'.repeat(40),serverSha256:createHash('sha256').update('fixture').digest('hex')}));
  await writeFile(join(dir,'transcription-server','BUILD.json'),JSON.stringify({version:'fixture',gitCommit:'a'.repeat(40),sourceDirty:false,distribution:'program-only',releaseStatus:'release',bundledModels:false,bundledMediaTools:false,bundledRecognitionRuntimes:false}));
  const fake=join(dir,'server.mjs');await writeFile(fake,`import{createServer}from'node:http';import{writeFileSync}from'node:fs';const a=process.argv.slice(2),v=k=>a[a.indexOf(k)+1],port=Number(v('--port')),instanceId=v('--instance-id');createServer((q,s)=>s.end(JSON.stringify({appId:'meeting-transcriber',instanceId}))).listen(port,'127.0.0.1',()=>writeFileSync(v('--process-record'),JSON.stringify({pid:process.pid,port,instanceId,executable:${JSON.stringify(exe)},started_at:new Date().toISOString()})));`);
  const supervisor=join(dir,'supervisor.mjs');await writeFile(supervisor,`import{runServerSupervisor}from${JSON.stringify(moduleUrl)};import{spawn}from'node:child_process';runServerSupervisor({spawnProcess:(exe,args,options)=>spawn(process.execPath,[${JSON.stringify(fake)},...args],options)}).catch(()=>process.exit(1));`);
  const launcher=join(dir,'launcher.mjs');await writeFile(launcher,`import{startSupervisedServer}from${JSON.stringify(moduleUrl)};const x=await startSupervisedServer({directory:${JSON.stringify(dir)},stateDir:${JSON.stringify(join(dir,'state'))},registry:'{"port":53500,"note":"'+'x'.repeat(80000)+'"}',supervisorArgs:[${JSON.stringify(supervisor)}]});console.log(x.url);setInterval(()=>{},1000);`);
  parent=spawn(process.execPath,[launcher],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const url=await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('fixture startup')),8000);parent.once('error',j);parent.stdout.once('data',b=>{clearTimeout(timer);r(b.toString().trim());});});
  assert.equal((await fetch(url+'api/health')).status,200);
  await new Promise(r=>{parent.once('exit',r);parent.kill();});
  let stopped=false;for(let n=0;n<40;n++){try{await fetch(url+'api/health',{signal:AbortSignal.timeout(100)});}catch{stopped=true;break;}await new Promise(r=>setTimeout(r,50));}
  assert.equal(stopped,true);
 }finally{if(parent?.exitCode===null&&!parent.signalCode)parent.kill();await rm(dir,{recursive:true,force:true});}
});
test('bundle launch lock reopens only its verified existing web instance',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tc-lock-'));let server,claim;
 try{
  claim=await claimBundleState(dir);server=createWebServer({assets:new Map(),launcherInfo:{product:'TranscriptCutter',launcherId:claim.identity.nonce,instanceId:'transcript-cutter'}});const port=await listen(server);
  await writeFile(join(dir,'launcher.json'),JSON.stringify({webPort:port,launcherId:claim.identity.nonce}));
  assert.equal((await claimBundleState(dir)).existingUrl,`http://127.0.0.1:${port}/`);
  assert.equal((await fetch(`http://127.0.0.1:${port}/launcher`,{headers:{Origin:'http://foreign.invalid'}})).status,403);
  await claim.release();await claim.release();
  const next=await claimBundleState(dir);assert.notEqual(next.identity.nonce,claim.identity.nonce);await next.release();
 }finally{if(server)await stop(server);await claim?.release();await rm(dir,{recursive:true,force:true});}
});
test('dedicated server avoids occupied/reserved ports, checks owner and stops only its own child',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tc-child-')),existing=createServer((q,s)=>s.end('unrelated'));
 const existingPort=await listen(existing);let owned;
 try{
  const fixture=join(dir,'fixture.mjs');await writeFile(fixture,`import {createServer} from 'node:http';import {writeFileSync} from 'node:fs';const args=process.argv.slice(2),v=k=>args[args.indexOf(k)+1],port=Number(v('--port')),instanceId=v('--instance-id');const server=createServer((q,s)=>s.end(JSON.stringify({appId:'meeting-transcriber',instanceId})));server.listen(port,'127.0.0.1',()=>writeFileSync(v('--process-record'),JSON.stringify({pid:process.pid,port,instanceId,executable:${JSON.stringify(resolve(dir,'fixture.exe'))},started_at:new Date().toISOString()})));`);
  owned=await startBundledServer({bundle:{executable:resolve(dir,'fixture.exe'),instanceId:'transcript-cutter',serverVersion:'fixture',serverSha256:'test'},stateDir:dir,reserved:port=>port===8769,preferred:existingPort,spawnProcess:(exe,args,options)=>spawn(process.execPath,[fixture,...args],options)});
  assert.notEqual(owned.port,existingPort);assert.notEqual(owned.port,8769);
  const record=JSON.parse(await readFile(join(dir,'bundled-server.json'),'utf8'));assert.equal(record.pid,owned.child.pid);
  await owned.stop();await owned.stop();assert.ok(owned.child.exitCode!==null||owned.child.signalCode!==null);
  assert.equal(await(await fetch(`http://127.0.0.1:${existingPort}`)).text(),'unrelated');
 }finally{await owned?.stop();await stop(existing);await rm(dir,{recursive:true,force:true});}
});
