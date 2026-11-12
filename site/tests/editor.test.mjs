import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseVtt, serializeVtt } from '../src/lib/vtt.ts';
import { buildDocument, createEditorState, deleteTokens, deleteLines, addCut, updateCut, removeCut, getDeletedSpans, getDeletedTokenIds, getEditedTokenText, getEditedLineText, renameSpeaker, getSpeakerParts, getDisplaySpeaker, buildGroups, mergeWithNeighbor, findFillers, deleteFillers, normalizeCuts, getKeepRanges, getTranscriptTailCut, getEffectiveCuts, toEditedTime, buildEditedCues, exportCutJson, exportCutCsv, exportProjectJson, importProjectJson } from '../src/lib/editor.ts';
import { buildMediaCutPlan } from '../src/lib/media-plan.ts';

const cue = (id,text,start=0,end=10000,speaker='話者1') => ({id,text,start,end,speaker,sourceIds:[id],sourceCount:1});
const empty = createEditorState;
const visible = (doc,state) => doc.lines.map(line=>getEditedLineText(doc,state,line)).join('\n');
const tokens = (doc,text) => doc.tokens.filter(t=>t.text===text).map(t=>t.id);

test('lossless Unicode tokenization, stable offsets, and line precision',()=>{
  const doc=buildDocument([cue('a','日本語 😀、 abc  def\n次の行。')]);
  assert.equal(doc.tokens.map(t=>t.text).join(''),doc.cues[0].text);
  for(const token of doc.tokens) assert.equal(doc.cues[0].text.slice(token.from,token.to),token.text);
  assert.equal(doc.lines.length,2); assert.ok(doc.lines.every(l=>l.precision==='estimated'));
  assert.equal(doc.lines[0].start,0); assert.equal(doc.lines.at(-1).end,10000);
  assert.deepEqual(doc.tokens.map(t=>t.id),buildDocument(doc.cues).tokens.map(t=>t.id));
  assert.equal(buildDocument([cue('b','single')]).lines[0].precision,'cue');
});

test('word deletion is immutable, reversible, and unaffected by moved media bounds',()=>{
  const doc=buildDocument([cue('a','one two three')]), state=empty();
  const original=JSON.stringify(doc.cues), edited=deleteTokens(doc,state,tokens(doc,'two'));
  assert.equal(state.cuts.length,0); assert.equal(JSON.stringify(doc.cues),original);
  assert.equal(edited.cuts[0].precision,'estimated'); assert.equal(visible(doc,edited),'one  three');
  assert.equal(getDeletedTokenIds(doc,edited).size,1);
  const moved=updateCut(edited,edited.cuts[0].id,{start:5000,end:6000});
  assert.equal(visible(doc,moved),'one  three');
  assert.equal(visible(doc,removeCut(moved,moved.cuts[0].id)),'one two three');
  assert.strictEqual(getDeletedSpans(doc,edited),getDeletedSpans(doc,edited));
});

test('overlapping edit events restore only when all corresponding events are removed',()=>{
  const doc=buildDocument([cue('a','one two three')]);
  let state=deleteTokens(doc,empty(),tokens(doc,'two'));
  state=addCut(state,{...state.cuts[0],id:'duplicate'});
  assert.equal(visible(doc,removeCut(state,state.cuts[0].id)),'one  three');
  assert.equal(normalizeCuts(state.cuts).length,1);
});

test('whole-cue line removal preserves exact bounds and retimes following subtitle once',()=>{
  const doc=buildDocument([cue('a','first',1000,5000),cue('b','second',8000,10000,'話者2')]);
  const state=deleteLines(doc,empty(),[doc.lines[0].id]);
  assert.deepEqual([state.cuts[0].start,state.cuts[0].end,state.cuts[0].precision],[1000,5000,'cue']);
  const out=buildEditedCues(doc,state,{timeline:'edited'});
  assert.equal(out.length,1); assert.equal(out[0].text,'second');
  assert.deepEqual([out[0].start,out[0].end],[4000,6000]);
});

