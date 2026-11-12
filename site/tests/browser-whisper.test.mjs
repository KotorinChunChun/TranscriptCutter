import {test} from 'node:test';
import assert from 'node:assert/strict';
import {whisperSegments,browserWhisperModels,whisperCache,runtimeFiles,whisperLoadingPolicy} from '../browser-whisper-config.ts';
import {transcriptionName} from '../recognition-state.ts';
import {supportedModel} from '../recognition-options.ts';
test('browser timestamps are absolute, clipped to the requested fractional boundary and invalid cues rejected',()=>{
 const rows=whisperSegments([{text:'合成',timestamp:[0.125,2]},{text:'末尾',timestamp:[2,null]},{text:'',timestamp:[0,1]},{text:'不正',timestamp:[NaN,4]},{text:'逆転',timestamp:[3,2]}],60,63.987,5);
 assert.deepEqual(rows.map(r=>[r.id,r.start,r.end,r.text]),[[5,60.125,62,'合成'],[6,62,63.987,'末尾']]);
 assert.equal(whisperSegments([{text:'範囲外',timestamp:[40,50]}],60,90,1).length,0);
});
test('browser model identifiers pin multilingual revisions and the cache is tool-specific',()=>{
 assert.equal(browserWhisperModels.length,2);for(const model of browserWhisperModels){assert.match(model.revision,/^[a-f0-9]{40}$/);assert.ok(!model.repo.endsWith('.en'));}
 assert.match(whisperCache,/transcript-cutter/);assert.ok(runtimeFiles.some(name=>name.endsWith('.wasm')));
 assert.match(transcriptionName({id:'a'.repeat(32),engine:'browser-whisper',modelId:'tiny',status:'complete'},'fixture.wav',''),/__browser-this-PC__browser-whisper__tiny__/);
});
test('cached inference enables local cache resolution and forbids remote model acquisition',()=>{
 assert.deepEqual(whisperLoadingPolicy(false),{allowLocalModels:true,allowRemoteModels:false,local_files_only:true});
 assert.deepEqual(whisperLoadingPolicy(true),{allowLocalModels:false,allowRemoteModels:true,local_files_only:false});
});
test('new server contract distinguishes supported online-installable runtimes from unsupported models',()=>{
 const row=values=>({id:'whisper/tiny',x_meeting:{engineId:'whisper',processingMethods:[{id:'cpu'}],...values}});
 assert.equal(supportedModel(row({supported:true,runtimeInstallable:true,availability:'unavailable',managementState:'missing_runtime',available:false})),true);
 assert.equal(supportedModel(row({supported:false,runtimeInstallable:true,available:false})),false);
 assert.equal(supportedModel(row({supported:true,supportStatus:'unsupported'})),false);
});
