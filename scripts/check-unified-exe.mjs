import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {bundledServerRelease,requiredWebAssets} from './distribution-contract.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),{version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const exe=process.env.TC_ACCEPT_EXE||join(root,'runtime','unified-build',`TranscriptCutter-v${version}.exe`),receipt=JSON.parse(await readFile(exe+'.json','utf8'));
assert.equal(createHash('sha256').update(await readFile(exe)).digest('hex'),receipt.sha256);assert.equal(receipt.distribution,'unified-single-exe');assert.equal(receipt.sourceDirty,false);
assert.deepEqual(receipt.server,{...receipt.server,version:bundledServerRelease.version,gitCommit:bundledServerRelease.gitCommit,sha256:bundledServerRelease.sha256});
for(const path of requiredWebAssets)assert.match(receipt.assets[path]??'',/^[a-f0-9]{64}$/,'不足するWeb資産: '+path);
const state=join(root,'runtime','unified-acceptance',randomUUID());await mkdir(state,{recursive:true});
// Acceptance owns a fresh state tree; do not download recognition runtimes just to check packaging.
const settings=join(state,'services','server-settings');await mkdir(settings,{recursive:true});await writeFile(join(settings,'settings.json'),JSON.stringify({auto_install_runtimes:false})+'\n',{flag:'wx'});
const env={...process.env,TC_UNIFIED_STATE_DIR:state,PATH:join(process.env.SystemRoot,'System32')+';'+process.env.SystemRoot};
assert.equal(execFileSync(exe,['--version'],{env,encoding:'utf8'}).trim(),`TranscriptCutter v${version} / TranscriptionServer v${bundledServerRelease.version}`);
const pause=ms=>new Promise(r=>setTimeout(r,ms));let child;
async function launch(){
 child=spawn(exe,['--no-open'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stderr.on('data',()=>{});
 return new Promise((r,j)=>{let output='';const timer=setTimeout(()=>j(Error('起動待ちタイムアウト')),35000);child.once('error',j);child.once('exit',()=>{clearTimeout(timer);j(Error('起動に失敗しました。'));});child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/TranscriptCutter 設定: (http:\/\/127\.0\.0\.1:\d+\/)/);if(match){clearTimeout(timer);r(match[1]);}});});
}
async function kill(){if(!child||child.exitCode!==null)return;await new Promise(r=>{child.once('exit',r);child.kill();});}
try{
 let base=await launch(),stateResponse=await(await fetch(base+'setup/state')).json();assert.equal(stateResponse.appUrl,'');assert.match(await(await fetch(base)).text(),/このPCだけ/);
 const response=await fetch(base+'setup/config',{method:'POST',headers:{Origin:base.slice(0,-1),'Content-Type':'application/json','X-TC-Setup':stateResponse.nonce},body:'{"mode":"local"}'});assert.equal(response.status,200,await response.clone().text());let result=await response.json(),appUrl=result.appUrl;
 const info=await(await fetch(appUrl+'launcher')).json();assert.equal(info.mode,'local');assert.equal(info.setupUrl,base);
 const health=await(await fetch(appUrl+'api/health')).json();assert.equal(health.appId,'meeting-transcriber');assert.equal(health.instanceId,'transcript-cutter');assert.equal(health.serverVersion,bundledServerRelease.version);assert.equal(health.capabilities.concurrentInference,true);assert.equal(health.capabilities.resourceBudgetScheduling,true);
 assert.match(await(await fetch(appUrl+'server/')).text(),/TranscriptionServer/);assert.match(await(await fetch(appUrl+'management.mjs')).text(),/api\/management/);
 assert.equal((await(await fetch(appUrl+'connection')).json()).managementUrl,'/server/');
 assert.equal((await fetch(appUrl+'speech/api/health')).status,200);
 for(const [path,expected]of Object.entries(receipt.assets)){const response=await fetch(appUrl+path.slice(1));assert.equal(response.status,200,path);assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),expected,path);}
 const processRecord=JSON.parse(await readFile(join(state,'services','server-process.json'),'utf8'));assert.equal(processRecord.instanceId,'transcript-cutter');
 const duplicate=execFileSync(exe,['--no-open'],{env,encoding:'utf8'});assert.ok(duplicate.includes(base));
 await kill();for(let n=0;n<50;n++){try{await fetch(appUrl,{signal:AbortSignal.timeout(200)});}catch{break;}await pause(100);}
 await assert.rejects(fetch(appUrl,{signal:AbortSignal.timeout(300)}));
 // A forced launcher exit must also release the owned server, never shared 8769.
 for(let n=0;n<60;n++){try{await fetch(`http://127.0.0.1:${processRecord.port}/api/health`,{signal:AbortSignal.timeout(200)});}catch{break;}await pause(100);}
 await assert.rejects(fetch(`http://127.0.0.1:${processRecord.port}/api/health`,{signal:AbortSignal.timeout(300)}));
 base=await launch();stateResponse=await(await fetch(base+'setup/state')).json();assert.equal(stateResponse.config.mode,'local');assert.ok(stateResponse.appUrl);assert.equal((await fetch(stateResponse.appUrl+'api/health')).status,200);
 const report={version,sha256:receipt.sha256,source:receipt.gitCommit,passed:['single-exe-version','first-choice','owned-server-health','same-origin-management','embedded-assets','duplicate-launch','forced-exit-descendants','saved-mode-relaunch'],state,checkedAt:new Date().toISOString()};
 await writeFile(join(state,'acceptance.json'),JSON.stringify(report,null,2)+'\n');await writeFile(exe+'.acceptance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await kill();}
