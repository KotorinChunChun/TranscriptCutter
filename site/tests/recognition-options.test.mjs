import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recognitionRange,parseClock,supportedModel,effectiveDiarization,finishEstimate} from '../recognition-options.ts';
import {beginMetric,processingMetrics,measure} from '../processing-metrics.ts';
test('edge bounds omit the end instead of truncating fractional media duration',()=>{
 assert.deepEqual(recognitionRange('edge','ignored','edge','ignored'),{from:0,to:undefined});
 assert.deepEqual(recognitionRange('custom','01:10:48.001','custom','01:10:49.987'),{from:4248.001,to:4249.987});
 assert.deepEqual(recognitionRange('custom','00:01:00.125','edge','invalid'),{from:60.125,to:undefined});
 for(const value of ['00:00:60.000','00:60:00.000','00:00:01.12','-1:00:00.000','10','00:00:00.001x'])assert.throws(()=>parseClock(value));
 assert.throws(()=>recognitionRange('custom','00:00:01.000','custom','00:00:00.999'));
});
const model=values=>({id:'whisper/tiny',x_meeting:{engineId:'whisper',processingMethods:[{id:'cpu'}],...values}});
test('unsupported and un-installable models are hidden; installable uncached models are distinct from unsupported',()=>{
 assert.equal(supportedModel(model({availability:'installed',installable:false})),true);
 assert.equal(supportedModel(model({availability:'download_on_first_use',installable:true})),true);
 for(const values of [{availability:'unavailable'},{supported:false},{installable:false},{processingMethods:[]},{task:'diarization'},{runtimeStatus:'unconfigured'},{managementState:'unsupported'}])assert.equal(supportedModel(model(values)),false);
});
test('speaker preference survives models without diarization and is applied only when supported',()=>{
 const preference=true;assert.equal(effectiveDiarization(preference,model({diarization:true})),true);assert.equal(effectiveDiarization(preference,model({diarization:false})),false);assert.equal(effectiveDiarization(preference,model({diarization:true})),true);
});
test('finish estimate uses processed range and running time, excludes waiting/diarization/completed work',()=>{
 const now=Date.parse('2026-11-12T00:00:20Z'),job={status:'running',phase:'transcribing',rangeStart:60,rangeEnd:100,processedUntil:80,metadata:{startedAt:'2026-11-12T00:00:00Z'}};
 assert.deepEqual(finishEstimate(job,now),{remainingSeconds:20,finishAt:now+20000});
 for(const changes of [{status:'queued'},{status:'complete'},{phase:'diarizing'},{processedUntil:60},{processedUntil:100},{metadata:{}},{rangeEnd:Infinity}])assert.equal(finishEstimate({...job,...changes},now),null);
});
test('stage metrics are monotonic, distinguish failures and never manufacture missing memory',async()=>{
 const end=beginMetric('fixture',{jobId:'fixture'}),entry=end();assert.ok(entry.durationSeconds>=0);assert.equal(entry.memoryStart,null);assert.equal(end(),undefined);
 await assert.rejects(measure('fixture-error',{},async()=>{throw Error('synthetic');}));
 const saved=processingMetrics();assert.equal(saved.at(-1).outcome,'error');saved.at(-1).details.changed=true;assert.equal(processingMetrics().at(-1).details.changed,undefined);
});
