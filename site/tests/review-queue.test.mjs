import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildDocument,createEditorState,addCut,exportProjectJson,importProjectJson,replaceCueText,buildEditedCues} from '../src/lib/editor.ts';
import {buildReviewQueue} from '../src/lib/review-queue.ts';
import {readReviewMarks,bookmarksAfterCuts} from '../src/lib/review-marks.ts';
import {createComparisonSession,exportComparisonJson,importComparisonJson} from '../src/lib/comparison.ts';
const cue=(id,text,start,end,speaker=null)=>({id,text,start,end,speaker,sourceIds:[id],sourceCount:1});
const doc=buildDocument([cue('a','確認する内容です',0,4000),cue('b','確認する内容です',4500,8000,'田中')]);
test('review detects unknown speaker, repetition and estimated cuts without changing text',()=>{
 const state=addCut(createEditorState(),{start:500,end:900,kind:'manual',precision:'estimated',sourceCueIds:[],text:'境界'});
 const items=buildReviewQueue(doc,state,null);
 assert.deepEqual(items.map(i=>i.reason),['話者不明','推定時刻のカット','繰り返し候補']);
 assert.equal(doc.cues[0].text,'確認する内容です');
});
test('acknowledgement key changes when evidence changes and survives unrelated bookmark edits',()=>{
 const state=createEditorState(),first=buildReviewQueue(doc,state,null)[0];
 const changed=replaceCueText(doc,state,'a','確認内容を変更しました');
 assert.notEqual(buildReviewQueue(doc,changed,null)[0].id,first.id);
 assert.equal(buildReviewQueue(doc,{...state,bookmarks:[{id:'b',start:0,end:0,name:'開始',note:''}]},null)[0].id,first.id);
});
test('comparison includes missing candidate and changed speaker/text; identical variants are omitted',()=>{
 const source=(id,cues)=>({id,name:id,fileName:id+'.vtt',cues,warnings:[]});
 const session=createComparisonSession([source('one',doc.cues),source('two',[{...doc.cues[0],text:'別の内容'}])]);
 const issues=buildReviewQueue(buildDocument([]),createEditorState(),session);
 assert.equal(issues.length,2);assert.ok(issues.every(i=>i.comparisonRowId));
 assert.equal(buildReviewQueue(buildDocument([]),createEditorState(),createComparisonSession([source('one',doc.cues),source('two',doc.cues)])).length,0);
});
test('bookmark and reviewed state survive project round trip and reject malformed records',()=>{
 const marks={bookmarks:[{id:'mark',start:200,end:1200,name:'重要',note:'発言を確認'}],reviewed:['abcd-1234']};
 const state={...createEditorState(),...marks};
 const copy=importProjectJson(exportProjectJson(doc,state,{sourceFile:'test.vtt'}));
 assert.deepEqual(copy.state.bookmarks,marks.bookmarks);assert.deepEqual(copy.state.reviewed,marks.reviewed);
 assert.throws(()=>readReviewMarks({bookmarks:[{...marks.bookmarks[0],start:-1}]}));
 assert.throws(()=>readReviewMarks({bookmarks:[marks.bookmarks[0],marks.bookmarks[0]]}));
 assert.throws(()=>readReviewMarks({reviewed:[{}]}));
});
test('cut output bookmarks use edited time, omit fully removed marks and clip partial spans',()=>{
 const mark=(id,start,end)=>({id,start,end,name:id,note:''});
 assert.deepEqual(bookmarksAfterCuts([mark('before',0,0),mark('gone',1100,1900),mark('partial',1500,2500),mark('later',3000,3000)],[{start:1000,end:2000}],5000).map(b=>[b.id,b.start,b.end]),[['before',0,0],['partial',1000,1500],['later',2000,2000]]);
});
test('comparison project preserves review records and rejects invalid bookmark data',()=>{
 const session=createComparisonSession([{id:'s',name:'元字幕',fileName:'test.vtt',cues:doc.cues,warnings:[]}]);
 session.reviewMarks={bookmarks:[{id:'m',start:100,end:100,name:'目印',note:'確認'}],reviewed:['abc-def']};
 assert.deepEqual(importComparisonJson(exportComparisonJson(session)).reviewMarks,session.reviewMarks);
 assert.throws(()=>importComparisonJson(JSON.stringify({...session,reviewMarks:{bookmarks:[{id:'m',start:NaN}]}})));
});
test('retranscription reference subtitles use cut-media time while muted words remain',()=>{
 const state={...addCut(createEditorState(),{start:0,end:4000,kind:'line',precision:'cue',sourceCueIds:['a'],spans:[{cueId:'a',from:0,to:doc.cues[0].text.length}]}),mutes:[{start:4500,end:5000}]};
 const edited=buildEditedCues(doc,state,{merge:false,timeline:'edited'});
 assert.equal(edited.length,1);assert.equal(edited[0].start,500);assert.equal(edited[0].text,doc.cues[1].text);assert.equal(doc.cues[1].start,4500);
});
