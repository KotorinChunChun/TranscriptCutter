import {useEffect,useMemo,useState} from 'react';
import {Modal} from './editor-ui';
import {invoke,choosePaths,mediaFile,type DesktopFile} from '../desktop';
import {buildMediaCutPlan} from '../src/lib/media-plan';
import type {CutRecord} from '../src/lib/editor';
export function VideoExportDialog({open,file,cuts,subtitleEndMs,onClose,onBusyChange}:{open:boolean;file:File;cuts:readonly CutRecord[];subtitleEndMs:number;onClose:()=>void;onBusyChange?:(v:boolean)=>void}){
 const source=file as DesktopFile;
 const [preview,setPreview]=useState<DesktopFile|null>(null);
 const [info,setInfo]=useState<any>(null),[dir,setDir]=useState(''),[name,setName]=useState(file.name.replace(/\.[^.]+$/,'')+'-edited');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[progress,setProgress]=useState(0),[output,setOutput]=useState('');
 useEffect(()=>{if(open&&source.desktopPath)invoke('inspect_dialogue_media',{path:source.desktopPath}).then(setInfo).catch(e=>setMessage(String(e)));},[open,file]);
 const planning=useMemo(()=>{try{return {plan:info?buildMediaCutPlan(cuts,Math.round(info.duration*1000),subtitleEndMs):null,error:''};}catch(e){return {plan:null,error:String(e)};}},[info,cuts,subtitleEndMs]);
 useEffect(()=>{if(!busy)return;let pending=false;const timer=setInterval(async()=>{if(pending)return;pending=true;try{const result=await invoke('cut_status');setProgress(result.progress);if(!result.running){setBusy(false);onBusyChange?.(false);setMessage(result.error??'保存しました。');setOutput(result.output??'');}}catch(e){setMessage(String(e));}finally{pending=false;}},500);return()=>clearInterval(timer);},[busy,onBusyChange]);
 useEffect(()=>{let active=true;setPreview(null);if(output)mediaFile(output).then(f=>{if(active)setPreview(f);}).catch(e=>{if(active)setMessage(String(e));});return()=>{active=false;};},[output]);
 if(!open)return null;
 const close=()=>{if(busy){setMessage('書き出しを中止するか、完了後に閉じてください。');return;}onClose();};
 return <Modal title="動画・音声を書き出す" onClose={close}><p>{info?`元 ${info.duration.toFixed(3)}秒 / 出力 ${((planning.plan?.outputDurationMs??0)/1000).toFixed(3)}秒 / ${info.width?'MP4':'M4A'}`:'読込中'}</p><p>VTT終了以降の末尾もカットします。</p><button className="button secondary" disabled={busy} onClick={async()=>{const paths=await choosePaths('directory');if(paths.length)setDir(paths[0]);}}>保存先を選択</button><p>{dir}</p><label>保存名 <input value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label><p role="status" className="desktop-output">{planning.error||message}</p><progress max={100} value={progress}/><button className="button primary" disabled={busy||!dir||!planning.plan||!planning.plan.keep.length} onClick={async()=>{try{if(!source.desktopPath)throw Error('元動画をアプリ内で選択してください。');const plan=planning.plan!;await invoke('dialogue_cut',{path:source.desktopPath,ranges:plan.keep.map(r=>({start:r.start/1000,end:r.end/1000})),dir,name});setBusy(true);onBusyChange?.(true);setOutput('');setProgress(0);setMessage('書き出し中');}catch(e){setMessage(String(e));}}}>書き出す</button>{busy&&<button className="button secondary" onClick={()=>void invoke('cancel_cut')}>中止</button>}{output&&<p className="desktop-output">{output}</p>}{preview&&(info?.width?<video controls src={preview.desktopUrl} style={{width:"100%",maxHeight:"35vh"}}/>:<audio controls src={preview.desktopUrl}/>)}</Modal>;
}

