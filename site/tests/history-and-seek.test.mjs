import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialRange,moveRangeHandle} from '../recognition-range.ts';
import {rangeSeekTarget,applyRangeSeek} from '../media-range-seek.ts';
import {deletableHistory,historyPageInfo} from '../recognition-history-state.ts';
import {SpeechClient} from '../speech-client.ts';
test('seek follows only the operated endpoint, even when the opposite endpoint is relative',()=>{
 const value=moveRangeHandle({...initialRange(900),endMode:'after60'},'start',90.125,900);
 assert.equal(rangeSeekTarget(value,'start',900),90.125);assert.equal(rangeSeekTarget(value,'end',900),150.125);
 const reversed=moveRangeHandle({...initialRange(900),startMode:'before60'},'end',240.125,900);
 assert.equal(rangeSeekTarget(reversed,'end',900),240.125);assert.equal(rangeSeekTarget(reversed,'start',900),180.125);
 assert.equal(rangeSeekTarget({...value,start:'invalid'},'start',900),null);
});
test('media seek waits for metadata, clamps the tail and never starts playback',()=>{
 const media={readyState:0,duration:10.125,currentTime:3};assert.equal(applyRangeSeek(media,7),false);assert.equal(media.currentTime,3);
 media.readyState=1;assert.equal(applyRangeSeek(media,7.777),true);assert.equal(media.currentTime,7.777);
 applyRangeSeek(media,11);assert.equal(media.currentTime,10.125);assert.equal(applyRangeSeek(media,NaN),false);
});
test('deletion requires capability, a terminal TC file job and a full identifier',()=>{
 const job={id:'a'.repeat(32),status:'complete',clientId:'transcript-cutter',workload:'file'};
 assert.equal(deletableHistory(job,true),true);assert.equal(deletableHistory(job,false),false);
 for(const patch of [{status:'running'},{status:'queued'},{status:'uploading'},{status:'unknown'},{clientId:'other-app'},{workload:'realtime'},{id:'../other'}])assert.equal(deletableHistory({...job,...patch},true),false);
});
test('history pages retain server totals and reject malformed rows',()=>{
 const jobs=[{id:'a'.repeat(32),status:'complete'}];assert.deepEqual(historyPageInfo({jobs,total:51,nextOffset:50},0),{jobs,total:51,hasNext:true});assert.equal(historyPageInfo({jobs,total:51,nextOffset:null},1).hasNext,false);assert.throws(()=>historyPageInfo({jobs:[null]},0));
});
test('delete client sends one explicit mutation with TC scope and rejects an unrelated response',async()=>{
 const client=new SpeechClient(),calls=[];client.request=async(...args)=>{calls.push(args);return {deleted:true,id:'a'.repeat(32)};};
 await client.deleteJob('a'.repeat(32));assert.deepEqual(calls,[[`/api/jobs/${'a'.repeat(32)}/delete`,{confirm:'delete-job',clientId:'transcript-cutter'}]]);
 await assert.rejects(client.deleteJob('not-an-id'));assert.equal(calls.length,1);
 client.request=async()=>({deleted:true,id:'b'.repeat(32)});await assert.rejects(client.deleteJob('a'.repeat(32)),/確認できません/);
});
