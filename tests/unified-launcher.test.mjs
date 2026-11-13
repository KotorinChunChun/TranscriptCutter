import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createServer} from 'node:http';
import {extractProgram} from '../scripts/embedded-program.mjs';
import {startUnified,launchNetwork} from '../scripts/unified-launcher.mjs';
import {createWebServer,lanPeer} from '../scripts/serve-web.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const payload=(name='program.txt')=>{const gzip=gzipSync(JSON.stringify([{path:name,body:Buffer.from('program').toString('base64'),sha256:hash('program')}]));return {version:'0.1.1',serverVersion:'0.1.10',gzip:gzip.toString('base64'),sha256:hash(gzip)};};
const stop=async server=>{server.closeAllConnections();await new Promise(r=>server.close(r));await server.cleanup?.();};
const listen=async server=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${server.address().port}/`;};
test('embedded programs verify archive, paths and unchanged extracted files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'tc-embedded-'));
 try{const archive=payload(),dir=await extractProgram(archive,root);assert.equal(await extractProgram(archive,root),dir);await writeFile(join(dir,'program.txt'),'changed');await assert.rejects(extractProgram(archive,root),/変更/);await assert.rejects(extractProgram(payload('../outside'),root),/検証/);await assert.rejects(extractProgram({...archive,sha256:'0'.repeat(64)},root),/破損/);}finally{await rm(root,{recursive:true});}
});
test('first launch needs explicit local choice; saved choice starts automatically; setup enforces origin and nonce',async()=>{
 const root=await mkdtemp(join(tmpdir(),'tc-unified-'));let server,started=0;
 const options={version:'0.1.1',payload:payload(),assets:new Map(),args:['--no-open'],env:{TC_UNIFIED_STATE_DIR:root},registryPath:join(root,'no-registry'),startService:async options=>{started++;assert.equal(options.env.TC_TRANSCRIPTION_URL,'');const web=createServer((req,res)=>res.end('app'));await listen(web);return web;}};
 try{server=await startUnified(options);const base=`http://127.0.0.1:${server.address().port}/`;assert.equal(started,0);assert.match(await(await fetch(base)).text(),/他PCにも公開/);const state=await(await fetch(base+'setup/state')).json();
  assert.equal((await fetch(base+'setup/config',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"mode":"local"}'})).status,403);
  const response=await fetch(base+'setup/config',{method:'POST',headers:{Origin:base.slice(0,-1),'Content-Type':'application/json','X-TC-Setup':state.nonce},body:'{"mode":"local"}'});assert.equal(response.status,200);const result=await response.json();assert.equal(await(await fetch(result.appUrl)).text(),'app');assert.equal(JSON.parse(await readFile(join(root,'mode.json'),'utf8')).mode,'local');
  await stop(server);server=await startUnified(options);assert.equal(started,2);
 }finally{if(server?.listening)await stop(server);await rm(root,{recursive:true});}
});
test('same-origin management proxy preserves operation tokens and blocks bundled update/shutdown',async()=>{
 const calls=[],upstream=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;calls.push({url:req.url,token:req.headers['x-local-token'],origin:req.headers.origin,body});res.end(req.url==='/'?'management':'{}');});const target=await listen(upstream),web=createWebServer({assets:new Map(),speechUrl:target,management:true}),base=await listen(web);
 try{assert.equal(await(await fetch(base+'server/')).text(),'management');const settings=await(await fetch(base+'connection')).json();assert.equal(settings.managementUrl,'/server/');assert.equal((await fetch(base+'api/management',{method:'POST',headers:{Origin:base.slice(0,-1),'X-Local-Token':'fixture'},body:'{}'})).status,200);assert.equal(calls.at(-1).token,'fixture');assert.equal(calls.at(-1).origin,target.slice(0,-1));
  for(const path of ['api/admin/shutdown','api/updates/apply'])assert.equal((await fetch(base+path,{method:'POST',headers:{Origin:base.slice(0,-1)}})).status,403);
  assert.equal((await fetch(base+'server/',{headers:{Origin:'http://foreign.test'}})).status,403);
 }finally{await stop(web);await stop(upstream);}
});
test('LAN mode rejects insecure/public/nonlocal addresses and admits only private peers',async()=>{
 for(const publicUrl of ['http://192.168.1.10:19120','https://8.8.8.8:19120','https://127.0.0.1:19120'])await assert.rejects(launchNetwork({mode:'lan',publicUrl}),/HTTPS URL/);
 for(const ip of ['127.0.0.1','192.168.49.12','::ffff:10.0.0.5'])assert.equal(lanPeer(ip),true);
 for(const ip of ['8.8.8.8','172.32.0.1','unknown'])assert.equal(lanPeer(ip),false);
});
