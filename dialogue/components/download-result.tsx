"use client";
import {useEffect,useRef,useState} from "react";
import {ArrowDownToLine,Check,Copy,FileText,FolderOpen} from "lucide-react";
import {Modal} from "@/components/editor-ui";

export type DownloadFile={name:string;body:string;type:string;blob:Blob;url:string;requested:boolean};
type SaveHandle={name?:string;createWritable:()=>Promise<{write:(data:Blob)=>Promise<void>;close:()=>Promise<void>;abort?:()=>Promise<void>}>};
type SavePicker=(options:{suggestedName:string;types:{description:string;accept:Record<string,string[]>}[]})=>Promise<SaveHandle>;
type SaveWindow=Window&{showSaveFilePicker?:SavePicker};

export function prepareDownload(name:string,body:string,type:string):DownloadFile{
  const blob=new Blob([body],{type});
  return {name:name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,"_"),body,type,blob,url:URL.createObjectURL(blob),requested:false};
}

export function requestBrowserDownload(file:DownloadFile){
  const link=document.createElement("a");link.href=file.url;link.download=file.name;link.hidden=true;document.body.appendChild(link);
  try{link.click();file.requested=true;}finally{setTimeout(()=>link.remove(),1000);}
}

export function DownloadResult({file,onClose}:{file:DownloadFile;onClose:()=>void}){
  const [canChoose,setCanChoose]=useState(false),[saving,setSaving]=useState(false),[savedName,setSavedName]=useState("");
  const [message,setMessage]=useState(""),[showText,setShowText]=useState(false),[copyState,setCopyState]=useState<""|"copied"|"manual">("");
  const textRef=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>setCanChoose(typeof (window as SaveWindow).showSaveFilePicker==="function"&&window.isSecureContext),[]);
  useEffect(()=>{if(copyState==="manual"&&showText){textRef.current?.focus();textRef.current?.select();}},[copyState,showText]);
  const saveAs=async()=>{
    const picker=(window as SaveWindow).showSaveFilePicker;if(!picker)return;
    setSaving(true);setMessage("");let picked=false;
    try{
      // Open the picker in this user gesture, before any asynchronous preparation.
      const extension="."+file.name.split(".").at(-1);
      const handle=await picker.call(window,{suggestedName:file.name,types:[{description:"書き出したファイル",accept:{[file.type.split(";")[0]]:[extension]}}]});
      picked=true;const writable=await handle.createWritable();
      try{await writable.write(file.blob);await writable.close();}catch(error){try{await writable.abort?.();}catch{}throw error;}
      setSavedName(handle.name??file.name);
    }catch(error){
      if(!picked&&error instanceof DOMException&&error.name==="AbortError")setMessage("保存をキャンセルしました。作成したファイルはこの画面に残っています。");
      else setMessage("ファイルを保存できませんでした。「ダウンロード」または「内容をコピー」をお使いください。");
    }finally{setSaving(false);}
  };
  const copy=async()=>{try{await navigator.clipboard.writeText(file.body);setCopyState("copied");setMessage("");}catch{setShowText(true);setCopyState("manual");textRef.current?.focus();textRef.current?.select();setMessage("本文を選択しました。Ctrl+C（Macは⌘C）でコピーし、テキストエディターで上のファイル名・UTF-8として保存できます。");}};
  const size=file.blob.size<1024?`${file.blob.size} B`:`${(file.blob.size/1024).toFixed(1)} KB`;
  return <Modal title="ファイルを作成しました" eyebrow="DOWNLOAD YOUR FILE" wide onClose={onClose} footer={<button className="button secondary" onClick={onClose}>編集画面に戻る</button>}>
    <div className="download-file-card"><span className="file-icon"><FileText size={26}/></span><div><strong>{file.name}</strong><p>{size} · UTF-8</p></div></div>
    <p className="modal-help">{file.requested?"ブラウザにダウンロードを依頼しました。保存の完了は、ブラウザのダウンロード一覧で確認してください。":"以下の方法を選んでファイルを保存してください。"}</p>
    <div className="download-actions"><a className="button primary" href={file.url} download={file.name} onClick={()=>{setMessage("ダウンロードを依頼しました。ファイルが見つからない場合は、保存先の指定や本文のコピーも利用できます。");}}><ArrowDownToLine size={17}/>ダウンロード</a>{canChoose&&<button className="button secondary" disabled={saving} onClick={()=>void saveAs()}><FolderOpen size={17}/>{saving?"保存中…":"保存先を選んで保存"}</button>}<button className="button secondary" onClick={()=>void copy()}>{copyState==="copied"?<Check size={16}/>:<Copy size={16}/>}{copyState==="copied"?"全文をコピーしました":"内容をコピー"}</button></div>
    {savedName&&<p className="download-saved" role="status"><Check size={17}/>「{savedName}」を選択した保存先に保存しました。</p>}
    {message&&<p className="inline-notice" role="status">{message}</p>}
    <div className="download-help"><strong>ファイルが見つからないとき</strong><p>WindowsのEdge／Chromeでは Ctrl+J でダウンロード一覧を開けます。ダウンロードが始まらない場合は、上のボタンで再試行するか、保存先の指定・本文のコピーをお使いください。</p></div>
    <button className="button ghost small" aria-expanded={showText} onClick={()=>setShowText(!showText)}><FileText size={15}/>{showText?"書き出し内容を閉じる":"書き出し内容をすべて表示"}</button>
    {showText&&<textarea ref={textRef} className="download-content" aria-label="書き出し内容の全文" readOnly spellCheck={false} value={file.body}/>}
    <p className="form-help">このファイルは作成時点の編集結果です。さらに編集した場合は、もう一度書き出してください。この画面を閉じても、直近の書き出しから保存方法を開き直せます。</p>
  </Modal>;
}
