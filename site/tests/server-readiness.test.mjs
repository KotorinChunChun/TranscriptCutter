import {test} from 'node:test';
import assert from 'node:assert/strict';
import {usableModel,serverAcceptsJobs,preparationProgress} from '../server-readiness.ts';
import {SpeechClient} from '../speech-client.ts';
const model=(id,info)=>({id:`whisper/${id}`,x_meeting:{engineId:'whisper',modelId:id,label:id,engineLabel:'Whisper',processingMethods:[{id:'cpu',label:'CPU'}],available:true,runtimeReady:true,modelInstalled:true,...(info?{modelInfo:info}:{})}});
test('current inspection excludes missing, broken and unknown weights even if catalog says installed',()=>{
 const ready={available:true,runtimeReady:true,modelInstalled:true};
 assert.equal(usableModel(model('tiny',ready)),true);
 for(const change of [{available:false},{runtimeReady:false},{modelInstalled:false},{modelInstalled:null},{supported:false}])assert.equal(usableModel(model('base',{...ready,...change})),false);
 assert.equal(usableModel(model('base',{})),false);
 assert.equal(usableModel({x_meeting:{availability:'installed'}}),true);
 assert.equal(usableModel({x_meeting:{}}),false);
});
test('preparation and admission fences override ready; only download bytes are a percentage',()=>{
 assert.equal(serverAcceptsJobs({ready:true,startupState:'preparing'}),false);
 assert.equal(serverAcceptsJobs({ready:true,acceptingJobs:false}),false);
 assert.equal(serverAcceptsJobs({ready:false,acceptingJobs:true}),false);
 assert.equal(serverAcceptsJobs({ready:true,startupState:'incomplete',acceptingJobs:true}),true);
 assert.equal(serverAcceptsJobs({ready:true}),true);
 const preparation={phase:'download',targetLabel:'Whisper',receivedBytes:40,totalBytes:100};
 assert.equal(preparationProgress({startupState:'preparing',preparation}).fraction,.4);
 assert.equal(preparationProgress({preparation:{...preparation,phase:'extract'}}).fraction,undefined);
 assert.equal(preparationProgress({preparation:{...preparation,totalBytes:0}}).fraction,undefined);
});
test('client publishes preparation before catalog response and refreshes installed choices',async()=>{
 const client=new SpeechClient();let ready=false,seen;
 client.request=async path=>path==='/api/health'?{appId:'meeting-transcriber',protocolVersion:3,ready,startupState:ready?'complete':'preparing',acceptingJobs:ready}:{data:[model('tiny'),model('base',{available:false,runtimeReady:true,modelInstalled:false})]};
 let result=await client.connect(h=>seen=h);assert.equal(seen.startupState,'preparing');assert.deepEqual(result.models.map(m=>m.id),['whisper/tiny']);
 ready=true;result=await client.connect(h=>seen=h);assert.equal(seen.acceptingJobs,true);
 client.request=async path=>{if(path==='/api/health')return {appId:'meeting-transcriber',protocolVersion:3,ready:false,startupState:'preparing'};throw Error('catalog offline');};
 await assert.rejects(()=>client.connect(h=>seen=h),/catalog offline/);assert.equal(seen.startupState,'preparing');
});
