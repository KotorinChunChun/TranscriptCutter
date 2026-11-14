import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {collectWebAssets,requiredWebAssets,bundledServerRelease,verifyAcceptedExecutable,verifyAcceptedInstaller,sha256} from '../scripts/distribution-contract.mjs';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'tc-distribution-'));
 t.after(async()=>{assert.equal(dirname(root),resolve(tmpdir()));await rm(root,{recursive:true,force:true});});
 for(const name of requiredWebAssets){const path=join(root,name.slice(1));await mkdir(dirname(path),{recursive:true});await writeFile(path,'fixture '+name);}
 return root;
}
test('complete Web manifest retains optional workers and all local ASR licenses',async t=>{
 const root=await fixture(t);await writeFile(join(root,'other-worker.js'),'optional worker');
 const assets=await collectWebAssets(root);
 for(const name of requiredWebAssets)assert.equal(Buffer.from(assets[name],'base64').toString(),'fixture '+name);
 assert.equal(Buffer.from(assets['/other-worker.js'],'base64').toString(),'optional worker');
});
test('missing Haas worker or model license stops packaging instead of a broken release',async t=>{
 const root=await fixture(t);await rm(join(root,'browser-haas-worker.js'));await assert.rejects(collectWebAssets(root),/browser-haas-worker/);
 await writeFile(join(root,'browser-haas-worker.js'),'haas');await rm(join(root,'licenses/local-asr/SILERO-LICENSE'));await assert.rejects(collectWebAssets(root),/SILERO-LICENSE/);
});
test('asset junctions cannot import files outside the build output',async t=>{
 const root=await fixture(t);await symlink(join(root,'licenses'),join(root,'linked'),process.platform==='win32'?'junction':'dir');await assert.rejects(collectWebAssets(root),/リンク/);
});
const executable=()=>{const bytes=Buffer.from('fake executable'),receipt={version:'0.1.1',sourceDirty:false,distribution:'unified-single-exe',gitCommit:'test-source',sha256:sha256(bytes),server:{version:bundledServerRelease.version,gitCommit:bundledServerRelease.gitCommit,sha256:bundledServerRelease.sha256},assets:Object.fromEntries(requiredWebAssets.map(name=>[name,'a'.repeat(64)]))};return {bytes,receipt,acceptance:{version:receipt.version,source:receipt.gitCommit,sha256:receipt.sha256,passed:Array(8).fill('fixture')}};};
test('accepted executable must include current server, clean source and Haas assets',()=>{
 const {bytes,receipt,acceptance}=executable();verifyAcceptedExecutable(receipt,acceptance,bytes,'0.1.1');
 for(const patch of [{sourceDirty:true},{server:{...receipt.server,version:'0.1.10'}},{sha256:'0'.repeat(64)},{assets:{}}])assert.throws(()=>verifyAcceptedExecutable({...receipt,...patch},acceptance,bytes,'0.1.1'));
 for(const patch of [{passed:undefined},{passed:'12345678'},{passed:{length:8}},{version:'0.1.0'},{source:'stale-source'}])assert.throws(()=>verifyAcceptedExecutable(receipt,{...acceptance,...patch},bytes,'0.1.1'));
});
test('stale or unchecked installer never authorizes replacing current deliverables',()=>{
 const {receipt:exe}=executable(),bytes=Buffer.from('fake installer'),receipt={version:'0.1.1',distribution:'unified-user-installer',sha256:sha256(bytes),bytes:bytes.length,executable:{sha256:exe.sha256,gitCommit:exe.gitCommit},server:exe.server,installScope:'current-user',autoRun:false,dataPreserved:true,compiler:{sha256:'c'.repeat(64)},installerScriptSha256:'d'.repeat(64)},acceptance={version:receipt.version,source:exe.gitCommit,executableSha256:exe.sha256,sha256:receipt.sha256,passed:Array(7).fill('fixture')};
 verifyAcceptedInstaller(receipt,acceptance,bytes,exe,'0.1.1');
 for(const patch of [{executable:{...receipt.executable,sha256:'stale'}},{autoRun:true},{dataPreserved:false},{installScope:'all-users'}])assert.throws(()=>verifyAcceptedInstaller({...receipt,...patch},acceptance,bytes,exe,'0.1.1'));
 assert.throws(()=>verifyAcceptedInstaller(receipt,{...acceptance,passed:[]},bytes,exe,'0.1.1'));
 for(const patch of [{passed:undefined},{passed:'1234567'},{passed:{length:7}},{version:'0.1.0'},{source:'stale-source'},{executableSha256:'stale-exe'}])assert.throws(()=>verifyAcceptedInstaller(receipt,{...acceptance,...patch},bytes,exe,'0.1.1'));
});
