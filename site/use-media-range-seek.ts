import {useRef,type RefObject} from 'react';
import {createMediaRangeSync} from './media-range-seek';
import type {RangeSelection} from './recognition-range';
type Side='start'|'end';
export function useMediaRangeSeek(file:File|null,player:RefObject<HTMLMediaElement|null>,range:{value:RangeSelection;setValue:(value:RangeSelection)=>void;duration:number|null},disabled:boolean){
 const sync=useRef<ReturnType<typeof createMediaRangeSync>|null>(null);sync.current??=createMediaRangeSync();
 return {
  seek:(seconds:number,side:Side)=>sync.current!.seek(file,player.current,seconds,side),
  loaded:()=>sync.current!.loaded(file,player.current),
  preview:(seconds:number)=>sync.current!.preview(file,player.current,seconds),
  seeked:()=>sync.current!.seeked(file,player.current,range,disabled),
  timeUpdate:()=>sync.current!.timeUpdate(file,player.current,range,disabled),
 };
}
