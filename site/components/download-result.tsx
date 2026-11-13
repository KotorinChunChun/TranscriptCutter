"use client";
import {useEffect,useRef,useState} from "react";
import {ArrowDownToLine,Check,Copy,FileText} from "lucide-react";
import {Modal} from "@/components/editor-ui";

export type DownloadFile={name:string;body:string;type:string;blob:Blob;url:string;requested:boolean;binary?:boolean};
export function prepareDownload(name:string,body:string,type:string):DownloadFile{
  const blob=new Blob([body],{type});
  return {name:name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,"_"),body,type,blob,url:URL.createObjectURL(blob),requested:false};
}

export function prepareBinaryDownload(name:string,blob:Blob):DownloadFile{return {name:name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_'),body:'',type:blob.type,blob,url:URL.createObjectURL(blob),requested:false,binary:true};}

export function requestBrowserDownload(file:DownloadFile){
  const link=document.createElement("a");link.href=file.url;link.download=file.name;link.hidden=true;document.body.appendChild(link);
  try{link.click();file.requested=true;}finally{setTimeout(()=>link.remove(),1000);}
}

export function DownloadResult({file,onClose}:{file:DownloadFile;onClose:()=>void}){
  const [message,setMessage]=useState(""),[showText,setShowText]=useState(false),[copyState,setCopyState]=useState<""|"copied"|"manual">("");
  const textRef=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{if(copyState==="manual"&&showText){textRef.current?.focus();textRef.current?.select();}},[copyState,showText]);
  const copy=async()=>{try{await navigator.clipboard.writeText(file.body);setCopyState("copied");setMessage("");}catch{setShowText(true);setCopyState("manual");textRef.current?.focus();textRef.current?.select();setMessage("本文を選択しました。Ctrl+C（Macは⌘C）でコピーし、テキストエディターで上のファイル名・UTF-8として保存できます。");}};
  const size=file.blob.size<1024?`${file.blob.size} B`:`${(file.blob.size/1024).toFixed(1)} KB`;
  return <Modal title="ファイルを作成しました" eyebrow="DOWNLOAD YOUR FILE" wide onClose={onClose} footer={<button className="button secondary" onClick={onClose}>編集画面に戻る</button>}>
    <div className="download-file-card"><span className="file-icon"><FileText size={26}/></span><div><strong>{file.name}</strong><p>{size} · {file.binary?"ZIP":"UTF-8"}</p></div></div>
    <p className="modal-help">{file.requested?"ブラウザにダウンロードを依頼しました。保存の完了は、ブラウザのダウンロード一覧で確認してください。":"以下の方法を選んでファイルを保存してください。"}</p>
    <div className="download-actions"><a className="button primary" href={file.url} download={file.name} onClick={()=>{setMessage(file.binary?"ダウンロードを依頼しました。ブラウザーのダウンロード一覧で確認してください。":"ダウンロードを依頼しました。ファイルが見つからない場合は、本文のコピーも利用できます。");}}><ArrowDownToLine size={17}/>ダウンロード</a>{!file.binary&&<button className="button secondary" onClick={()=>void copy()}>{copyState==="copied"?<Check size={16}/>:<Copy size={16}/>}{copyState==="copied"?"全文をコピーしました":"内容をコピー"}</button>}</div>
    {message&&<p className="inline-notice" role="status">{message}</p>}
    <div className="download-help"><strong>ファイルが見つからないとき</strong><p>WindowsのEdge／Chromeでは Ctrl+J でダウンロード一覧を開けます。ダウンロードが始まらない場合は、上のダウンロードボタンで再試行してください。</p></div>
    {!file.binary&&<button className="button ghost small" aria-expanded={showText} onClick={()=>setShowText(!showText)}><FileText size={15}/>{showText?"書き出し内容を閉じる":"書き出し内容をすべて表示"}</button>}
    {showText&&<textarea ref={textRef} className="download-content" aria-label="書き出し内容の全文" readOnly spellCheck={false} value={file.body}/>}
    <p className="form-help">このファイルは作成時点の編集結果です。さらに編集した場合は、もう一度書き出してください。この画面を閉じても、直近の書き出しから保存方法を開き直せます。</p>
  </Modal>;
}
