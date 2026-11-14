import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMutes,subtractMutes,mutePcm} from '../src/lib/audio-mute.ts';
import {buildDocument,createEditorState,exportProjectJson,importProjectJson,buildEditedCues} from '../src/lib/editor.ts';
import {createTranscriptPlaybackController} from '../src/lib/transcript-playback.ts';

test('mute union and partial removal retain half-open source ranges',()=>{
 const ranges=normalizeMutes([{start:10,end:30},{start:20,end:40},{start:40,end:50}]);
 assert.deepEqual(ranges,[{start:10,end:50}]);
 assert.deepEqual(subtractMutes(ranges,[{start:25,end:35}]),[{start:10,end:25},{start:35,end:50}]);
 assert.throws(()=>normalizeMutes([{start:0,end:0}]));
});
test('PCM mute touches both channels at the exact source frames without changing length',()=>{
 const pcm=new Float32Array(20).fill(.5);mutePcm(pcm,1000,1000,2,[{start:1002,end:1005}]);
 assert.equal(pcm.length,20);assert.deepEqual([...pcm],Array.from({length:20},(_,i)=>i>=4&&i<10?0:.5));
 // A remaining segment can have a new output timestamp; muting still uses the original 1000ms.
 const other=new Float32Array(10).fill(.2);mutePcm(other,2000,1000,1,[{start:1002,end:1005}]);assert.ok(other.every(v=>v>0));
});
test('project round trip keeps mutes separately from cuts and leaves subtitle text and duration intact',()=>{
 const cue={id:'a',start:0,end:5000,text:'元の字幕',speaker:'話者1',sourceIds:['a'],sourceCount:1};
 const doc=buildDocument([cue]),state={...createEditorState(),mutes:[{start:1000,end:2000}]};
 const saved=importProjectJson(exportProjectJson(doc,state,{sourceFile:'a.vtt',mediaDurationMs:6000}));
 assert.deepEqual(saved.state.mutes,state.mutes);assert.equal(saved.state.cuts.length,0);
 assert.deepEqual(buildEditedCues(doc,state,{merge:false}),buildEditedCues(doc,createEditorState(),{merge:false}));
 const invalid=JSON.parse(exportProjectJson(doc,state,{sourceFile:'a.vtt',mediaDurationMs:6000}));invalid.state.mutes=[{start:0,end:7000}];
 assert.throws(()=>importProjectJson(JSON.stringify(invalid)));
});
class Media extends EventTarget{currentTime=0;duration=6;readyState=4;paused=true;ended=false;muted=false;playbackRate=1;defaultPlaybackRate=1;play(){this.paused=false;this.dispatchEvent(new Event('play'));return Promise.resolve();}pause(){this.paused=true;}}
const scheduler={now:()=>0,requestFrame:()=>1,cancelFrame:()=>{},setTimer:()=>1,clearTimer:()=>{}};
test('preview mutes on seek, restores outside the range and preserves the user mute setting',()=>{
 const media=new Media(),controller=createTranscriptPlaybackController(media,{cuts:[],subtitleEndMs:6000,mediaDurationMs:6000,mutes:[{start:1000,end:2000}]},{onChange:()=>{}},scheduler);
 media.currentTime=1;media.dispatchEvent(new Event('seeked'));assert.equal(media.muted,true);
 media.currentTime=2;media.dispatchEvent(new Event('seeked'));assert.equal(media.muted,false);
 media.muted=true;media.currentTime=3;media.dispatchEvent(new Event('seeked'));assert.equal(media.muted,true);
 controller.destroy();assert.equal(media.muted,true);
});
test('preview applies source mute after a cut skips to a remaining interval',()=>{
 const media=new Media(),controller=createTranscriptPlaybackController(media,{cuts:[{start:1000,end:3000}],subtitleEndMs:6000,mediaDurationMs:6000,mutes:[{start:2500,end:3500}]},{onChange:()=>{}},scheduler);
 controller.playFrom(2000,'edited');assert.equal(media.currentTime,3);assert.equal(media.muted,true);
 controller.destroy();assert.equal(media.muted,false);
});
