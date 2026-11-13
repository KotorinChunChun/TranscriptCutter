import {test} from 'node:test';
import assert from 'node:assert/strict';
import {whisperSegments,browserWhisperModels,whisperCache,runtimeFiles,whisperLoadingPolicy} from '../browser-whisper-config.ts';
import {transcriptionName} from '../recognition-state.ts';
import {supportedModel} from '../recognition-options.ts';
import {isWhisperModelCacheUrl,removeWhisperModelCache} from '../browser-whisper-cache.ts';
import {probeWhisperWebGPU,whisperDevices,resolveWhisperDevice,whisperDtype,whisperMarkerPath,whisperManifestMatches} from '../browser-whisper-device.ts';
test('WebGPU probe rejects absent, unavailable, insecure and failed devices',async()=>{
 assert.equal((await probeWhisperWebGPU(undefined,true)).available,false);
 assert.equal((await probeWhisperWebGPU({requestAdapter:async()=>null},true)).available,false);
 assert.equal((await probeWhisperWebGPU({requestAdapter:async()=>{throw Error('must not call');}},false)).available,false);
 assert.equal((await probeWhisperWebGPU({requestAdapter:async()=>({isFallbackAdapter:true,requestDevice:async()=>{throw Error('software');}})},true)).available,false);
 assert.equal((await probeWhisperWebGPU({requestAdapter:async()=>({requestDevice:async()=>{throw Error('device unavailable');}})},true)).available,false);
 assert.deepEqual(whisperDevices({available:false,reason:''}),['wasm']);
 assert.equal(resolveWhisperDevice('webgpu',{available:false,reason:''}),'wasm');
});
test('WebGPU probe dispatches work before offering GPU and releases its temporary device',async()=>{
 let dispatched=0,destroyed=0;
 const device={pushErrorScope(){},createShaderModule(){return {};},createComputePipeline(){return {};},createCommandEncoder(){return {beginComputePass(){return {setPipeline(){},dispatchWorkgroups(){dispatched++;},end(){}};},finish(){return {};}};},queue:{submit(){},async onSubmittedWorkDone(){}},async popErrorScope(){return null;},destroy(){destroyed++;}};
 const value=await probeWhisperWebGPU({requestAdapter:async()=>({info:{description:'test GPU'},requestDevice:async()=>device})},true);
 assert.equal(value.available,true);assert.equal(dispatched,1);assert.equal(destroyed,1);assert.deepEqual(whisperDevices(value),['wasm','webgpu']);
 device.createComputePipeline=()=>{throw Error('shader failure');};
 assert.equal((await probeWhisperWebGPU({requestAdapter:async()=>({requestDevice:async()=>device})},true)).available,false);assert.equal(destroyed,2);
});
test('Whisper CPU and GPU caches and dtypes stay separate while legacy CPU remains usable',()=>{
 const model=browserWhisperModels[0];
 assert.notEqual(whisperMarkerPath(model,'wasm'),whisperMarkerPath(model,'webgpu'));
 assert.equal(whisperManifestMatches({},'wasm'),true);assert.equal(whisperManifestMatches({},'webgpu'),false);
 assert.equal(whisperManifestMatches({device:'wasm',dtype:'q8'},'webgpu'),false);
 assert.equal(whisperManifestMatches({device:'webgpu',dtype:whisperDtype('webgpu')},'webgpu'),true);
 assert.equal(whisperManifestMatches({device:'webgpu',dtype:'q8'},'webgpu'),false);
});
test('browser model deletion removes only the chosen model while preserving runtime and other caches',async()=>{
 const [tiny,base]=browserWhisperModels,origin='http://fixture.test';
 const target=[`${origin}/__tc-whisper/tiny/${tiny.revision}`,`${origin}/__tc-whisper/tiny/${tiny.revision}/webgpu`,`https://huggingface.co/${tiny.repo}/resolve/${tiny.revision}/onnx/encoder_model_quantized.onnx`,`https://huggingface.co/${tiny.repo}/resolve/old/config.json`];
 const retained=[`${origin}/__tc-whisper/base/${base.revision}`,`https://huggingface.co/${base.repo}/resolve/${base.revision}/config.json`,'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js',`${origin}/projects/recording.mp4`,`https://example.test/${tiny.repo}/model.onnx`];
 const rows=new Map([...target,...retained].map(url=>[url,new Request(url)]));
 const count=await removeWhisperModelCache({keys:async()=>[...rows.values()],delete:async request=>rows.delete(request.url)},tiny,origin);
 assert.equal(count,4);assert.deepEqual([...rows.keys()],retained);
 assert.equal(await removeWhisperModelCache({keys:async()=>[...rows.values()],delete:async request=>rows.delete(request.url)},tiny,origin),0);
});
test('browser model cache matching rejects similar names and unrelated origins',()=>{
 const tiny=browserWhisperModels[0],origin='http://fixture.test';
 assert.equal(isWhisperModelCacheUrl(`https://huggingface.co/${tiny.repo}-other/resolve/main/a`,tiny,origin),false);
 assert.equal(isWhisperModelCacheUrl('http://other.test/__tc-whisper/tiny/a',tiny,origin),false);
 assert.equal(isWhisperModelCacheUrl('invalid',tiny,origin),false);
});
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
