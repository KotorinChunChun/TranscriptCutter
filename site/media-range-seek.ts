import {resolveRange,type RangeSelection} from './recognition-range';
export function rangeSeekTarget(value:RangeSelection,side:'start'|'end',duration?:number|null){
 try{const range=resolveRange(value,duration),seconds=side==='start'?range.from:range.to;return typeof seconds==='number'&&Number.isFinite(seconds)?seconds:null;}catch{return null;}
}
export function applyRangeSeek(media:Pick<HTMLMediaElement,'readyState'|'duration'|'currentTime'>|null,seconds:number){
 if(!media||media.readyState<1||!Number.isFinite(seconds)||seconds<0)return false;
 try{media.currentTime=Math.max(0,Math.min(seconds,Number.isFinite(media.duration)?media.duration:seconds));return true;}catch{return false;}
}
