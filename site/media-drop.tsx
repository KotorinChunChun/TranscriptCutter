import {useRef,useState,type ReactNode,type RefObject} from 'react';
import {isAudioOnlyFile} from './src/lib/media-file';

export function MediaDrop({disabled=false,onLoad,label='動画・音声を選択',text,children}:{disabled?:boolean;onLoad:(file:File)=>void;label?:string;text?:string;children?:ReactNode}){
 const [dragging,setDragging]=useState(false),depth=useRef(0);
 const reset=()=>{depth.current=0;setDragging(false);};
 return <div className={`file-drop-zone media-drop${children?' has-preview':''}`} role="group" tabIndex={0} aria-label={label} aria-disabled={disabled} data-dragging={!disabled&&dragging}
  onDragEnter={e=>{if(!disabled&&Array.from(e.dataTransfer.types).includes('Files')){depth.current++;setDragging(true);}}}
  onDragLeave={()=>{depth.current=Math.max(0,depth.current-1);if(!depth.current)setDragging(false);}}
  onDragOver={e=>{e.preventDefault();if(!disabled&&Array.from(e.dataTransfer.types).includes('Files')){e.dataTransfer.dropEffect='copy';setDragging(true);}}}
  onDrop={e=>{e.preventDefault();e.stopPropagation();reset();if(!disabled&&e.dataTransfer.files.length===1)onLoad(e.dataTransfer.files[0]);}}
  onPaste={e=>{if(!disabled&&e.clipboardData.files.length===1){e.preventDefault();onLoad(e.clipboardData.files[0]);}}}>
  {children||text||<span>動画（MP4・WebM）または音声（WAV・MP3・M4A・AAC・FLAC・OGG）をドロップ</span>}
 </div>;
}

export function RecognitionMediaPreview({file,url,player,onLoadedMetadata,onSeeked,onTimeUpdate,onError}:{file:File;url:string;player:RefObject<HTMLMediaElement|null>;onLoadedMetadata:()=>void;onSeeked:()=>void;onTimeUpdate:()=>void;onError:()=>void}){
 const Player=isAudioOnlyFile(file)?'audio':'video';
 return <Player className="recognition-media-preview" aria-label={Player==='audio'?'読み込んだ音声のプレビュー':'読み込んだ動画のプレビュー'} ref={element=>{player.current=element;}} controls src={url} preload="metadata" onLoadedMetadata={onLoadedMetadata} onSeeked={onSeeked} onTimeUpdate={onTimeUpdate} onError={onError}/>;
}
