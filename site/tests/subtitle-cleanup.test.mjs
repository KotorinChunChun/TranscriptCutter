import test from 'node:test';import assert from 'node:assert/strict';
import {replaceTerms,correctionPair,validateRules} from '../src/lib/terminology.ts';
import {cleanByRules} from '../src/lib/subtitle-cleanup.ts';
import {createComparisonSession,putGeneratedSource,exportComparisonJson,importComparisonJson,getSelectedCues} from '../src/lib/comparison.ts';
const rule=(from,to,extra={})=>({id:from,from,to,reading:'',nearKana:false,logic:true,ai:true,enabled:true,note:'',...extra});
const cue=(text,id='c')=>({id,start:1000,end:5000,text,speaker:'話者1',sourceIds:[id],sourceCount:1});
const source=(id,text,generated=false)=>({id,name:id,fileName:id+'.vtt',cues:[cue(text)],warnings:[],...(generated?{generated:true}:{})});
test('literal correction uses the longest match once, without cascades or ASCII interior matches',()=>{
 assert.equal(replaceTerms('資本台帳 AI OpenAI',[rule('資本','資産'),rule('資本台帳','資産台帳'),rule('資産','別物'),rule('AI','人工知能')]).text,'資産台帳 人工知能 OpenAI');
 assert.equal(replaceTerms('資本',[rule('資本','資産',{enabled:false})]).text,'資本');
});
test('similar kana replacement requires opt in and leaves tied alternatives unchanged',()=>{
 assert.equal(replaceTerms('コパイロッド',[rule('コパイロト','Copilot',{reading:'コパイロット',nearKana:true})]).text,'Copilot');
 assert.equal(replaceTerms('コパイロッド',[rule('コパイロト','Copilot',{reading:'コパイロット'})]).text,'コパイロッド');
 assert.equal(replaceTerms('コパイロッド',[rule('一','A',{reading:'コパイロット',nearKana:true}),rule('二','B',{reading:'コパイロット',nearKana:true})]).text,'コパイロッド');
});
test('manual learning captures a word and rejects filler deletion and large rewrites',()=>{
 assert.deepEqual(correctionPair('情報資本を確認する。','情報資産を確認する。'),{from:'資本',to:'資産'});
 assert.equal(correctionPair('えっと、確認する。','確認する。'),null);
 assert.equal(correctionPair('a'.repeat(90),'b'.repeat(90)),null);
 assert.throws(()=>validateRules([rule('同じ','同じ')]));
});
test('rule cleanup removes filler text, preserves timestamps/speakers and does not mutate input',()=>{
 const input=[cue('えっと、資本を確認します。')],before=JSON.stringify(input);
 const result=cleanByRules(input,[rule('資本','資産')],['えっと']);assert.equal(result.cues[0].text,'資産を確認します。');assert.equal(result.cues[0].start,1000);assert.equal(result.cues[0].end,5000);assert.equal(result.cues[0].speaker,'話者1');assert.equal(JSON.stringify(input),before);
});
test('three originals plus one generated result round trip and regeneration keeps original adoption',()=>{
 let session=createComparisonSession([source('a','元A'),source('b','元B'),source('c','元C')]);
 session=putGeneratedSource(session,source('clean1','整理1',true));assert.equal(session.sources.length,4);assert.equal(getSelectedCues(session)[0].text,'元A');
 const restored=importComparisonJson(exportComparisonJson(session));session=putGeneratedSource(restored,source('clean2','整理2',true));assert.equal(session.sources.length,4);assert.ok(!session.sources.some(s=>s.id==='clean1'));assert.equal(getSelectedCues(session)[0].text,'元A');
 assert.throws(()=>createComparisonSession([source('a','a'),source('b','b'),source('c','c'),source('d','d')]));
 assert.throws(()=>createComparisonSession([source('a','a',true),source('b','b',true)]));
});
