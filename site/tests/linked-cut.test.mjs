import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDocument,createEditorState,deleteTextSpans,deleteTimeRange,getDeletedSpans,getEditedLineText,updateCut,removeCut,normalizeCuts,exportProjectJson,importProjectJson,buildEditedCues} from '../src/lib/editor.ts';
import {muteCoverage,setMuteRanges,toggleMuteRanges} from '../src/lib/audio-mute.ts';

const cue={id:'a',start:0,end:10000,text:'abcdefghij',speaker:'話者1',sourceIds:['a'],sourceCount:1};
const doc=buildDocument([cue]),span={cueId:'a',from:2,to:4};
test('a linked cut preserves selected characters while independently adjusting media bounds and restoring a project',()=>{
 const first=deleteTextSpans(doc,createEditorState(),[span],{start:5000,end:6000});
 assert.equal(getEditedLineText(doc,first,doc.lines[0]),'abefghij');
 const cut=first.cuts[0],moved=updateCut(first,cut.id,{start:7000,end:8000});
 assert.equal(moved.cuts[0].id,cut.id);assert.deepEqual(moved.cuts[0].spans,[span]);assert.equal(getEditedLineText(doc,moved,doc.lines[0]),'abefghij');
 const resumed=importProjectJson(exportProjectJson(doc,moved,{sourceFile:'fixture.vtt',mediaDurationMs:10000}));
 assert.deepEqual(resumed.state.cuts[0].spans,[span]);assert.deepEqual([resumed.state.cuts[0].start,resumed.state.cuts[0].end],[7000,8000]);
 const restored=removeCut(resumed.state,cut.id);assert.equal(getEditedLineText(resumed.doc,restored,resumed.doc.lines[0]),cue.text);
});
test('cancelling one linked edit preserves a separate overlapping cut and its characters',()=>{
 const first=deleteTextSpans(doc,createEditorState(),[{cueId:'a',from:2,to:6}],{start:2000,end:6000});
 const second=deleteTextSpans(doc,first,[{cueId:'a',from:4,to:8}],{start:4000,end:8000});
 const removed=removeCut(second,first.cuts[0].id);
 assert.equal(removed.cuts.length,1);assert.deepEqual(getDeletedSpans(doc,removed),[{cueId:'a',from:4,to:8}]);assert.equal(getEditedLineText(doc,removed,doc.lines[0]),'abcdij');
 assert.deepEqual(normalizeCuts(removed.cuts).map(r=>[r.start,r.end]),[[4000,8000]]);assert.strictEqual(removeCut(removed,'absent'),removed);
});
test('media-only cuts keep all subtitle characters and explain when a cue has no surviving display time',()=>{
 const cut=deleteTimeRange(doc,createEditorState(),2000,7000);
 assert.equal(getEditedLineText(doc,cut,doc.lines[0]),cue.text);assert.equal(buildEditedCues(doc,cut,{merge:false}).map(c=>c.text).join(''),cue.text);
 const whole=deleteTimeRange(doc,createEditorState(),0,10000);
 assert.equal(getEditedLineText(doc,whole,doc.lines[0]),cue.text);assert.throws(()=>buildEditedCues(doc,whole),/表示時間がすべてカットされています。本文は残しています/);
});
test('mute coverage covers multiple selections without counting their unselected gap',()=>{
 const ranges=[{start:1000,end:2000},{start:3000,end:4000}],selection=[{start:1100,end:1900},{start:3100,end:3900}];
 assert.equal(muteCoverage(ranges,selection),'full');assert.equal(muteCoverage(ranges,[{start:1500,end:3500}]),'partial');assert.equal(muteCoverage(ranges,[{start:2000,end:3000}]),'none');assert.equal(muteCoverage(ranges,[]),'none');
 assert.equal(muteCoverage([{start:0,end:10}],[{start:2,end:4},{start:6,end:8}]),'full');
});
test('mute toggle fills partial coverage, reverses full coverage, and preserves no-op identity',()=>{
 const ranges=[{start:1000,end:2000},{start:5000,end:6000}],selection=[{start:1500,end:3000}];
 const filled=toggleMuteRanges(ranges,selection);assert.deepEqual(filled,[{start:1000,end:3000},{start:5000,end:6000}]);
 assert.deepEqual(toggleMuteRanges(filled,selection),[{start:1000,end:1500},{start:5000,end:6000}]);
 assert.strictEqual(setMuteRanges(ranges,[{start:3000,end:4000}],false),ranges);assert.strictEqual(setMuteRanges(ranges,[{start:1100,end:1900}],true),ranges);assert.strictEqual(toggleMuteRanges(ranges,[]),ranges);
 assert.deepEqual(ranges,[{start:1000,end:2000},{start:5000,end:6000}]);
});
