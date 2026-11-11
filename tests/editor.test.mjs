import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRanges,timelineSegments} from '../web/editor.mjs';
test('overlap, ordering and removal use the same time axis',()=>{
 const input=[{start:4,end:6},{start:1,end:3},{start:2,end:5}];
 assert.deepEqual(normalizeRanges(input,10),[{start:1,end:6}]);
 assert.deepEqual(normalizeRanges(input,10,true),[{start:0,end:1},{start:6,end:10}]);
 for(const r of [{start:NaN,end:3},{start:4,end:3},{start:-1,end:3},{start:0,end:11}]) assert.throws(()=>normalizeRanges([r],10));
 assert.throws(()=>normalizeRanges([{start:0,end:10}],10,true));
});
test('cut subtitles are clipped and retimed across disjoint ranges',()=>{
 const output=timelineSegments([{id:1,start:0,end:3,text:'first'},{id:2,start:5,end:8,text:'second'}],[{start:1,end:2},{start:6,end:8}]);
 assert.deepEqual(output.map(s=>[s.start,s.end,s.sourceStart,s.sourceEnd]),[[0,1,1,2],[1,3,6,8]]);
});