test('filler matching avoids repeated まあまあ and Latin interiors; partial spans delete precisely',()=>{
  const doc=buildDocument([cue('a','まあまあ。まあ、えーっと会議、summer um umbrella')]);
  assert.equal(findFillers(doc).filter(c=>c.term==='まあ').length,1);
  assert.equal(findFillers(doc,['um']).length,1);
  const partial=findFillers(doc,['っと']); assert.equal(partial.length,1);
  const state=deleteFillers(doc,empty(),partial);
  assert.equal(visible(doc,state),'まあまあ。まあ、えー会議、summer um umbrella');
  assert.equal(doc.tokens.map(t=>getEditedTokenText(doc,state,t)).join(''),visible(doc,state));
  assert.equal(state.cuts[0].text,'っと');
});

test('filler removal includes one trailing comma and adjacent spaces, retaining sentence text and full stops',()=>{
  for(const comma of ['、','，',',']) {
    const doc=buildDocument([cue('a',`えーっと${comma}会議を始めます。`)]);
    const [candidate]=findFillers(doc,['えーっと']);
    assert.equal(candidate.term,'えーっと'); assert.equal(candidate.text,`えーっと${comma}`);
    assert.deepEqual(candidate.spans,[{cueId:'a',from:0,to:5}]);
    assert.equal(candidate.end,Math.round(10000*5/doc.cues[0].text.length));
    const state=deleteFillers(doc,empty(),[candidate]);
    assert.equal(visible(doc,state),'会議を始めます。');
    assert.equal(buildEditedCues(doc,state)[0].text,'会議を始めます。');
    assert.equal(visible(doc,removeCut(state,state.cuts[0].id)),doc.cues[0].text);
  }
  const spaced=buildDocument([cue('a','えっと \t、　 会議を始めます。')]);
  const [candidate]=findFillers(spaced,['えっと']);
  assert.equal(candidate.text,'えっと \t、　 ');
  assert.equal(visible(spaced,deleteFillers(spaced,empty(),[candidate])),'会議を始めます。');
  for(const text of ['えっと。会議を始めます。','えっと\n、会議を始めます。']) {
    const doc=buildDocument([cue('a',text)]);
    assert.equal(findFillers(doc,['えっと'])[0].text,'えっと');
  }
});

test('aliases update compound labels while preserving canonical speaker identities',()=>{
  const doc=buildDocument([cue('a','a',0,1000,'話者1'),cue('b','b',1000,2000,'話者2'),cue('c','c',2000,3000,'話者1 / 話者2')]);
  let state=renameSpeaker(empty(),'話者1','田中'); state=renameSpeaker(state,'話者2','田中');
  assert.equal(getDisplaySpeaker(doc.cues[2],state),'田中 / 田中');
  assert.equal(buildGroups(doc,state).length,3); assert.equal(buildEditedCues(doc,state).length,3);
  assert.throws(()=>renameSpeaker(state,'__proto__','evil'));
});

test('manual merge uses a true adjacent group and does not skip deleted groups',()=>{
  const doc=buildDocument([cue('a','a',0,1000,'話者1'),cue('b','b',1000,2000,'話者1 / 話者2'),cue('c','c',2000,3000,'話者2')]);
  const groups=buildGroups(doc,empty()), state=mergeWithNeighbor(doc,empty(),groups[1].id,'down');
  assert.equal(state.speakerOverrides.b,'話者2');
  assert.deepEqual(buildGroups(doc,state).map(g=>g.cueIds),[['a'],['b','c']]);
  assert.equal(buildEditedCues(doc,state)[1].speaker,'話者2');
  assert.equal(buildGroups(doc,state,{merge:false}).length,2);
  const deleted=deleteLines(doc,empty(),[doc.lines[1].id]);
  assert.throws(()=>mergeWithNeighbor(doc,deleted,groups[0].id,'down'),/削除済み/);
});

