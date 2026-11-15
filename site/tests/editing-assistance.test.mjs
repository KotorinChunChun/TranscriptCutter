import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compactSpeakerGroups,quietBoundaryCandidates} from '../src/lib/editing-assistance.ts';
import {buildDocument,createEditorState,buildGroups,buildEditedCues} from '../src/lib/editor.ts';
import {attachWordTimings,wordCutCandidate} from '../src/lib/word-timing.ts';
const cue=(id,text,start,end,speaker='佐藤')=>({id,text,start,end,speaker,sourceIds:[id],sourceCount:1});
test('compact unknown display keeps original speaker, text, exports and boundaries',()=>{
 const doc=buildDocument([cue('a','前の発言',0,2000),cue('b','短い不明',2100,2800,null),cue('c','次の発言',2900,5000)]),state=createEditorState();
 const before=buildEditedCues(doc,state),raw=buildGroups(doc,state,{preserveOverlap:true}),view=compactSpeakerGroups(raw);
 assert.equal(view.length,1);assert.deepEqual(view[0].displayUnknownCueIds,['b']);assert.equal(view[0].cues[1].speaker,null);
 assert.equal(raw.length,3);assert.deepEqual(buildEditedCues(doc,state),before);
 for(const replacement of [cue('b','別話者',2100,2800,'田中'),cue('b','重複',1900,2800,null),cue('b','長い',2100,4000,null)]){
  assert.equal(compactSpeakerGroups(buildGroups(buildDocument([doc.cues[0],replacement,doc.cues[2]]),state,{preserveOverlap:true})).length,3);
 }
 assert.equal(buildGroups(buildDocument([cue('x','同時発言',0,3000),cue('y','重複',2000,4000)]),state,{preserveOverlap:true}).length,2);
});
test('repeated words use unique context and keep ambiguous or crossing words estimated',()=>{
 const c=cue('a','先に確認して、次に確認する',0,6000);
 const words=[{word:'先に',start:0,end:1},{word:'確認',start:1,end:2},{word:'して、次に',start:2,end:3},{word:'確認',start:3,end:4},{word:'する',start:4,end:5}];
 const timed=attachWordTimings([c],[{start:0,end:6,words}])[0];
 assert.deepEqual(wordCutCandidate(timed,2,4),{start:1000,end:2000,interpolated:false});
 assert.deepEqual(wordCutCandidate(timed,9,11),{start:3000,end:4000,interpolated:false});
 assert.equal(timed.text,c.text);
 const ambiguous=attachWordTimings([cue('b','確認確認',0,6000)],[{start:0,end:6,words:[{word:'確認',start:1,end:2}]}])[0];
 assert.equal(ambiguous.wordTiming,undefined);
});
test('quiet candidate is local, nonzero, explicit and leaves noisy ranges unchanged',()=>{
 const peaks=Array(100).fill(.6);peaks[21]=.01;peaks[79]=.02;
 assert.deepEqual(quietBoundaryCandidates({peaks,start:0,end:1000},{start:200,end:800}),{start:215,end:795});
 assert.equal(quietBoundaryCandidates({peaks:Array(100).fill(.6),start:0,end:1000},{start:200,end:800}),null);
 assert.equal(quietBoundaryCandidates({peaks:[],start:0,end:1000},{start:200,end:800}),null);
});
