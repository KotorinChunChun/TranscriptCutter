import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeExport} from '../../web/transcript-utils.mjs';
import {parseVtt,serializeVtt} from '../src/lib/vtt.ts';
import {buildDocument,createEditorState,deleteLines,exportProjectJson,importProjectJson,getEffectiveCuts,buildEditedCues} from '../src/lib/editor.ts';
import {buildMediaCutPlan} from '../src/lib/media-plan.ts';
test('server seconds pass through VTT, edits, resume and native cut seconds without losing speaker or Unicode',()=>{
 const source=[{id:1,start:0,end:1.25,speaker:'話者A',text:'えっと、😀です。'},{id:2,start:2.5,end:4.75,speaker:'話者B',text:'残す本文です。'}];
 const vtt=makeExport({segments:source,format:'vtt'}).text;
 const cues=parseVtt(vtt).cues;assert.equal(cues[0].end,1250);assert.equal(cues[0].speaker,'話者A');assert.equal(cues[1].text,source[1].text);
 const doc=buildDocument(cues);const state=deleteLines(doc,createEditorState(),[doc.lines[0].id]);
 const saved=exportProjectJson(doc,state,{sourceFile:'test.vtt',mediaDurationMs:6000});const resumed=importProjectJson(saved);
 const cuts=getEffectiveCuts(resumed.doc,resumed.state,6000);const plan=buildMediaCutPlan(cuts,6000,resumed.doc.durationMs);
 assert.deepEqual(plan.keep.map(r=>({start:r.start/1000,end:r.end/1000})),[{start:1.25,end:4.75}]);
 const edited=buildEditedCues(resumed.doc,resumed.state,{merge:false,timeline:'edited'});assert.equal(edited[0].start,1250);assert.equal(edited[0].end,3500);assert.match(serializeVtt(edited,{speakerFormat:'voice'}),/残す本文/);
});
