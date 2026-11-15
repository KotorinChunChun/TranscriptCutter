import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createWebServer} from '../scripts/serve-web.mjs';
import {networkConnectionError} from '../scripts/speech-connection.mjs';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const stop=server=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));};
const identity={appId:'meeting-transcriber',protocolVersion:3,serverVersion:'4.3.0'};
const fixture=(mode,received,options={})=>createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 received.push({url:req.url,method:req.method,headers:req.headers,body:Buffer.concat(chunks).toString()});
 res.setHeader('Content-Type','application/json');
 if(mode==='bearer'&&req.headers.authorization!=='Bearer fixture-server-key'){res.writeHead(401).end(JSON.stringify({error:'サーバーの接続キーを確認してください。'}));return;}
 if(req.url==='/api/health'){res.end(JSON.stringify({...identity,...(mode==='local'?{}:{authMode:mode,executionTarget:'server'}),...(mode==='bearer'?{}:{token:options.token??'fixture-operation-token'}),...options.health}));return;}
 res.end(JSON.stringify({job:{id:'a'.repeat(32),status:req.url.endsWith('/cancel')?'cancelled':'queued'},data:[],segments:[],total:0}));
});
const clientHeaders=id=>({'X-TC-Client':id});

test('draining POST preserves 503 and Retry-After without replay while GET and cancel remain usable',async()=>{
 let posts=0;const upstream=createServer(async(req,res)=>{for await(const chunk of req){}res.setHeader('Content-Type','application/json');if(req.url==='/api/health'){res.end(JSON.stringify({...identity,authMode:'local',token:'fixture'}));return;}if(req.method==='POST'&&req.url==='/api/jobs'){posts++;res.writeHead(503,{'Retry-After':'5'}).end('{"error":"更新待機"}');return;}res.end('{"job":{"status":"queued"}}');});const target=await listen(upstream),web=createWebServer({speechUrl:target}),base=await listen(web);
 try{const response=await fetch(base+'/speech/api/jobs',{method:'POST',body:'fixture'});assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'5');assert.equal(posts,1);assert.equal((await fetch(base+'/speech/api/jobs')).status,200);assert.equal((await fetch(base+'/speech/api/jobs/'+'a'.repeat(32)+'/cancel',{method:'POST',body:'{}'})).status,200);assert.equal(posts,1);}finally{await stop(web);await stop(upstream);}
});