test('compound speakers accept compact and spaced ASCII/fullwidth slashes without changing canonical identity or order',()=>{
  const labels=['話者1/話者2','話者1 / 話者2','話者1／話者2',' 話者1　／　話者2 ','話者2／話者1'];
  const doc=buildDocument(labels.map((label,index)=>cue(`s${index}`,'発言',index*1000,(index+1)*1000,label)));
  let state=renameSpeaker(empty(),'話者1','田中'); state=renameSpeaker(state,'話者2','鈴木');
  for(let i=0;i<4;i+=1) {
    assert.deepEqual(getSpeakerParts(labels[i]),['話者1','話者2']);
    assert.equal(getDisplaySpeaker(doc.cues[i],state),'田中 / 鈴木');
  }
  assert.deepEqual(getSpeakerParts(null),[]);
  assert.equal(getDisplaySpeaker(doc.cues[4],state),'鈴木 / 田中');
  assert.deepEqual(buildGroups(doc,state).map(group=>group.canonicalSpeaker),labels);
  assert.equal(buildGroups(doc,state).length,5);
  const exact=renameSpeaker(state,'話者1／話者2','共同発言');
  assert.equal(getDisplaySpeaker(doc.cues[2],exact),'共同発言');
  assert.equal(getDisplaySpeaker(doc.cues[0],exact),'田中 / 鈴木');
});

test('overlap and touching cuts form one union with independent edit records',()=>{
  let state=empty();
  for(const [start,end,precision] of [[100,400,'cue'],[300,600,'estimated'],[600,700,'audio']]) state=addCut(state,{start,end,kind:'manual',precision,sourceCueIds:[]});
  const ranges=normalizeCuts(state.cuts,1000);
  assert.equal(ranges.length,1); assert.equal(ranges[0].durationMs,600); assert.equal(ranges[0].estimated,true);
  assert.equal(ranges[0].editIds.length,3);
  assert.deepEqual(getKeepRanges(state.cuts,1000),[{start:0,end:100,durationMs:100},{start:700,end:1000,durationMs:300}]);
  assert.equal(toEditedTime(800,ranges),200); assert.equal(toEditedTime(500,ranges),100);
});

test('VTT exports split at removed intervals in original and edited timelines',()=>{
  const doc=buildDocument([cue('a','one two three',0,13000)]), state=deleteTokens(doc,empty(),tokens(doc,'two'));
  const cut=state.cuts[0], original=buildEditedCues(doc,state,{timeline:'original'}), edited=buildEditedCues(doc,state,{timeline:'edited'});
  assert.equal(original.length,2); assert.equal(edited.length,2);
  assert.equal(original[0].text,'one'); assert.equal(original[1].text,'three');
  assert.equal(original[0].end,cut.start); assert.equal(original[1].start,cut.end);
  assert.equal(edited[0].end,edited[1].start); assert.equal(edited.at(-1).end,13000-(cut.end-cut.start));
  assert.equal(parseVtt(serializeVtt(original)).cues.length,2);
});

test('media-only cuts preserve all nondeleted words; fully covered cue requires review',()=>{
  const doc=buildDocument([cue('a','one two three',0,13000)]);
  const state=addCut(empty(),{start:4000,end:7000,kind:'silence',precision:'audio',sourceCueIds:['a']});
  assert.equal(visible(doc,state),'one two three'); assert.equal(getDeletedTokenIds(doc,state).size,0);
  const out=buildEditedCues(doc,state);
  assert.equal(out.map(c=>c.text).join(' ').replace(/\s+/g,' '),'one two three');
  assert.ok(out.every(c=>c.end<=4000||c.start>=7000));
  const all=addCut(empty(),{start:0,end:13000,kind:'silence',precision:'audio',sourceCueIds:['a']});
  assert.throws(()=>buildEditedCues(doc,all),/全区間/);
});

