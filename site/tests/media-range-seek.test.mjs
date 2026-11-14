import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMediaRangeSync} from '../media-range-seek.ts';
import {initialRange,resolveRange} from '../recognition-range.ts';

const file=new File(['fixture'],'fixture.wav');
function fixture(){
 const media={readyState:1,duration:100,currentTime:0,seeking:false};
 const range={value:initialRange(100),duration:100,setValue(value){this.value=value;}};
 return {sync:createMediaRangeSync(),media,range};
}
test('playback updates the last edited side and retains edge modes at the media endpoints',()=>{
 const {sync,media,range}=fixture();
 sync.seek(file,media,0,'start');media.currentTime=4.125;sync.timeUpdate(file,media,range,false);
 assert.equal(resolveRange(range.value,100).from,4.125);assert.equal(range.value.startMode,'custom');
 media.currentTime=0;sync.timeUpdate(file,media,range,false);assert.equal(range.value.startMode,'edge');
 sync.seek(file,media,100,'end');sync.seeked(file,media,range,false);
 media.currentTime=80;sync.timeUpdate(file,media,range,false);assert.equal(resolveRange(range.value,100).to,80);
 media.currentTime=100;sync.timeUpdate(file,media,range,false);assert.equal(range.value.endMode,'edge');
});
test('programmed seek events are ignored until completion, then playback follows without rewinding at clamps',()=>{
 const {sync,media,range}=fixture();range.value={startMode:'custom',start:'00:00:04.000',endMode:'custom',end:'00:00:06.000'};
 sync.seek(file,media,4,'start');media.currentTime=4.1;sync.timeUpdate(file,media,range,false);
 assert.equal(resolveRange(range.value,100).from,4);
 sync.seeked(file,media,range,false);assert.equal(resolveRange(range.value,100).from,4);
 media.currentTime=5;sync.timeUpdate(file,media,range,false);assert.equal(resolveRange(range.value,100).from,5);
 media.currentTime=8;sync.timeUpdate(file,media,range,false);assert.equal(resolveRange(range.value,100).from,5.999);assert.equal(media.currentTime,8);
});
test('disabled, unselected, seeking or different-file updates leave the range untouched',()=>{
 const {sync,media,range}=fixture();const original=range.value;
 media.currentTime=8;sync.timeUpdate(file,media,range,false);assert.equal(range.value,original);
 sync.seek(file,media,8,'start');
 media.currentTime=9;sync.timeUpdate(file,media,range,true);assert.equal(range.value,original);
 media.seeking=true;sync.timeUpdate(file,media,range,false);assert.equal(range.value,original);
 media.seeking=false;sync.timeUpdate(new File(['other'],'other.wav'),media,range,false);assert.equal(range.value,original);
});
test('subtitle preview does not edit the range on seek or subsequent playback; a manual media seek resumes following',()=>{
 const {sync,media,range}=fixture();sync.seek(file,media,0,'start');
 sync.preview(file,media,20);sync.timeUpdate(file,media,range,false);sync.seeked(file,media,range,false);
 media.currentTime=21;sync.timeUpdate(file,media,range,false);assert.equal(resolveRange(range.value,100).from,0);
 media.currentTime=22;sync.seeked(file,media,range,false);assert.equal(resolveRange(range.value,100).from,22);
 media.currentTime=23;sync.timeUpdate(file,media,range,false);assert.equal(resolveRange(range.value,100).from,23);
});
test('manual seek preserves existing opposite-boundary clamp preview',()=>{
 const {sync,media,range}=fixture();range.value={startMode:'custom',start:'00:00:04.000',endMode:'custom',end:'00:00:06.000'};
 sync.seek(file,media,6,'end');sync.seeked(file,media,range,false);
 media.currentTime=2;sync.seeked(file,media,range,false);
 const end=resolveRange(range.value,100).to;assert.ok(end>4&&end<=4.003);assert.equal(media.currentTime,end);
 sync.seeked(file,media,range,false);media.currentTime=5;sync.timeUpdate(file,media,range,false);
 assert.equal(resolveRange(range.value,100).to,5);
});
test('metadata-delayed range seek resumes tracking, while a no-op preview remains read-only',()=>{
 const {sync,media,range}=fixture();media.readyState=0;sync.seek(file,media,10,'start');assert.equal(media.currentTime,0);
 media.readyState=1;sync.loaded(file,media);assert.equal(media.currentTime,10);sync.seeked(file,media,range,false);
 media.currentTime=11;sync.timeUpdate(file,media,range,false);assert.equal(resolveRange(range.value,100).from,11);
 sync.preview(file,media,11);media.currentTime=12;sync.timeUpdate(file,media,range,false);assert.equal(resolveRange(range.value,100).from,11);
});
