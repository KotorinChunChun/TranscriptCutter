"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Play, RotateCcw, X } from "lucide-react";
import { formatTime, parseTimestamp } from "@/src/lib/vtt";
import type { CutRecord } from "@/src/lib/editor";

export const PRECISION_LABEL: Record<string, string> = { word: "単語時刻の候補", cue: "字幕の時刻", estimated: "推定時刻", audio: "音量から検出", gap: "無音未確認", manual: "手動指定" };
export const KIND_LABEL: Record<string, string> = { word: "単語", selection: "選択範囲", line: "行", filler: "フィラー", silence: "無音", gap: "字幕の空白", manual: "範囲指定", tail: "VTT終了後" };

export function Modal({title,eyebrow,children,footer,onClose,wide=false}:{title:string;eyebrow?:string;children:ReactNode;footer?:ReactNode;onClose:()=>void;wide?:boolean}) {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const focus=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow="hidden";ref.current?.focus();return()=>{document.body.style.overflow=overflow;focus?.focus();};},[]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)onClose();}}><div className={`modal${wide?" wide":""}`} role="dialog" aria-modal="true" aria-labelledby="dialog-heading" ref={ref} tabIndex={-1} onKeyDown={e=>{
    if(e.key==="Escape"){e.preventDefault();e.stopPropagation();onClose();}
    if((e.ctrlKey||e.metaKey)&&["k","z","s"].includes(e.key.toLowerCase()))e.stopPropagation();
    if(e.key==="Tab"){const items=[...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea,a[href],[tabindex="0"]')??[])];const first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===ref.current)){e.preventDefault();first?.focus();}}
  }}><div className="modal-header"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h2 className="modal-title" id="dialog-heading">{title}</h2></div><button className="icon-button" aria-label="閉じる" onClick={onClose}><X size={20}/></button></div><div className="modal-body">{children}</div>{footer&&<div className="modal-footer">{footer}</div>}</div></div>;
}

export function Highlight({text,query}:{text:string;query:string}) {
  const needle=query.trim().toLowerCase();if(!needle)return <>{text}</>;
  const lower=text.toLowerCase();const parts:ReactNode[]=[];let from=0,at=lower.indexOf(needle);
  while(at>=0){parts.push(text.slice(from,at));parts.push(<mark key={at}>{text.slice(at,at+needle.length)}</mark>);from=at+needle.length;at=lower.indexOf(needle,from);}parts.push(text.slice(from));return <>{parts}</>;
}

export function CutRow({cut,onUpdate,onRestore,onSeek,canPlay}:{cut:CutRecord;onUpdate:(start:number,end:number)=>void;onRestore:()=>void;onSeek:(ms:number)=>void;canPlay:boolean}){
  const [start,setStart]=useState(formatTime(cut.start,true));const [end,setEnd]=useState(formatTime(cut.end,true));const [error,setError]=useState("");
  useEffect(()=>{setStart(formatTime(cut.start,true));setEnd(formatTime(cut.end,true));setError("");},[cut.start,cut.end]);
  const changed=start!==formatTime(cut.start,true)||end!==formatTime(cut.end,true);
  return <article className="cut-item"><div className="cut-item-heading"><span className="cut-kind">{KIND_LABEL[cut.kind]}</span><span className={`precision-badge ${cut.precision}`}>{PRECISION_LABEL[cut.precision]}</span><span className="cut-duration">{((cut.end-cut.start)/1000).toFixed(3)}秒</span></div>{cut.text&&<p className="cut-text">{cut.text}</p>}<div className="cut-time-inputs"><label>開始<input value={start} onChange={e=>setStart(e.target.value)} aria-label="カット開始時刻" spellCheck={false}/></label><span>→</span><label>終了<input value={end} onChange={e=>setEnd(e.target.value)} aria-label="カット終了時刻" spellCheck={false}/></label>{changed&&<button className="button secondary small" onClick={()=>{const a=parseTimestamp(start),b=parseTimestamp(end);if(a===null||b===null||a>=b){setError("開始より後の終了時刻を HH:MM:SS.mmm で入力してください。");return;}try{onUpdate(a,b);setError("");}catch(err){setError(err instanceof Error?err.message:"時刻を適用できませんでした。");}}}>時刻を適用</button>}</div>{error&&<p className="field-error" role="alert">{error}</p>}<div className="cut-item-actions"><button className="button ghost small" disabled={!canPlay} onClick={()=>onSeek(Math.max(0,cut.start-400))}><Play size={13}/>前後を確認</button><button className="button ghost small" onClick={onRestore}><RotateCcw size={13}/>この削除を取り消す</button></div></article>;
}
