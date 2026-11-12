import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialRange,resolveRange,rangeRequest,changeRangeMode,moveRangeHandle} from '../recognition-range.ts';
test('custom end defaults to the full media duration without losing a submillisecond tail',()=>{
 const duration=4249.123456,value=initialRange(duration);assert.equal(value.end,'01:10:49.124');
 assert.deepEqual(rangeRequest(value,duration),{from:0,to:undefined});
 assert.deepEqual(rangeRequest(changeRangeMode(value,'end','custom',duration),duration),{from:0,to:duration});
});
test('relative ends follow the start by one/five minutes and stop at the actual media end',()=>{
 const value={...initialRange(900),startMode:'custom',start:'00:01:00.125',endMode:'after60'};
 assert.deepEqual(resolveRange(value,900),{from:60.125,to:120.125});
 assert.deepEqual(resolveRange({...value,endMode:'after300'},900),{from:60.125,to:360.125});
 assert.deepEqual(resolveRange({...value,start:'00:14:00.000',endMode:'after300'},900),{from:840,to:900});
});
test('relative starts follow the end and preserve exact edge omission in API requests',()=>{
 const value={...initialRange(900.123456),startMode:'before60'};
 assert.deepEqual(resolveRange(value,900.123456),{from:840.123456,to:900.123456});
 assert.deepEqual(rangeRequest(value,900.123456),{from:840.123456,to:undefined});
 assert.deepEqual(resolveRange({...value,startMode:'before300',endMode:'custom',end:'00:02:00.000'},900.123456),{from:0,to:120});
});
test('circular relative modes cannot be selected or submitted programmatically',()=>{
 const value={...initialRange(900),startMode:'before60'};
 assert.throws(()=>changeRangeMode(value,'end','after300',900),/同時/);
 assert.throws(()=>resolveRange({...value,endMode:'after60'},900),/同時/);
});
test('sliders write custom times and the opposite relative endpoint follows',()=>{
 let value={...initialRange(900),endMode:'after60'};
 value=moveRangeHandle(value,'start',90.125,900);assert.equal(value.start,'00:01:30.125');assert.equal(value.startMode,'custom');assert.equal(value.endMode,'after60');assert.deepEqual(resolveRange(value,900),{from:90.125,to:150.125});
 value=moveRangeHandle({...initialRange(900),startMode:'before60'},'end',240.125,900);assert.equal(value.end,'00:04:00.125');assert.deepEqual(resolveRange(value,900),{from:180.125,to:240.125});
});
test('sliders cannot cross, and touching a media edge restores edge semantics',()=>{
 const value={...initialRange(900.123456),endMode:'custom',end:'00:00:10.000'};
 const moved=moveRangeHandle(value,'start',20,900.123456);assert.equal(moved.start,'00:00:09.999');
 const edge=moveRangeHandle(value,'end',900.123456,900.123456);assert.equal(edge.endMode,'edge');assert.equal(rangeRequest(edge,900.123456).to,undefined);
 assert.equal(moveRangeHandle(moved,'start',0,900.123456).startMode,'edge');
});
test('bad text and out-of-media custom bounds never become a valid request',()=>{
 assert.throws(()=>rangeRequest({...initialRange(10),startMode:'custom',start:'bad'},10));
 assert.throws(()=>rangeRequest({...initialRange(10),endMode:'custom',end:'00:00:20.000'},10));
 assert.throws(()=>rangeRequest({...initialRange(10),startMode:'custom',start:'00:00:10.000'},10));
 assert.deepEqual(resolveRange({...initialRange(600.0001),endMode:'custom',startMode:'before60'},600.0001),{from:540.0001,to:600.0001});
});
