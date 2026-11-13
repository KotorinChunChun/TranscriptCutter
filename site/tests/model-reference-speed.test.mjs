import {test} from 'node:test';
import assert from 'node:assert/strict';
import {modelReferenceSpeed} from '../model-reference-speed.ts';
import {SpeechClient} from '../speech-client.ts';

const speed={characters:90,runSeconds:3.294,charactersPerSecond:90/3.294,unit:'characters/s',kind:'historical_measurement',cpu:'i5-12500T',device:'CPU',serverVersion:'0.1.7',condition:'合成23.25秒・初回ロード・話者識別なし',caution:'GPU未測定'};
const entry=(referenceSpeed=speed)=>({id:'whisper/tiny',x_meeting:{engineId:'whisper',processingMethods:[{id:'cpu',label:'CPU'}],modelInfo:{id:'whisper/tiny',referenceSpeed}}});
test('historical character speed retains conditions without presenting audio throughput or ETA',()=>{
 const view=modelReferenceSpeed(entry());assert.match(view.summary,/27.3文字\/秒.*過去/);
 for(const expected of ['i5-12500T','CPU','0.1.7','合成23.25秒','GPU未測定'])assert.ok(view.details.join(' ').includes(expected));
 assert.doesNotMatch(view.summary,/倍速|残り|終了/);
 assert.equal(modelReferenceSpeed(undefined).summary,'参考速度：未提供');
 assert.equal(modelReferenceSpeed({id:'whisper/tiny',x_meeting:{}}).summary,'参考速度：未提供');
 assert.equal(modelReferenceSpeed(entry(null)).summary,'参考速度：未測定');
 for(const patch of [{runSeconds:0},{charactersPerSecond:Infinity},{charactersPerSecond:50},{unit:'seconds'},{kind:'live'}])assert.equal(modelReferenceSpeed(entry({...speed,...patch})).summary,'参考速度：未測定');
 const wrong=entry();wrong.x_meeting.modelInfo.id='whisper/base';assert.equal(modelReferenceSpeed(wrong).summary,'参考速度：未提供');
});
test('catalog metadata is retained without adding inventory-only or unsupported choices',async()=>{
 const client=new SpeechClient();let paths=[];const missing=entry();missing.id='unknown/tiny';missing.x_meeting.engineId='unknown';
 client.request=async path=>{paths.push(path);return path==='/api/health'?{appId:'meeting-transcriber',protocolVersion:3,capabilities:{modelInformation:true},modelInformationUrl:'/api/models'}:{data:[entry(),missing]};};
 const result=await client.connect();assert.equal(result.models.length,1);assert.equal(result.models[0].x_meeting.modelInfo.referenceSpeed.characters,90);assert.deepEqual(paths,['/api/health','/v1/models']);
});
