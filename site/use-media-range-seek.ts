import {useRef,type RefObject} from 'react';
import {applyRangeSeek,rangeSeekTarget} from './media-range-seek';
import {moveRangeHandle,type RangeSelection} from './recognition-range';
type Side='start'|'end';
export function useMediaRangeSeek(file:File|null,player:RefObject<HTMLVideoElement|null>,range:{value:RangeSelection;setValue:(value:RangeSelection)=>void;duration:number|null},disabled:boolean){
 const pending=useRef<{file:File;seconds:number}|null>(null);
 const last=useRef<{file:File;side:Side}|null>(null),programmed=useRef<{file:File;seconds:number}|null>(null);
 const seek=(seconds:number,side:Side)=>{if(!file)return;last.current={file,side};programmed.current={file,seconds};if(applyRangeSeek(player.current,seconds))pending.current=null;else pending.current={file,seconds};};
 const loaded=()=>{const value=pending.current;pending.current=null;if(value?.file===file)applyRangeSeek(player.current,value.seconds);};
 const preview=(seconds:number)=>{if(!file)return;programmed.current={file,seconds};applyRangeSeek(player.current,seconds);};
 const seeked=()=>{const media=player.current;if(!file||!media)return;const own=programmed.current;programmed.current=null;if(own?.file===file&&Math.abs(media.currentTime-own.seconds)<.002)return;if(disabled||last.current?.file!==file||!range.duration)return;const side=last.current.side,next=moveRangeHandle(range.value,side,media.currentTime,range.duration);range.setValue(next);const target=rangeSeekTarget(next,side,range.duration);if(target!==null&&Math.abs(target-media.currentTime)>.001)preview(target);};
 return {seek,loaded,seeked,preview};
}
