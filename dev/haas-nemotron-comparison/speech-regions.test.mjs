import test from 'node:test';
import assert from 'node:assert/strict';
import {speechRegions} from './speech-regions.mjs';

const input=(frames,spans)=>{
  const probs=new Float32Array(frames*8);
  for(const [from,to,speaker,probability=.9] of spans) {
    for(let frame=from;frame<to;frame++) probs[frame*8+speaker]=probability;
  }
  return probs;
};

test('話者が重なっても発話秒数と入力区間を二重計上しない',()=>{
  const r=speechRegions(input(200,[[10,100,0],[50,150,1]]),200,2,{pad:0,mergeGap:0});
  assert.equal(r.speakerSegments.length,2);
  assert.deepEqual(r.regions,[{start:.1,end:1.5}]);
  assert.ok(Math.abs(r.speechSeconds-1.4)<1e-9);
  assert.equal(r.retainedSeconds,r.speechSeconds);
});

test('余白はメディア端へclipされ、近い発話は結合される',()=>{
  const r=speechRegions(input(200,[[0,10,0],[100,110,1],[190,200,0]]),200,2);
  assert.deepEqual(r.regions,[{start:0,end:2}]);
  assert.deepEqual(r.removed,[]);
  assert.equal(r.retainedSeconds,2);
});

test('一フレームの短い発話を削らず10msを秒として扱う',()=>{
  const r=speechRegions(input(500,[[200,201,4]]),500,5);
  assert.deepEqual(r.speakerSegments,[{start:2,end:2.01,speaker:4}]);
  assert.deepEqual(r.regions,[{start:1.75,end:2.26}]);
  assert.ok(Math.abs(r.speechSeconds-.01)<1e-9);
  assert.deepEqual(r.removed,[{start:0,end:1.75},{start:2.26,end:5}]);
});

test('全無発話はHaas入力なし、全メディアを除外候補にする',()=>{
  const r=speechRegions(input(30000,[]),30000,300.032);
  assert.deepEqual(r.regions,[]);
  assert.deepEqual(r.removed,[{start:0,end:300.032}]);
  assert.equal(r.speechSeconds,0);
  assert.equal(r.retainedSeconds,0);
});

test('閾値はstrictに適用し、最後の部分フレームは切り上げない',()=>{
  const r=speechRegions(input(3,[[0,1,0,.5],[2,3,1,.75]]),3,.032,{pad:0,mergeGap:0});
  assert.deepEqual(r.regions,[{start:.02,end:.03}]);
  assert.deepEqual(r.shortRegions,[{start:.02,end:.03}]);
  assert.deepEqual(r.removed,[{start:0,end:.02},{start:.03,end:.032}]);
});

test('メディアからのはみ出し・NaN・不正な確率配列を拒否する',()=>{
  assert.throws(()=>speechRegions(input(100,[]),100,.5),/exceeds/);
  const bad=input(10,[]);bad[0]=NaN;
  assert.throws(()=>speechRegions(bad,10,.1),/probabilities/);
  assert.throws(()=>speechRegions(new Float32Array(1),10,.1),/probabilities/);
});
