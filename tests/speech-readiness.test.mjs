import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createWebServer} from '../scripts/serve-web.mjs';
test('real web proxy relays startup/admission and sanitized progress without exposing management writes',async()=>{
 let preparing=true,progressStatus=200,managementReads=0;
 const upstream=createServer((req,res)=>{res.setHeader('Content-Type','application/json');
  if(req.url==='/api/health')return res.end(JSON.stringify({appId:'meeting-transcriber',protocolVersion:3,serverVersion:'0.1.12',authMode:'local',token:'fixture-only-token',ready:!preparing,acceptingJobs:!preparing,startupState:preparing?'preparing':'complete'}));
  if(req.url==='/api/management'){managementReads++;assert.equal(req.method,'GET');assert.equal(req.headers['x-local-token'],'fixture-only-token');res.statusCode=progressStatus;return res.end(JSON.stringify({dataDirectory:'private-path',operation:{targetLabel:'Whisper',phase:'download',receivedBytes:40,totalBytes:100,token:'secret',message:'取得中'}}));}
  res.writeHead(404).end('{}');
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const app=createWebServer({speechUrl:`http://127.0.0.1:${upstream.address().port}`});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 try{const url=`http://127.0.0.1:${app.address().port}`;
  let result=await (await fetch(url+'/speech/api/health')).json();assert.equal(result.acceptingJobs,false);assert.equal(result.startupState,'preparing');assert.equal(result.preparation.receivedBytes,40);assert.doesNotMatch(JSON.stringify(result),/fixture-only-token|secret|private-path/);
  const denied=await fetch(url+'/speech/api/management',{method:'POST'});assert.equal(denied.status,404);assert.equal(managementReads,1);
  progressStatus=500;result=await (await fetch(url+'/speech/api/health')).json();assert.equal(result.acceptingJobs,false);assert.match(result.preparation.message,/取得できません/);
  preparing=false;result=await (await fetch(url+'/speech/api/health')).json();assert.equal(result.acceptingJobs,true);assert.equal(result.preparation,undefined);assert.equal(managementReads,2);
 }finally{await Promise.all([new Promise(r=>app.close(r)),new Promise(r=>upstream.close(r))]);}
});
