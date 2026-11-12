import {useRef,type RefObject} from 'react';
import {applyRangeSeek} from './media-range-seek';
export function useMediaRangeSeek(file:File|null,player:RefObject<HTMLVideoElement|null>){
 const pending=useRef<{file:File;seconds:number}|null>(null);
 const seek=(seconds:number)=>{if(!file)return;if(applyRangeSeek(player.current,seconds))pending.current=null;else pending.current={file,seconds};};
 const loaded=()=>{const value=pending.current;pending.current=null;if(value?.file===file)applyRangeSeek(player.current,value.seconds);};
 return {seek,loaded};
}