test('explicit tail discard exports a complete keep policy bounded by the input VTT',()=>{
  const doc=buildDocument([cue('a','abc',0,10000)]), state=addCut({...empty(),keepTail:false},{start:1000,end:2000,kind:'gap',precision:'gap'});
  const unknown=JSON.parse(exportCutJson(doc,state,{sourceFile:'example.vtt'}));
  assert.equal(unknown.mediaDurationMs,null); assert.equal(unknown.keepRangesComplete,true);
  assert.equal(unknown.truncateAfterMs,10000); assert.equal(unknown.trailingMediaPolicy,'discard');
  assert.equal(unknown.cutRangesComplete,false); assert.equal(unknown.totalCutDurationMsKnown,false);
  assert.equal(unknown.keepRanges.at(-1).end,10000); assert.equal(unknown.totalCutDurationMs,1000);
  assert.deepEqual(unknown.automaticCuts,[]);
  assert.equal(unknown.subtitleEndMs,10000); assert.equal(unknown.timeline,'original');
  const known=JSON.parse(exportCutJson(doc,state,{sourceFile:'example.vtt',mediaDurationMs:20000}));
  assert.equal(known.keepRangesComplete,true); assert.equal(known.keepRanges.at(-1).end,10000);
  assert.equal(known.cutRangesComplete,true); assert.equal(known.totalCutDurationMsKnown,true);
  assert.equal(known.totalCutDurationMs,11000);
  assert.deepEqual(known.cutRanges.map(r=>[r.start,r.end]),[[1000,2000],[10000,20000]]);
  assert.deepEqual(known.automaticCuts.map(c=>[c.start,c.end,c.kind]),[[10000,20000,'tail']]);
  assert.throws(()=>exportCutCsv(doc,state),/元の動画・音声を追加/);
  const csv=exportCutCsv(doc,state,{mediaDurationMs:20000});
  assert.match(csv,/precision,estimated/); assert.match(csv,/"10000","20000","10000","cue","false","tail"/);
});

