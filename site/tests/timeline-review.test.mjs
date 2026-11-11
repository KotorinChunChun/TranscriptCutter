import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewGaps,thumbnailTimes,compareFrames,visualVerdict} from '../src/lib/timeline-review.ts';
import {buildDocument,createEditorState,deleteTimeRange,getDeletedSpans,timeRangesForText,exportProjectJson,importProjectJson,normalizeCuts,getEffectiveCuts,exportCutJson} from '../src/lib/editor.ts';
const cue=(id,start,end,text='0123456789')=>({id,start,end,text,speaker:'話者1',sourceIds:[id],sourceCount:1});
test('gap display uses union of source cues and includes leading/internal/trailing gaps',()=>{
 const gaps=reviewGaps([cue('a',2000,5000),cue('b',4000,6000),cue('c',16000,18000)],20000);
 assert.deepEqual(gaps.map(g=>[g.start,g.end,g.nextCueId,g.trailing]),[[0,2000,'a',false],[6000,16000,'c',false],[18000,20000,null,true]]);
 assert.deepEqual(reviewGaps([],1000),[]);
});
test('ten seconds yields ten samples; fractional ranges include their last partial second',()=>{
 assert.deepEqual(thumbnailTimes({start:6000,end:16000}),[6000,7000,8000,9000,10000,11000,12000,13000,14000,15000]);
 assert.deepEqual(thumbnailTimes({start:150,end:1250}),[150,1150]);assert.throws(()=>thumbnailTimes({start:2,end:1}));
});
test('time deletion links source characters and exact media range, and survives project resume',()=>{
 const doc=buildDocument([cue('a',0,10000)]),before=createEditorState(),after=deleteTimeRange(doc,before,2000,5000);
 assert.deepEqual(getDeletedSpans(doc,after),[{cueId:'a',from:2,to:5}]);assert.deepEqual(timeRangesForText(doc,[{cueId:'a',from:2,to:5}]),[{start:2000,end:5000}]);assert.equal(before.cuts.length,0);
 const restored=importProjectJson(exportProjectJson(doc,after,{sourceFile:'synthetic.vtt'}));assert.deepEqual(getDeletedSpans(restored.doc,restored.state),getDeletedSpans(doc,after));assert.equal(normalizeCuts(after.cuts,10000)[0].durationMs,3000);
});
test('gap deletion does not delete neighboring text; overlapping media edits use a union',()=>{
 const doc=buildDocument([cue('a',0,5000),cue('b',15000,20000)]),state=deleteTimeRange(doc,createEditorState(),5000,15000);
 assert.deepEqual(getDeletedSpans(doc,state),[]);const next=deleteTimeRange(doc,state,10000,17000);assert.equal(normalizeCuts(next.cuts,20000)[0].durationMs,12000);
});
test('time selection never splits emoji surrogate pairs and rejects invalid bounds',()=>{
 const doc=buildDocument([cue('a',0,3000,'A😀B')]),after=deleteTimeRange(doc,createEditorState(),1100,1900);
 assert.deepEqual(getDeletedSpans(doc,after),[{cueId:'a',from:1,to:3}]);assert.throws(()=>deleteTimeRange(doc,after,NaN,5));
});
test('visual decisions distinguish static frames, visible changes and incomplete observations',()=>{
 const a=new Uint8ClampedArray(400).fill(255),b=a.slice();assert.equal(visualVerdict([compareFrames(a,b)],true).kind,'small');b.fill(0,0,20);assert.equal(visualVerdict([compareFrames(a,b)],true).kind,'changed');assert.equal(visualVerdict([],true).kind,'unknown');assert.equal(visualVerdict([compareFrames(a,b)],false).kind,'unknown');assert.throws(()=>compareFrames(a,new Uint8ClampedArray(4)));
});
test('a reviewed tail can be preserved and resumed while old projects keep the automatic tail policy',()=>{
 const doc=buildDocument([cue('a',0,5000)]),original=createEditorState(),keep={...original,keepTail:true};
 assert.equal(getEffectiveCuts(doc,original,10000).length,1);assert.equal(getEffectiveCuts(doc,keep,10000).length,0);
 const project=importProjectJson(exportProjectJson(doc,keep,{sourceFile:'test.vtt',mediaDurationMs:10000}));assert.equal(project.state.keepTail,true);
 const cuts=JSON.parse(exportCutJson(doc,keep,{sourceFile:'test.vtt',mediaDurationMs:10000}));assert.equal(cuts.truncateAfterMs,null);assert.equal(cuts.trailingMediaPolicy,'preserve');assert.equal(cuts.keepRanges[0].end,10000);
});
