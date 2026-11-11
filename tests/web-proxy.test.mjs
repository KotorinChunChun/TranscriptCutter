import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createWebServer} from '../scripts/serve-web.mjs';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const stop=server=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));};
test('same-origin proxy streams uploads, preserves local authentication and forbids unrelated routes',async()=>{
 const received=[];const upstream=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);received.push({url:req.url,headers:req.headers,body:Buffer.concat(chunks).toString()});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({job:{id:'a'.repeat(32),status:'queued'}}));});
 const base=await listen(upstream),web=createWebServer({speechUrl:base});const url=await listen(web);
 try{
  const r=await fetch(url+'/speech/api/jobs?clientId=transcript-cutter&workload=file&start=60&end=90',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Local-Token':'fixture-token'},body:'synthetic'});assert.equal(r.status,200);assert.equal((await r.json()).job.status,'queued');
  assert.equal(received[0].body,'synthetic');assert.equal(received[0].headers['x-local-token'],'fixture-token');assert.equal(received[0].headers.origin,undefined);assert.match(received[0].url,/workload=file/);assert.match(received[0].url,/start=60&end=90/);
  assert.equal((await fetch(url+'/speech/api/jobs/'+ 'a'.repeat(32)+'/remove-media',{method:'POST',body:'{}'})).status,404);
  assert.equal((await fetch(url+'/speech/api/health',{headers:{Origin:'https://other.invalid'}})).status,403);assert.equal(received.length,1);
  assert.equal((await fetch(url+'/speech/https://other.invalid/')).status,404);
  const staticPage=await fetch(url+'/');assert.equal(staticPage.status,200);assert.match(staticPage.headers.get('content-security-policy'),/connect-src 'self'/);
 }finally{await stop(web);await stop(upstream);}
});
test('server-mode credential stays in the proxy and overrides a supplied local token',async()=>{
 let headers;const upstream=createServer((req,res)=>{headers=req.headers;res.end('{}');});const base=await listen(upstream),web=createWebServer({speechUrl:base,speechToken:'fixture-server-key'}),url=await listen(web);
 try{await fetch(url+'/speech/v1/models',{headers:{'X-Local-Token':'fixture-local'}});assert.equal(headers.authorization,'Bearer fixture-server-key');assert.equal(headers['x-local-token'],undefined);}finally{await stop(web);await stop(upstream);}
});