test('tail cut uses the maximum cue end and is derived without adding undoable edits',()=>{
  const doc=buildDocument([cue('later','後',8000,10007),cue('earlier','前',1000,4000)]);
  const state={...empty(),keepTail:false}, snapshot=structuredClone(state);
  const tail=getTranscriptTailCut(doc,12000);
  assert.equal(doc.durationMs,10007);
  assert.deepEqual([tail.start,tail.end,tail.kind,tail.precision],[10007,12000,'tail','cue']);
  assert.deepEqual(tail.sourceCueIds,[]); assert.equal(tail.spans,undefined);
  assert.deepEqual(getEffectiveCuts(doc,state,12000),[tail]);
  assert.deepEqual(state,snapshot);
  assert.equal(getTranscriptTailCut(doc),null);
  assert.equal(getTranscriptTailCut(doc,10007),null);
  assert.equal(getTranscriptTailCut(doc,9000),null);
  for(const invalid of [NaN,Infinity,-1,1.1,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>getTranscriptTailCut(doc,invalid),/整数ミリ秒/);
});

test('tail overlap is removed once and JSON keep intervals match actual video planning',()=>{
  const doc=buildDocument([cue('a','abc',1000,10000)]);
  let state=addCut({...empty(),keepTail:false},{id:'inside',start:2000,end:3000,kind:'manual',precision:'manual'});
  state=addCut(state,{id:'overlap',start:9000,end:11000,kind:'manual',precision:'manual'});
  const exported=JSON.parse(exportCutJson(doc,state,{sourceFile:'test.vtt',mediaDurationMs:12000}));
  const plan=buildMediaCutPlan(state.cuts,12000,doc.durationMs);
  assert.deepEqual(exported.cutRanges.map(r=>({start:r.start,end:r.end})),plan.cuts);
  assert.deepEqual(exported.keepRanges.map(r=>({start:r.start,end:r.end})),plan.keep.map(r=>({start:r.start,end:r.end})));
  assert.equal(exported.totalCutDurationMs,4000); assert.equal(plan.outputDurationMs,8000);
  assert.deepEqual(exported.cutRanges.at(-1).kinds,['manual','tail']);
  assert.equal(exported.edits.length,2); assert.equal(exported.automaticCuts.length,1);
  assert.deepEqual(state.cuts.map(c=>c.id),['inside','overlap']);
});

test('shorter or equal media is neither padded nor assigned an invented tail interval',()=>{
  const doc=buildDocument([cue('a','abc',2000,10000)]);
  for(const duration of [8000,10000]) {
    const out=JSON.parse(exportCutJson(doc,empty(),{sourceFile:'test.vtt',mediaDurationMs:duration}));
    assert.equal(out.durationMs,duration); assert.equal(out.mediaDurationMs,duration);
    assert.equal(out.truncateAfterMs,null); assert.equal(out.subtitleExtendsPastMediaEnd,duration<10000);
    assert.deepEqual(out.cutRanges,[]); assert.deepEqual(out.automaticCuts,[]);
    assert.deepEqual(out.keepRanges,[{start:0,end:duration,durationMs:duration}]);
  }
});

test('an explicit discard policy survives project reopen',()=>{
  const doc=buildDocument([cue('a','first',0,4000),cue('b','last',5000,10000)]);
  const state=deleteLines(doc,{...empty(),keepTail:false},[doc.lines[1].id]);
  const serialized=exportProjectJson(doc,state,{sourceFile:'test.vtt',mediaDurationMs:12000});
  const project=JSON.parse(serialized);
  assert.equal(project.truncateAfterMs,10000); assert.equal(project.trailingMediaPolicy,'discard');
  assert.equal(project.state.cuts.length,1); assert.ok(project.state.cuts.every(c=>c.kind!=='tail'));
  const reopened=importProjectJson(serialized);
  assert.deepEqual(reopened.state,state);
  assert.equal(getTranscriptTailCut(reopened.doc,reopened.mediaDurationMs).start,10000);
  delete project.truncateAfterMs; delete project.trailingMediaPolicy;
  const old=importProjectJson(JSON.stringify(project));
  assert.deepEqual(getEffectiveCuts(old.doc,old.state,old.mediaDurationMs),getEffectiveCuts(doc,state,12000));
});

test('project roundtrip preserves source/edit state and rejects unsafe or invalid references',()=>{
  const doc=buildDocument([cue('a','one two three')]);
  let state=deleteTokens(doc,empty(),tokens(doc,'two')); state=renameSpeaker(state,'話者1','田中');
  const serialized=exportProjectJson(doc,state,{sourceFile:'example.vtt'}), restored=importProjectJson(serialized);
  assert.equal(restored.sourceFile,'example.vtt'); assert.equal(visible(restored.doc,restored.state),'one  three');
  assert.deepEqual(restored.state,state);
  for(const mutation of [p=>{p.state.aliases=JSON.parse('{"__proto__":"evil"}');},p=>{p.state.cuts[0].spans[0].to=99999;},p=>{p.state.cuts[0].tokenIds=['missing'];},p=>{p.state.cuts[0].end=99999;},p=>{p.state.cuts[0].start='0';},p=>{p.state.forcedJoins=['a'];}]) {
    const value=JSON.parse(serialized); mutation(value); assert.throws(()=>importProjectJson(JSON.stringify(value)));
  }
  assert.equal({}.polluted,undefined);
});

test('real transcript: 693 cues, 189 groups, lossless tokens and project roundtrip',{skip:!process.env.VTT_TEST_FILE},()=>{
  const doc=buildDocument(parseVtt(readFileSync(process.env.VTT_TEST_FILE,'utf8')).cues), state=empty();
  assert.equal(doc.cues.length,693); assert.equal(buildGroups(doc,state).length,189);
  const out=buildEditedCues(doc,state); assert.equal(out.length,189); assert.equal(out.at(-1).end,4239916);
  assert.equal(doc.tokens.map(t=>t.text).join(''),doc.cues.map(c=>c.text).join(''));
  assert.deepEqual(importProjectJson(exportProjectJson(doc,state,{sourceFile:'transcript.vtt'})).doc.cues,JSON.parse(JSON.stringify(doc.cues)));
  assert.equal(parseVtt(serializeVtt(out)).cues.length,189);
});
