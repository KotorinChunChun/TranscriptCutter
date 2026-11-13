import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreNavigation,saveNavigation,speechSessionClientId} from '../workspace-storage.ts';
import {SpeechClient} from '../speech-client.ts';

test('reload restores each stage and the editor VTT subtab; hidden comparison cannot steal stage one',()=>{
 const original=globalThis.localStorage,values=new Map();
 globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 try{
  assert.deepEqual(restoreNavigation(),{stage:1,view:'chat'});
  for(const [stage,view,expected] of [[1,'compare','chat'],[2,'chat','compare'],[3,'vtt','vtt'],[3,'chat','chat']]){
   saveNavigation(stage,view);assert.deepEqual(restoreNavigation(),{stage,view:expected});
  }
  values.set('tc-workspace-navigation','{broken');assert.deepEqual(restoreNavigation(),{stage:1,view:'chat'});
  values.set('tc-workspace-navigation',JSON.stringify({stage:9,view:'unknown'}));assert.deepEqual(restoreNavigation(),{stage:1,view:'chat'});
 }finally{globalThis.localStorage=original;}
});

test('browser-session client ID survives reload without storing a server credential',async()=>{
 const originalStorage=globalThis.sessionStorage,originalFetch=globalThis.fetch,values=new Map(),headers=[];
 globalThis.sessionStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 globalThis.fetch=async(_url,options)=>{headers.push(options.headers);return new Response(JSON.stringify({url:'http://127.0.0.1:9999/'}),{status:200});};
 try{
  const before=speechSessionClientId(),after=speechSessionClientId();
  assert.match(before,/^[a-f0-9-]{36}$/);assert.equal(after,before);
  await new SpeechClient(before).connectionSettings();await new SpeechClient(after).connectionSettings();
  assert.equal(headers[0]['X-TC-Client'],headers[1]['X-TC-Client']);
  assert.deepEqual([...values.keys()],['tc-speech-client']);
  values.set('tc-speech-client','not-a-valid-id');assert.notEqual(speechSessionClientId(),'not-a-valid-id');
 }finally{globalThis.sessionStorage=originalStorage;globalThis.fetch=originalFetch;}
});

test('unavailable browser preference storage does not prevent opening the app',()=>{
 const originalLocal=globalThis.localStorage,originalSession=globalThis.sessionStorage;
 const unavailable={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
 globalThis.localStorage=unavailable;globalThis.sessionStorage=unavailable;
 try{assert.deepEqual(restoreNavigation(),{stage:1,view:'chat'});assert.doesNotThrow(()=>saveNavigation(3,'chat'));assert.match(speechSessionClientId(),/^[a-f0-9-]{36}$/);}
 finally{globalThis.localStorage=originalLocal;globalThis.sessionStorage=originalSession;}
});
