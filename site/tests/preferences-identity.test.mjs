import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadSpeechPreferences,saveSpeechPreferences,processingChoice,speakerModes,modelsForSpeakerMode} from '../speech-preferences.ts';
import {hashMedia,matchesSource,sourceIdentity} from '../media-identity.ts';
import {supportedModel} from '../recognition-options.ts';
const model=(id,extra={})=>({id,x_meeting:{label:id,processingMethods:[{id:'cpu'},{id:'auto'}],defaultProcessingMethod:'auto',...extra}});
test('preferences isolate servers, retain model-specific device choices and tolerate corrupt or unavailable storage',()=>{
 const rows=new Map(),storage={getItem:k=>rows.get(k),setItem:(k,v)=>rows.set(k,v)},value={modelId:'asr',mode:'none',devices:{asr:'cpu'}};
 saveSpeechPreferences('http://127.0.0.1:8769/',value,storage);assert.deepEqual(loadSpeechPreferences('http://127.0.0.1:8769',storage),value);assert.equal(loadSpeechPreferences('http://127.0.0.1:18770',storage).modelId,'');
 assert.equal(processingChoice(model('asr'),'gpu'),'auto');assert.equal(processingChoice(model('asr'),'cpu'),'cpu');
 storage.getItem=()=>'{broken';assert.equal(loadSpeechPreferences('http://127.0.0.1',storage).mode,'none');assert.doesNotThrow(()=>saveSpeechPreferences('http://user:secret@localhost',value,{setItem(){throw Error('blocked');}}));
});
test('speaker modes keep independent ASR choices separate from a fixed integrated model',()=>{
 const list=[model('a'),model('b',{diarization:true,diarizationModel:'nemo',diarizationLabel:'Nemotron'}),model('i',{integratedDiarization:true})];
 assert.deepEqual(speakerModes(list).map(m=>m.id),['none','separate:nemo','integrated:i']);
 assert.deepEqual(modelsForSpeakerMode(list,'none').map(m=>m.id),['a','b']);assert.deepEqual(modelsForSpeakerMode(list,'separate:nemo').map(m=>m.id),['b']);assert.deepEqual(modelsForSpeakerMode(list,'integrated:i').map(m=>m.id),['i']);
 const integrated=model('nemotron-transcribe/30b',{engineId:'nemotron-transcribe',integratedDiarization:true,task:'integrated',supported:true,availability:'installed'});assert.equal(supportedModel(integrated),true);assert.equal(supportedModel({...integrated,x_meeting:{...integrated.x_meeting,supported:false}}),false);
});
test('streaming media identity agrees with SHA-256 across chunk boundaries and rejects same-name replacements',async()=>{
 const bytes=new Uint8Array(4*1024*1024+17).fill(61),file=new File([bytes],'same.mp4'),hash=await hashMedia(file);
 assert.equal(hash,createHash('sha256').update(bytes).digest('hex'));
 const job={id:'a',status:'complete',fileName:'same.mp4',sourceSha256:hash,sourceBytes:file.size};assert.equal(matchesSource(job,hash,file.size),true);assert.equal(matchesSource(job,await hashMedia(new Blob(['different'])),9),false);assert.equal(matchesSource(job,hash,file.size+1),false);assert.equal(sourceIdentity({id:'old',status:'complete',fileName:'same.mp4'}),null);
 await assert.rejects(hashMedia(file,AbortSignal.abort()),{name:'AbortError'});
});
