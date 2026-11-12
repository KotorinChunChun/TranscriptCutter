import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startStandalone} from '../scripts/standalone-web.mjs';
const assets=new Map([['/index.html',Buffer.from('embedded page')],['/app.js',Buffer.from('embedded script')]]);
const stop=server=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));};
test('embedded assets need no disk files, retain origin guards and open only the bound loopback URL',async()=>{
 let opened='';const server=await startStandalone({assets,version:'0.1.0',env:{},args:[],registryPath:join(tmpdir(),'tc-absent-registry.json'),openBrowser:async url=>{opened=url;}});
 try{
  assert.equal(server.address().address,'127.0.0.1');
  assert.equal(opened,`http://127.0.0.1:${server.address().port}/`);
  const response=await fetch(opened);assert.equal(await response.text(),'embedded page');assert.match(response.headers.get('content-security-policy'),/connect-src 'self'/);
  assert.equal(await(await fetch(opened+'app.js')).text(),'embedded script');
  assert.equal(await(await fetch(opened+'app.js',{method:'HEAD'})).text(),'');
  for(const path of ['README.md','package.json','%2e%2e%5cpackage.json','nested/app.js'])assert.equal((await fetch(opened+path)).status,404);
  assert.equal((await fetch(opened,{headers:{Origin:'http://foreign.invalid'}})).status,403);
 }finally{await stop(server);}
});
test('standalone refuses invalid, reserved and occupied ports without changing port',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'tc-ports-')),registryPath=join(folder,'registry.json');
 const server=await startStandalone({assets,version:'0.1.0',env:{},args:['--no-open'],registryPath});
 try{
  await assert.rejects(startStandalone({assets,version:'0.1.0',env:{TC_WEB_PORT:String(server.address().port)},args:['--no-open'],registryPath}),{code:'EADDRINUSE'});
  await writeFile(registryPath,'{"port":44444}');
  for(const port of ['44444','abc','-1','65536'])await assert.rejects(startStandalone({assets,version:'0.1.0',env:{TC_WEB_PORT:port},args:['--no-open'],registryPath}),/不正/);
 }finally{await stop(server);await rm(folder,{recursive:true});}
});
