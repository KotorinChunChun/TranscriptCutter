import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recognitionSetup,managementUrl} from '../recognition-setup.ts';
const ready={connected:true,ready:true,modelSelected:true,methodSelected:true,hasFile:true,busy:false};
test('recognition preparation follows connection, model readiness, media and start',()=>{
 const disconnected=recognitionSetup({...ready,connected:false});assert.equal(disconnected.suggested,1);assert.equal(disconnected.allowed[2],false);assert.equal(disconnected.canStart,false);
 for(const change of [{ready:false},{modelSelected:false},{methodSelected:false}]){const state=recognitionSetup({...ready,...change});assert.equal(state.suggested,2);assert.equal(state.allowed[3],false);assert.equal(state.canStart,false);}
 const media=recognitionSetup({...ready,hasFile:false});assert.equal(media.suggested,3);assert.equal(media.allowed[3],true);assert.equal(media.allowed[4],false);
 assert.equal(recognitionSetup(ready).canStart,true);assert.equal(recognitionSetup({...ready,busy:true}).canStart,false);
 assert.equal(recognitionSetup({...ready,ready:undefined}).canStart,true);
});
test('management link stays on the verified HTTP origin and never copies credentials or paths',()=>{
 assert.equal(managementUrl('http://192.168.49.105:8769/transcribe?job=1'),'http://192.168.49.105:8769/');assert.equal(managementUrl('https://server.example:8443/api'),'https://server.example:8443/');
 for(const input of ['invalid','javascript:alert(1)','file:///C:/data','http://user:key@server/'])assert.equal(managementUrl(input),null);
});
