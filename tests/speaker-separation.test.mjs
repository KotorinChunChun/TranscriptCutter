import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {createSpeakerSeparation,separationReferences} from '../scripts/speaker-separation.mjs';

test('speaker references reject excessive counts, invalid timestamps and non-text names',()=>{
 assert.deepEqual(separationReferences([{name:' 話者1 ',start:0,end:1500}]),[{name:'話者1',start:0,end:1500}]);
 for(const refs of [null,Array(4).fill({}),[{name:1,start:0,end:2000}],[{name:'x',start:1.5,end:2000}],[{name:'x',start:1000,end:999}],[{name:'x',start:0,end:7200001}]])assert.throws(()=>separationReferences(refs));
});
test('separation cache requires identical bytes; writes need same-origin operation header; audio serves correct ranges',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'tc-separation-')),models=resolve(root,'models'),workDir=resolve(root,'jobs');await mkdir(models);await mkdir(workDir);
 const python=resolve(root,'python.fixture'),worker=resolve(root,'worker.fixture');await writeFile(python,'');await writeFile(worker,'');await writeFile(resolve(models,'models.lock.json'),'{}');
 const id=randomUUID(),folder=resolve(workDir,id),bytes=Buffer.from('fixture-media-data'),sha256=createHash('sha256').update(bytes).digest('hex');await mkdir(folder);await writeFile(resolve(folder,'job.json'),JSON.stringify({id,status:'complete',sha256,bytes:bytes.length}));await writeFile(resolve(folder,'result.json'),JSON.stringify({durationMs:3000,tracks:[]}));await writeFile(resolve(folder,'voice-1.wav'),Buffer.from('abcdefghij'));
 const service=createSpeakerSeparation({python,models,workDir,worker}),server=createServer(async(req,res)=>{if(!await service.handle(req,res))res.writeHead(404).end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await (await fetch(base+'/separation/status')).json()).ready,true);
  assert.equal((await fetch(base+'/separation/jobs',{method:'POST',body:bytes})).status,403);
  assert.equal((await fetch(base+'/separation/jobs',{method:'POST',headers:{'X-TC-Separation':'1',Origin:'http://wrong.test'},body:bytes})).status,403);
  assert.equal((await fetch(base+'/separation/jobs',{method:'POST',headers:{'X-TC-Separation':'1','X-TC-References':'bad'},body:bytes})).status,400);
  const cached=await (await fetch(base+'/separation/jobs',{method:'POST',headers:{'X-TC-Separation':'1'},body:bytes})).json();assert.equal(cached.cached,true);assert.equal(cached.id,id);assert.equal(cached.result.durationMs,3000);
  const audio=await fetch(base+`/separation/jobs/${id}/tracks/1.wav`,{headers:{Range:'bytes=2-5'}});assert.equal(audio.status,206);assert.equal(audio.headers.get('content-range'),'bytes 2-5/10');assert.equal(await audio.text(),'cdef');
  assert.equal((await fetch(base+`/separation/jobs/${id}/tracks/1.wav`,{headers:{Range:'bytes=20-'}})).status,416);
  assert.equal((await fetch(base+'/separation/jobs/../../models/models.lock.json')).status,404);
 }finally{service.close();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
