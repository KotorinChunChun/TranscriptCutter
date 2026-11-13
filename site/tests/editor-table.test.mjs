import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseVtt} from '../src/lib/vtt.ts';
import {buildDocument,createEditorState,buildGroups,buildEditedCues,mergeWithNeighbor} from '../src/lib/editor.ts';

test('display can group consecutive unknown speakers without changing the saved subtitle identities',()=>{
 const doc=buildDocument(parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n一行目\n\n00:00:02.000 --> 00:00:03.000\n二行目\n\n00:00:04.000 --> 00:00:05.000\n<v 田中>別の話者\n').cues),state=createEditorState();
 const before=JSON.stringify(state),exported=buildEditedCues(doc,state);
 assert.equal(buildGroups(doc,state).length,3);
 assert.deepEqual(buildGroups(doc,state,{merge:true,mergeUnknown:true}).map(g=>[g.speaker,g.lines.length]),[[null,2],['田中',1]]);
 assert.equal(buildGroups(doc,state,{merge:false,mergeUnknown:true}).length,3);
 assert.deepEqual(buildEditedCues(doc,state),exported);
 assert.equal(JSON.stringify(state),before);
 const display=buildGroups(doc,state,{mergeUnknown:true});
 const joined=mergeWithNeighbor(doc,state,display[0].id,'down',{mergeUnknown:true});
 assert.deepEqual(buildGroups(doc,joined,{mergeUnknown:true}).map(g=>[g.speaker,g.lines.length]),[['田中',3]]);
});

test('normal consecutive speakers merge by default while a different or mixed speaker stays separate',()=>{
 const doc=buildDocument(parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<v 田中>一\n\n00:00:02.000 --> 00:00:03.000\n<v 田中>二\n\n00:00:04.000 --> 00:00:05.000\n<v 鈴木>三\n').cues);
 assert.deepEqual(buildGroups(doc,createEditorState(),{mergeUnknown:true}).map(g=>[g.speaker,g.lines.length]),[['田中',2],['鈴木',1]]);
});
