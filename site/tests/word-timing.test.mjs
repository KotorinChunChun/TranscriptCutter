import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachWordTimings,readWordSegments,wordCutCandidate,validatedWordTiming} from '../src/lib/word-timing.ts';
import {buildDocument,createEditorState,deleteTextSpans,deleteTokens,textCutCandidate,timeRangesForText,exportProjectJson,importProjectJson,replaceCueText,resolveEditorDocument} from '../src/lib/editor.ts';
import {serializeVtt} from '../src/lib/vtt.ts';
import {createComparisonSession,exportComparisonJson,importComparisonJson,getSelectedCues} from '../src/lib/comparison.ts';
const cue=(text='ありがとうございます')=>({id:'a',text,start:1000,end:5000,speaker:null,sourceIds:['a'],sourceCount:1});
const segment=(words)=>({start:1,end:5,words});
const data=()=>readWordSegments({segments:[segment([{word:'ありがとうございます',start:2,end:3}])]});

test('candidate narrows the cut without rewriting original VTT; manual range keeps exact selected text',()=>{
 const original=cue(),timed=attachWordTimings([original],data())[0],doc=buildDocument([timed]),span={cueId:'a',from:0,to:original.text.length};
 assert.equal(serializeVtt([timed]),serializeVtt([original]));
 assert.deepEqual(timeRangesForText(doc,[span]),[{start:2000,end:3000}]);
 const cut=deleteTextSpans(doc,createEditorState(),[span]).cuts[0];
 assert.deepEqual([cut.start,cut.end,cut.precision],[2000,3000,'word']);
 const manual=deleteTextSpans(doc,createEditorState(),[{...span,from:5}],{start:2300,end:3150}).cuts[0];
 assert.deepEqual([manual.start,manual.end,manual.precision,manual.spans[0].from],[2300,3150,'manual',5]);
 const tokenCut=deleteTokens(doc,createEditorState(),doc.tokens.filter(t=>t.word).map(t=>t.id));
 assert.ok(tokenCut.cuts.every(c=>c.start>=2000&&c.end<=3000));
});

test('zero-length, mismatched and ambiguous words fall back; holes do not bridge invalid words',()=>{
 const raw=readWordSegments({segments:[segment([{word:'ありが',start:2,end:2.5},{word:'とうございます',start:2.5,end:2.5}])]});
 const timed=attachWordTimings([cue()],raw)[0];
 assert.equal(wordCutCandidate(timed,0,timed.text.length),null);
 assert.equal(textCutCandidate(timed,0,2).method,'単語内を推定');
 const changed=attachWordTimings([cue('どうも')],data())[0];assert.equal(changed.wordTiming,undefined);
 const repeated=attachWordTimings([cue('ありがとうありがとう')],readWordSegments({segments:[segment([{word:'ありがとう',start:2,end:3}])]}))[0];
 assert.equal(repeated.wordTiming,undefined);
 assert.deepEqual(timeRangesForText(buildDocument([cue('どうも')]),[{cueId:'a',from:1,to:2}]),[{start:2333,end:3667}]);
});

test('Unicode partial units interpolate and invalid metadata never survives import',()=>{
 const c=cue('😀ありがとう'),timed=attachWordTimings([c],readWordSegments({segments:[segment([{word:c.text,start:2,end:3}])]}))[0];
 assert.equal(wordCutCandidate(timed,2,3).interpolated,true);
 assert.equal(wordCutCandidate(timed,2,3).start,2167);
 assert.equal(validatedWordTiming(c,{text:c.text,units:[{from:1,to:3,start:2000,end:3000}]}),undefined);
 assert.equal(validatedWordTiming(c,{text:c.text,units:[{from:0,to:3,start:3000,end:3000}]}),undefined);
});

test('project and comparison retain timing; changed text and crossing time invalidate it',()=>{
 const timed=attachWordTimings([cue()],data())[0],doc=buildDocument([timed]);
 const restored=importProjectJson(exportProjectJson(doc,createEditorState(),{sourceFile:'original.vtt'}));
 assert.deepEqual(restored.doc.cues[0].wordTiming,timed.wordTiming);
 const comparison=createComparisonSession([{id:'s',name:'元字幕',fileName:'original.vtt',cues:[timed],warnings:[]}]);
 assert.deepEqual(getSelectedCues(importComparisonJson(exportComparisonJson(comparison)))[0].wordTiming,timed.wordTiming);
 const revised=resolveEditorDocument(doc,replaceCueText(doc,createEditorState(),'a','ありがとうです'));
 assert.equal(wordCutCandidate(revised.cues[0],0,3),null);
 const c=cue('専門用語です'),crossed=attachWordTimings([c],readWordSegments({segments:[segment([{word:'専門',start:3,end:4},{word:'用語です',start:2,end:2.5}])]}))[0];
 assert.equal(crossed.wordTiming,undefined);
});
