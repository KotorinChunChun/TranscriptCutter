import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createWebServer} from './serve-web.mjs';
const target=process.env.TC_LAN_TEST_URL,audio=process.env.TC_LAN_TEST_AUDIO;
if(!target||!audio||process.env.TC_SYNTHETIC_AUDIO_CONFIRMED!=='1')throw Error('LAN URL・許可された合成音声とTC_SYNTHETIC_AUDIO_CONFIRMED=1を指定してください。');
const web=createWebServer({speechUrl:target,speechToken:''});await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${web.address().port}`,headers={'X-TC-Client':'lan-acceptance-'+randomUUID()},jobs=[];
const request=async(path,body,method='POST')=>{const response=await fetch(base+path,{method:body===undefined?'GET':method,headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});const value=await response.json();if(!response.ok)throw Error(value.error??`HTTP ${response.status}`);return value;};
let result;
try{
 const connection=await request('/connection',{url:target,key:''});assert.equal(connection.authMode,'lan');assert.equal(connection.token,undefined);
 const catalog=await request('/speech/v1/models');assert.ok(catalog.data.some(m=>m.id==='whisper/tiny'));
 const bytes=await readFile(audio),params=new URLSearchParams({name:'synthetic-lan-check.wav',engine:'whisper',model:'tiny',device:'cpu',diarize:'false',clientId:'transcript-cutter',workload:'file'});
 const upload=async()=>{const response=await fetch(base+'/speech/api/jobs?'+params,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(30000)});const value=await response.json();if(!response.ok)throw Error(value.error??'合成音声送信エラー');jobs.push(value.job.id);return value.job;};
 const created=await upload();let job=created;const deadline=Date.now()+120000;
 while(['queued','running'].includes(job.status)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,1000));job=(await request('/speech/api/jobs/'+created.id)).job;}
 assert.equal(job.status,'complete');const before=await request('/speech/api/jobs/'+created.id+'/segments');assert.ok(before.segments.length);
 const first=before.segments[0],text='LAN接続の合成検証です。';await request('/speech/api/jobs/'+created.id+'/segments',{edits:[{id:first.id,text,speaker:'検証話者'}]},'PATCH');
 const after=await request('/speech/api/jobs/'+created.id+'/segments');assert.equal(after.segments[0].text,text);assert.equal(after.segments[0].start,first.start);assert.equal(after.segments[0].end,first.end);
 const other=await upload();const cancelled=(await request('/speech/api/jobs/'+other.id+'/cancel',{})).job;assert.equal(cancelled.status,'cancelled');
 result={passed:true,target,authMode:connection.authMode,serverVersion:connection.serverVersion,keyProvided:false,sourceKind:'confirmed synthetic WAV',sourceName:basename(audio),jobs,transcription:job.status,segmentCount:before.segments.length,editAndTimesPreserved:true,cancellation:cancelled.status};
 console.log('実LAN IP・キー空欄で認識/字幕編集/時刻保持/中止を確認');
}catch(error){result={passed:false,target,keyProvided:false,jobs,error:String(error)};console.error(String(error));process.exitCode=1;}finally{await mkdir('runtime/connection-review',{recursive:true});await writeFile('runtime/connection-review/lan-result.json',JSON.stringify(result,null,2));web.closeAllConnections();await new Promise(resolve=>web.close(resolve));}
