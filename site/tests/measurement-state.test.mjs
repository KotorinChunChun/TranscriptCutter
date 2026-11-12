import {test} from 'node:test';
import assert from 'node:assert/strict';
import {serverMeasurements} from '../measurement-state.ts';
test('server stage times and sampled worker memory remain separate and unknown values stay null',()=>{
 const rows=serverMeasurements({metadata:{measurements:{schemaVersion:1,stages:[
  {id:'a',stage:'recognition',elapsedSeconds:2.5,memory:{scope:'worker-process-group',metric:'private_committed',unit:'bytes',sampleCount:3,peakBytes:1048576,lastBytes:900000}},
  {id:'b',stage:'diarization',elapsedSeconds:null,memory:null},
  {id:'c',elapsedSeconds:NaN,memory:{unit:'bytes',sampleCount:0,peakBytes:0}},
  {id:'d',elapsedSeconds:0,memory:{unit:'MiB',sampleCount:1,peakBytes:2}},null,
 ]}}});
 assert.deepEqual(rows.map(row=>[row.seconds,row.bytes]),[[2.5,1048576],[null,null],[null,null],[0,null]]);
 assert.equal(rows[0].scope,'worker-process-group');assert.equal(rows[0].metric,'private_committed');
 assert.deepEqual(serverMeasurements({metadata:{}}),[]);
});
