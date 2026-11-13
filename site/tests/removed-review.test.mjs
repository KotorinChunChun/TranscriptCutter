import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildDocument,createEditorState,addCut,deleteTextSpans} from '../src/lib/editor.ts';
import {parseVtt} from '../src/lib/vtt.ts';
import {buildRemovedMediaPlan} from '../src/lib/media-plan.ts';
import {removedReviewCues,removedReviewFiles} from '../src/lib/removed-review.ts';
import {videoSaveFiles} from '../src/lib/save-package.ts';
const doc=buildDocument(parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:08.000\n<v 話者A>前半後半\n\n00:00:10.000 --> 00:00:14.000\n<v 話者B>資料\n').cues);
test('removed review merges overlaps, clips bounds and concatenates only deleted media',()=>{
 const plan=buildRemovedMediaPlan([{start:9000,end:12000},{start:1000,end:3000},{start:2000,end:4000},{start:15000,end:17000}],16000);
 assert.deepEqual(plan.keep,[{start:1000,end:4000,outputStart:0,outputEnd:3000},{start:9000,end:12000,outputStart:3000,outputEnd:6000},{start:15000,end:16000,outputStart:6000,outputEnd:7000}]);
 assert.equal(plan.outputDurationMs,7000);assert.equal(plan.clippedCutCount,1);
 assert.equal(buildRemovedMediaPlan([],16000).outputDurationMs,0);
 assert.equal(buildRemovedMediaPlan([{start:0,end:16000}],16000).outputDurationMs,16000);
});
test('review restores deleted words and speaker labels on its own output timeline',()=>{
 let state=deleteTextSpans(doc,createEditorState(),[{cueId:doc.cues[0].id,from:1,to:2}]);
 state=addCut(state,{start:10000,end:14000,kind:'manual',precision:'manual'});
 state={...state,aliases:{'話者B':'佐藤'}};
 assert.deepEqual(removedReviewCues(doc,state,16000).map(c=>[c.start,c.end,c.text,c.speaker]),[[0,2000,'半','話者A'],[2000,6000,'資料','佐藤']]);
 assert.equal(state.cuts.length,2);
});
test('review fills comparison-rejected text only in uncovered times and keeps silent cuts empty',()=>{
 const current=buildDocument(parseVtt('WEBVTT\n\n00:00:04.000 --> 00:00:08.000\n採用した修正\n').cues);
 let state=addCut(createEditorState(),{start:0,end:8000,kind:'manual',precision:'manual'});
 const fallback=parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:08.000\nあいうえおかきく\n').cues;
 const comparison={referenceId:'ref',sources:[{id:'ref',cues:fallback},{id:'other',cues:fallback}]};
 assert.deepEqual(removedReviewCues(current,state,12000,comparison).map(c=>[c.start,c.end,c.text]),[[0,4000,'あいうえ'],[4000,8000,'採用した修正']]);
 state=addCut(createEditorState(),{start:9000,end:12000,kind:'gap',precision:'gap'});
 assert.deepEqual(removedReviewCues(current,state,12000),[]);
});
test('review ZIP entries are media and synchronized VTT; all-save has no review files',async()=>{
 const state=addCut(createEditorState(),{start:0,end:8000,kind:'manual',precision:'manual'});
 const media={blob:new Blob(['fixture']),fileName:'確認_removed_review.webm',durationMs:8000};
 const files=removedReviewFiles({doc,state,sourceDurationMs:16000,media});
 assert.deepEqual(files.map(f=>f.name),['確認_removed_review.webm','確認_removed_review.vtt']);
 assert.deepEqual(parseVtt(await files[1].blob.text()).cues.map(c=>[c.start,c.end,c.text]),[[0,8000,'前半後半']]);
 const all=videoSaveFiles({doc,state:{...state,cuts:[]},sourceFile:'元.vtt',sourceMedia:'元.mp4',sourceDurationMs:16000,comparison:null,merge:{},metrics:[],media:{...media,fileName:'元_cut.webm',durationMs:16000}});
 assert.equal(all.some(f=>f.name.includes('removed_review')),false);
});
