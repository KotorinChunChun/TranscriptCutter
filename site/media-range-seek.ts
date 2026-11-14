import {resolveRange,moveRangeHandle,type RangeSelection} from './recognition-range';
export function rangeSeekTarget(value:RangeSelection,side:'start'|'end',duration?:number|null){
 try{const range=resolveRange(value,duration),seconds=side==='start'?range.from:range.to;return typeof seconds==='number'&&Number.isFinite(seconds)?seconds:null;}catch{return null;}
}
export function applyRangeSeek(media:Pick<HTMLMediaElement,'readyState'|'duration'|'currentTime'>|null,seconds:number){
 if(!media||media.readyState<1||!Number.isFinite(seconds)||seconds<0)return false;
 try{media.currentTime=Math.max(0,Math.min(seconds,Number.isFinite(media.duration)?media.duration:seconds));return true;}catch{return false;}
}

type Side='start'|'end';
type PreviewMedia=Pick<HTMLMediaElement,'readyState'|'duration'|'currentTime'|'seeking'>;
type EditableRange={value:RangeSelection;setValue:(value:RangeSelection)=>void;duration:number|null};
/** Keeps playback following the last edited handle without feeding programmed seeks back. */
export function createMediaRangeSync(){
 let pending:{file:File;seconds:number}|null=null,last:{file:File;side:Side}|null=null,programmed:{file:File}|null=null,following=false;
 const program=(file:File,media:PreviewMedia|null,seconds:number)=>{
  if(media&&media.readyState>=1&&Math.abs(media.currentTime-seconds)<.0005){pending=null;programmed=null;return;}
  programmed={file};
  if(applyRangeSeek(media,seconds))pending=null;else pending={file,seconds};
 };
 const update=(file:File|null,media:PreviewMedia|null,range:EditableRange,disabled:boolean,clampSeek:boolean)=>{
  if(!file||!media||disabled||last?.file!==file||!range.duration||!Number.isFinite(media.currentTime))return;
  const next=moveRangeHandle(range.value,last.side,media.currentTime,range.duration);
  if(Object.keys(next).some(key=>next[key as keyof RangeSelection]!==range.value[key as keyof RangeSelection]))range.setValue(next);
  // Manual seeks retain the existing clamp preview. Playback can pass a fixed boundary
  // naturally while its edited handle stays clamped; it must never jump backwards.
  if(clampSeek){const target=rangeSeekTarget(next,last.side,range.duration);if(target!==null&&Math.abs(target-media.currentTime)>.001)program(file,media,target);}
 };
 return {
  seek(file:File|null,media:PreviewMedia|null,seconds:number,side:Side){if(!file)return;last={file,side};following=true;program(file,media,seconds);},
  loaded(file:File|null,media:PreviewMedia|null){const value=pending;pending=null;if(value?.file===file&&file)program(file,media,value.seconds);},
  preview(file:File|null,media:PreviewMedia|null,seconds:number){if(!file)return;following=false;program(file,media,seconds);},
  seeked(file:File|null,media:PreviewMedia|null,range:EditableRange,disabled:boolean){const own=programmed;programmed=null;if(own?.file===file)return;following=true;update(file,media,range,disabled,true);},
  timeUpdate(file:File|null,media:PreviewMedia|null,range:EditableRange,disabled:boolean){if(!following||media?.seeking||programmed?.file===file)return;update(file,media,range,disabled,false);},
 };
}
