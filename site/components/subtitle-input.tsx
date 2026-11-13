import {useEffect,useRef} from 'react';
import {Upload} from 'lucide-react';
import {Modal} from './editor-ui';
export function SubtitleInput({disabled,onFiles}:{disabled:boolean;onFiles:(files:File[])=>void}){
 return <div className="sidebar-upload" role="group" aria-label="字幕ファイルのドロップ領域" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();e.stopPropagation();if(!disabled)onFiles(Array.from(e.dataTransfer.files));}}><span className="upload-icon"><Upload size={21}/></span><span className="sidebar-upload-title">VTT・プロジェクトをドロップ</span></div>;
}
export function VttPasteDialog({disabled,value,onChange,onClose,onFiles}:{disabled:boolean;value:string;onChange:(text:string)=>void;onClose:()=>void;onFiles:(files:File[])=>void}){
 const input=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{input.current?.focus();},[]);
 const read=()=>{if(disabled||!value.trim())return;onFiles([new File([value],'貼付字幕.vtt',{type:'text/vtt'})]);onChange('');onClose();};
 return <Modal title="VTTを貼り付け" onClose={onClose} footer={<><button className="button secondary" onClick={onClose}>閉じる</button><button className="button primary" disabled={disabled||!value.trim()} onClick={read}>読み込む</button></>}><textarea ref={input} className="vtt-paste-input" aria-label="VTTの本文" value={value} onChange={event=>onChange(event.target.value)} disabled={disabled} placeholder="WEBVTT"/></Modal>;
}