test('v0.1.14 scheduling capabilities survive the proxy without private fields',async()=>{
 const upstream=fixture('local',[],{health:{serverVersion:'0.1.14',capabilities:{jobDeletion:true,concurrentInference:true,resourceBudgetScheduling:true,privatePath:'fixture-private'}}}),target=await listen(upstream),web=createWebServer({speechUrl:target}),base=await listen(web);
 try{const health=await(await fetch(base+'/speech/api/health')).json();assert.equal(health.serverVersion,'0.1.14');assert.deepEqual(health.capabilities,{jobDeletion:true,concurrentInference:true,resourceBudgetScheduling:true});assert.doesNotMatch(JSON.stringify(health),/fixture-private|fixture-operation-token/);}finally{await stop(web);await stop(upstream);}
});
test('delete-job is POST-only, capability-gated and keeps unrelated capability fields private',async()=>{
 for(const supported of [false,true]){
  const received=[],upstream=fixture('lan',received,{health:{capabilities:{jobDeletion:supported,secret:'fixture-private'}}}),target=await listen(upstream),web=createWebServer({speechUrl:target}),base=await listen(web),path='/speech/api/jobs/'+'a'.repeat(32)+'/delete';
  try{
   assert.equal((await fetch(base+path)).status,404);assert.equal(received.length,0);
   const health=await(await fetch(base+'/speech/api/health')).json();assert.deepEqual(health.capabilities,{jobDeletion:supported});assert.ok(!JSON.stringify(health).includes('fixture-private'));
   const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'delete-job',clientId:'transcript-cutter'})});
   assert.equal(response.status,supported?200:409);
   if(supported){assert.equal(received.at(-1).headers['x-local-token'],'fixture-operation-token');assert.match(received.at(-1).body,/delete-job/);}else assert.equal(received.length,1);
  }finally{await stop(web);await stop(upstream);}
 }
});
test('preparation health is a small allowlist without arbitrary server fields or secrets',async()=>{
 const upstream=fixture('lan',[],{health:{ready:false,reason:'モデル未準備',ffmpegAvailable:true,speechAvailable:false,privateConfig:'fixture-secret',nested:{token:'private'}}}),target=await listen(upstream),web=createWebServer({speechUrl:target}),base=await listen(web);
 try{const response=await fetch(base+'/speech/api/health');const value=await response.json();assert.equal(value.ready,false);assert.equal(value.reason,'モデル未準備');assert.equal(value.ffmpegAvailable,true);assert.equal(value.speechAvailable,false);assert.equal(value.token,undefined);assert.equal(value.privateConfig,undefined);assert.equal(value.nested,undefined);assert.ok(!JSON.stringify(value).includes('fixture-secret'));}finally{await stop(web);await stop(upstream);}
});
async function configure(base,target,key='',id='fixture-client-id-0001'){
 return fetch(base+'/connection',{method:'POST',headers:{...clientHeaders(id),'Content-Type':'application/json'},body:JSON.stringify({url:target,key})});
}
test('LAN key blank: verify health, keep operation token server-side and stream upload/PATCH/cancel',async()=>{
 const received=[],upstream=fixture('lan',received),base=await listen(upstream),web=createWebServer({speechUrl:base}),url=await listen(web),headers=clientHeaders('fixture-client-id-0001');
 try{
  const setting=await configure(url,base);assert.equal(setting.status,200);const value=await setting.json();assert.equal(value.authMode,'lan');assert.equal(value.token,undefined);assert.ok(!JSON.stringify(value).includes('fixture-operation-token'));
  for(const [method,path,body] of [['POST','/api/jobs?clientId=transcript-cutter&workload=file&start=60&end=90','synthetic'],['PATCH','/api/jobs/'+ 'a'.repeat(32)+'/segments','[{"id":1,"text":"合成"}]'],['POST','/api/jobs/'+ 'a'.repeat(32)+'/cancel','{}']]){
   const response=await fetch(url+'/speech'+path,{method,headers:{...headers,'Content-Type':'application/octet-stream','X-Local-Token':'untrusted-browser-token'},body});assert.equal(response.status,200);const last=received.at(-1);assert.equal(last.headers['x-local-token'],'fixture-operation-token');assert.equal(last.headers.authorization,undefined);assert.equal(last.body,body);assert.equal(last.method,method);
  }
  assert.equal(received[0].headers.authorization,undefined);assert.equal(received[0].headers['x-local-token'],undefined);
  const count=received.length;assert.equal((await fetch(url+'/speech/api/jobs/'+ 'a'.repeat(32)+'/remove-media',{method:'POST',body:'{}'})).status,404);assert.equal((await fetch(url+'/speech/api/health',{headers:{Origin:'https://other.invalid'}})).status,403);assert.equal(received.length,count);
  const staticPage=await fetch(url+'/');assert.equal(staticPage.status,200);assert.match(staticPage.headers.get('content-security-policy'),/connect-src 'self'/);
 }finally{await stop(web);await stop(upstream);}
});
test('old loopback health without authMode uses the operation token',async()=>{
 const received=[],upstream=fixture('local',received),base=await listen(upstream),web=createWebServer({speechUrl:base}),url=await listen(web);
 try{const health=await(await fetch(url+'/speech/api/health')).json();assert.equal(health.authMode,'local');assert.equal(health.token,undefined);await fetch(url+'/speech/v1/models');assert.equal(received.at(-1).headers['x-local-token'],'fixture-operation-token');}finally{await stop(web);await stop(upstream);}
});
test('Bearer: no automatic key requirement for LAN; missing/wrong key gives 401 and explicit key works',async()=>{
 const received=[],upstream=fixture('bearer',received),base=await listen(upstream),web=createWebServer({speechUrl:base}),url=await listen(web);
 try{
  let response=await configure(url,base);assert.equal(response.status,401);assert.equal((await response.json()).code,'bearer_key_required');assert.equal(received.length,1);
  response=await configure(url,base,'incorrect-fixture');assert.equal(response.status,401);assert.equal((await response.json()).code,'bearer_key_invalid');
  response=await configure(url,base,'fixture-server-key');assert.equal(response.status,200);const text=await response.text();assert.ok(!text.includes('fixture-server-key'));assert.match(text,/bearer/);
  await fetch(url+'/speech/v1/models',{headers:clientHeaders('fixture-client-id-0001')});assert.equal(received.at(-1).headers.authorization,'Bearer fixture-server-key');assert.equal(received.at(-1).headers['x-local-token'],undefined);
  const saved=await(await fetch(url+'/connection',{headers:clientHeaders('fixture-client-id-0001')})).text();assert.ok(!saved.includes('fixture-server-key'));assert.ok(!saved.includes('token'));
 }finally{await stop(web);await stop(upstream);}
});
test('changing origin never reuses an environment key; browser instances keep separate connections',async()=>{
 const a=[],b=[],upA=fixture('bearer',a),upB=fixture('lan',b,{token:'fixture-lan-b'}),baseA=await listen(upA),baseB=await listen(upB),web=createWebServer({speechUrl:baseA,speechToken:'fixture-server-key'}),url=await listen(web);
 try{
  const idA=clientHeaders('fixture-client-id-0001'),idB=clientHeaders('fixture-client-id-0002');
  assert.equal((await fetch(url+'/speech/v1/models',{headers:idA})).status,200);
  assert.equal((await configure(url,baseB,'')).status,200);await fetch(url+'/speech/v1/models',{headers:idA});assert.equal(b.at(-1).headers.authorization,undefined);assert.equal(b.at(-1).headers['x-local-token'],'fixture-lan-b');
  await fetch(url+'/speech/v1/models',{headers:idB});assert.equal(a.at(-1).headers.authorization,'Bearer fixture-server-key');assert.equal(a.at(-1).url,'/v1/models');
 }finally{await stop(web);await stop(upA);await stop(upB);}
});
test('wrong application, unknown 401 and health redirect receive no key and no fallback',async()=>{
 for(const kind of ['other-app','unknown-401','redirect']){
  const received=[],destinationCalls=[];const destination=createServer((req,res)=>{destinationCalls.push(req.headers);res.end('{}');}),dest=await listen(destination);
  const upstream=createServer((req,res)=>{received.push(req.headers);res.setHeader('Content-Type','application/json');if(kind==='redirect'){res.writeHead(307,{Location:dest+'/api/health'}).end();}else if(kind==='unknown-401'){res.writeHead(401).end('{"error":"unauthorized"}');}else res.end('{"appId":"different-program","protocolVersion":3}');});
  const base=await listen(upstream),web=createWebServer({speechUrl:base,speechToken:'fixture-env-secret'}),url=await listen(web);
  try{const response=await configure(url,base,'fixture-entered-secret');assert.ok(response.status>=400);assert.equal(received.length,1);assert.equal(received[0].authorization,undefined);assert.equal(destinationCalls.length,0);assert.ok(!(await response.text()).includes('fixture-entered-secret'));}finally{await stop(web);await stop(upstream);await stop(destination);}
 }
});
test('invalid URL credentials and foreign browser origin cannot update the connection',async()=>{
 const received=[],upstream=fixture('lan',received),base=await listen(upstream),web=createWebServer({speechUrl:base}),url=await listen(web);
 try{assert.equal((await configure(url,'http://user:pass@127.0.0.1:8769')).status,400);assert.equal((await fetch(url+'/connection',{method:'POST',headers:{Origin:'http://outside.invalid','Content-Type':'application/json'},body:JSON.stringify({url:base,key:'secret'})})).status,403);assert.equal(received.length,0);}finally{await stop(web);await stop(upstream);}
});
test('explicit reconnect refreshes a restarted server operation token',async()=>{
 let token='first-fixture';const seen=[];
 const upstream=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/api/health'){res.end(JSON.stringify({...identity,authMode:'lan',token}));return;}seen.push(req.headers['x-local-token']);res.end('{}');});
 const base=await listen(upstream),web=createWebServer({speechUrl:base}),url=await listen(web);
 try{await fetch(url+'/speech/api/health');await fetch(url+'/speech/v1/models');token='after-restart-fixture';await fetch(url+'/speech/api/health');await fetch(url+'/speech/v1/models');assert.deepEqual(seen,['first-fixture','after-restart-fixture']);}finally{await stop(web);await stop(upstream);}
});
test('a malformed new URL disconnects instead of silently continuing on the old server',async()=>{
 const received=[],upstream=fixture('lan',received),base=await listen(upstream),web=createWebServer({speechUrl:base}),url=await listen(web),headers=clientHeaders('fixture-client-id-0001');
 try{await fetch(url+'/speech/api/health',{headers});const count=received.length;assert.equal((await configure(url,'not-a-url')).status,400);assert.equal((await fetch(url+'/speech/v1/models',{headers})).status,400);assert.equal(received.length,count);}finally{await stop(web);await stop(upstream);}
});
test('an authenticated API redirect does not forward the Bearer key to another origin',async()=>{
 const destinationCalls=[],destination=createServer((req,res)=>{destinationCalls.push(req.headers);res.end('{}');}),dest=await listen(destination);
 const upstream=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/api/health'){if(req.headers.authorization!=='Bearer fixture-server-key'){res.writeHead(401).end('{"error":"サーバーの接続キーを確認してください。"}');return;}res.end(JSON.stringify({...identity,authMode:'bearer'}));}else res.writeHead(307,{Location:dest+'/v1/models'}).end();});
 const base=await listen(upstream),web=createWebServer({speechUrl:base,speechToken:'fixture-server-key'}),url=await listen(web);
 try{const response=await fetch(url+'/speech/v1/models');assert.equal(response.status,502);assert.equal((await response.json()).code,'redirect_refused');assert.equal(destinationCalls.length,0);}finally{await stop(web);await stop(upstream);await stop(destination);}
});
test('a LAN token rejection never requests a Bearer key or replays a mutation',async()=>{
 let token='first-fixture',posts=0;const received=[];
 const upstream=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/api/health'){res.end(JSON.stringify({...identity,authMode:'lan',token}));return;}received.push(req.headers['x-local-token']);posts++;if(req.headers['x-local-token']!==token){res.writeHead(401).end('{"error":"expired"}');return;}res.end('{"job":{"status":"queued"}}');});
 const base=await listen(upstream),web=createWebServer({speechUrl:base}),url=await listen(web);
 try{await fetch(url+'/speech/api/health');token='rotated-fixture';const failed=await fetch(url+'/speech/api/jobs',{method:'POST',body:'synthetic'});assert.equal(failed.status,401);const error=await failed.json();assert.equal(error.code,'operation_token_expired');assert.match(error.error,/入力は不要/);assert.equal(posts,1);await fetch(url+'/speech/api/health');const next=await fetch(url+'/speech/api/jobs',{method:'POST',body:'synthetic'});assert.equal(next.status,200);assert.deepEqual(received,['first-fixture','rotated-fixture']);}finally{await stop(web);await stop(upstream);}
});
test('socket permission, refusal and timeout stay distinct from authentication',()=>{
 assert.equal(networkConnectionError({code:'EACCES'}).code,'network_permission_denied');assert.match(networkConnectionError({code:'EACCES'}).message,/キーの入力では解消しません/);assert.equal(networkConnectionError({code:'ECONNREFUSED'}).code,'connection_refused');assert.equal(networkConnectionError({code:'ETIMEDOUT'}).status,504);
});
