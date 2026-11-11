import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createWebServer} from './serve-web.mjs';
const target=process.env.TC_LAN_TEST_URL,audio=process.env.TC_LAN_TEST_AUDIO;
if(!target||!audio||process.env.TC_SYNTHETIC_AUDIO_CONFIRMED!=='1')throw Error('LAN URL・許可された合成音声とTC_SYNTHETIC_AUDIO_CONFIRMED=1を指定してください。');
const resumeId=process.env.TC_LAN_TEST_JOB,waitSeconds=Number(process.env.TC_LAN_WAIT_SECONDS??120);
if(resumeId&&!/^[a-f0-9]{32}$/.test(resumeId)||!Number.isSafeInteger(waitSeconds)||waitSeconds<1||waitSeconds>43200)throw Error('再開ジョブまたは待機時間を確認してください。');
const registry=await readFile('C:/develop/DevServer/local/servers.json','utf8');
const web=createWebServer({speechUrl:target,speechToken:''});await new Promise((resolve,reject)=>{web.once('error',reject);web.listen(0,'127.0.0.1',resolve);});
if(new RegExp(`\\b${web.address().port}\\b`).test(registry)){web.close();throw Error('予約済みポートです。');}
const base=`http://127.0.0.1:${web.address().port}`,headers={'X-TC-Client':'lan-acceptance-'+randomUUID()},jobs=[];
const request=async(path,body,method='POST')=>{const response=await fetch(base+path,{method:body===undefined?'GET':method,headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});const value=await response.json();if(!response.ok)throw Error(value.error??`HTTP ${response.status}`);return value;};
let result;const output='runtime/connection-review/lan-'+Date.now();
try{
 const connection=await request('/connection',{url:target,key:''});assert.equal(connection.authMode,'lan');assert.equal(connection.token,undefined);
 const catalog=await request('/speech/v1/models');assert.ok(catalog.data.some(m=>m.id==='whisper/tiny'));
 const bytes=await readFile(audio),params=new URLSearchParams({name:'synthetic-lan-check.wav',engine:'whisper',model:'tiny',device:'cpu',diarize:'false',clientId:'transcript-cutter',workload:'file'});
 const upload=async()=>{const response=await fetch(base+'/speech/api/jobs?'+params,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(30000)});const value=await response.json();if(!response.ok)throw Error(value.error??'合成音声送信エラー');jobs.push(value.job.id);return value.job;};
 const created=resumeId?(await request('/speech/api/jobs/'+resumeId)).job:await upload();
 if(resumeId){assert.equal(created.fileName,'synthetic-lan-check.wav');assert.equal(created.clientId,'transcript-cutter');assert.equal(created.engine,'whisper');assert.equal(created.modelId,'tiny');jobs.push(created.id);}
 await mkdir(output,{recursive:true});await writeFile(output+'/started.json',JSON.stringify({target,jobId:created.id,resumed:!!resumeId,sourceKind:'confirmed synthetic WAV',sourceCommit:process.env.TC_ACCEPTANCE_COMMIT??'未記録'},null,2));
 let job=created;const deadline=Date.now()+waitSeconds*1000;
 while(['queued','running'].includes(job.status)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,1000));job=(await request('/speech/api/jobs/'+created.id)).job;}
 assert.equal(job.status,'complete');const before=await request('/speech/api/jobs/'+created.id+'/segments');assert.ok(before.segments.length);
 const first=before.segments[0],text='LAN接続の合成検証です。';await request('/speech/api/jobs/'+created.id+'/segments',{edits:[{id:first.id,text,speaker:'検証話者'}]},'PATCH');
 const after=await request('/speech/api/jobs/'+created.id+'/segments');assert.equal(after.segments[0].text,text);assert.equal(after.segments[0].speaker,'検証話者');assert.equal(after.segments[0].start,first.start);assert.equal(after.segments[0].end,first.end);
 const other=await upload();const cancelled=(await request('/speech/api/jobs/'+other.id+'/cancel',{})).job;assert.equal(cancelled.status,'cancelled');
 result={passed:true,target,authMode:connection.authMode,serverVersion:connection.serverVersion,sourceCommit:process.env.TC_ACCEPTANCE_COMMIT??'未記録',keyProvided:false,sourceKind:'confirmed synthetic WAV',sourceName:basename(audio),modelCount:catalog.data.length,jobs,resumed:!!resumeId,transcription:job.status,segmentCount:before.segments.length,editAndTimesPreserved:true,cancellation:cancelled.status};
 console.log('実LAN IP・キー空欄で認識/字幕編集/時刻保持/中止を確認');
}catch(error){result={passed:false,target,keyProvided:false,jobs,error:String(error)};console.error(String(error));process.exitCode=1;}finally{await mkdir(output,{recursive:true});await writeFile(output+'/result.json',JSON.stringify(result,null,2));console.log('LAN確認記録: '+output);web.closeAllConnections();await new Promise(resolve=>web.close(resolve));}
