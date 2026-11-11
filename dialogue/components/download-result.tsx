import {useState} from 'react';
import {Modal} from './editor-ui';
import {saveText} from '../desktop';
export type DownloadFile={name:string;body:string;type:string;blob:Blob;url:string;requested:boolean};
export function prepareDownload(name:string,body:string,type:string):DownloadFile{const blob=new Blob([body],{type});return {name:name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_'),body,type,blob,url:'',requested:false};}
export function requestBrowserDownload(_file:DownloadFile){}
export function DownloadResult({file,onClose}:{file:DownloadFile;onClose:()=>void}){
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 return <Modal title="保存" onClose={onClose}><p>{file.name}</p><button className="button primary" disabled={busy} onClick={async()=>{setBusy(true);try{const path=await saveText(file.name,file.body);setMessage(path?`保存しました: ${path}`:'保存をキャンセルしました。');}catch(e){setMessage(String(e));}finally{setBusy(false);}}}>保存先を選んで保存</button><p role="status" className="desktop-output">{message}</p></Modal>;
}
