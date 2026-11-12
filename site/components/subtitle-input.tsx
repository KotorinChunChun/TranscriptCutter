import {useState} from 'react';
import {Upload} from 'lucide-react';
export function SubtitleInput({disabled,open,onOpen,onClose,onFiles}:{disabled:boolean;open:boolean;onOpen:()=>void;onClose:()=>void;onFiles:(files:File[])=>void}){
 const [text,setText]=useState('');
 const read=()=>{if(disabled||!text.trim())return;onFiles([new File([text],'貼付字幕.vtt',{type:'text/vtt'})]);setText('');onClose();};
 return <><div className="sidebar-upload" role="group" aria-label="字幕ファイルのドロップ領域" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();e.stopPropagation();if(!disabled)onFiles(Array.from(e.dataTransfer.files));}}><span className="upload-icon"><Upload size={21}/></span><span className="sidebar-upload-title">VTT・プロジェクトをドロップ</span><button className="button ghost small" disabled={disabled} aria-expanded={open} onClick={onOpen}>VTTを貼り付け</button></div>{open&&<div className="subtitle-paste"><textarea aria-label="VTTを貼り付け" disabled={disabled} value={text} onChange={e=>setText(e.target.value)} placeholder="WEBVTT"/><button className="button primary" disabled={disabled||!text.trim()} onClick={read}>貼付VTTを読み込む</button><button className="button ghost" onClick={onClose}>閉じる</button></div>}</>;
}
