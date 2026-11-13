import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {ALL_FORMATS,BlobSource,Input} from 'mediabunny';
import {initialRange,resolveRange,rangeRequest,rangeClock,changeRangeMode,moveRangeHandle,relativeStart,relativeEnd,type RangeSelection,type StartMode,type EndMode} from './recognition-range';
import {rangeSeekTarget} from './media-range-seek';
export function useRecognitionRange(file:File|null,restored?:RangeSelection){
 const initialFile=useRef(file);
 const [value,setValue]=useState<RangeSelection>(()=>restored??initialRange()),[media,setMedia]=useState<{file:File|null;duration:number|null;error:string}>({file:null,duration:null,error:''});
 useEffect(()=>{
  const recovering=!!restored&&file===initialFile.current;
  if(!recovering)setValue(initialRange());setMedia({file,duration:null,error:''});if(!file)return;let ignored=false;
  const input=new Input({formats:ALL_FORMATS,source:new BlobSource(file)});
  const dispose=()=>{try{input.dispose();}catch{/* An obsolete probe may have been disposed already. */}};
  void input.computeDuration().then(duration=>{if(ignored)return;if(!Number.isFinite(duration)||duration<=0)throw Error('長さを確認できません。');setMedia({file,duration,error:''});if(!recovering)setValue(initialRange(duration));}).catch(()=>{if(!ignored)setMedia({file,duration:null,error:'動画の長さを取得できません。'});}).finally(dispose);
  return()=>{ignored=true;dispose();};
 },[file]);
 const duration=media.file===file?media.duration:null,loading=!!file&&(media.file!==file||media.duration===null&&!media.error);
 let valid=true;try{resolveRange(value,duration);}catch{valid=false;}
 return {value,setValue,duration,loading,mediaError:media.file===file?media.error:'',valid:valid&&!loading,request:()=>rangeRequest(value,duration)};
}
export function RecognitionRangeControls({range,disabled=false,prefix='認識',onSeek}:{range:ReturnType<typeof useRecognitionRange>;disabled?:boolean;prefix?:string;onSeek?:(seconds:number,side:'start'|'end')=>void}){
 const {value,duration,setValue,loading}=range;let resolved:ReturnType<typeof resolveRange>|null=null,error='';try{resolved=resolveRange(value,duration);}catch(e){error=e instanceof Error?e.message:String(e);}
 const locked=disabled||loading,max=Math.ceil((duration??0)*1000),from=resolved?.from??0,to=resolved?.to??duration??0;
 const startText=value.startMode==='custom'?value.start:rangeClock(from),endText=value.endMode==='custom'?value.end:rangeClock(to,true);
 const seek=(next:RangeSelection,side:'start'|'end')=>{const seconds=rangeSeekTarget(next,side,duration);if(seconds!==null)onSeek?.(seconds,side);};
 const commit=(next:RangeSelection,side:'start'|'end')=>{setValue(next);seek(next,side);};
 const select=(side:'start'|'end',mode:StartMode|EndMode)=>commit(changeRangeMode(value,side,mode,duration),side);
 const move=(side:'start'|'end',milliseconds:number)=>{if(duration)commit(moveRangeHandle(value,side,milliseconds>=max?duration:milliseconds/1000,duration),side);};
 return <section className="recognition-options recognition-range" aria-label={`${prefix}範囲`}><div className="range-fields">
 <label>開始<select aria-label={`${prefix}開始位置`} disabled={locked} value={value.startMode} onChange={e=>select('start',e.target.value as StartMode)}><option value="edge">先頭</option><option value="custom">カスタム</option><option value="before60" disabled={!duration||relativeEnd(value.endMode)}>1分前</option><option value="before300" disabled={!duration||relativeEnd(value.endMode)}>5分前</option></select></label>
 <input aria-label={`${prefix}開始時刻`} placeholder="hh:mm:ss.sss" value={startText} disabled={locked||value.startMode!=='custom'} onChange={e=>commit({...value,start:e.target.value},'start')}/>
 <label>終了<select aria-label={`${prefix}終了位置`} disabled={locked} value={value.endMode} onChange={e=>select('end',e.target.value as EndMode)}><option value="edge">末尾</option><option value="custom">カスタム</option><option value="after60" disabled={!duration||relativeStart(value.startMode)}>1分後</option><option value="after300" disabled={!duration||relativeStart(value.startMode)}>5分後</option></select></label>
 <input aria-label={`${prefix}終了時刻`} placeholder="hh:mm:ss.sss" value={endText} disabled={locked||value.endMode!=='custom'} onChange={e=>commit({...value,end:e.target.value},'end')}/>
 </div><div className="range-slider" role="group" aria-label={`${prefix}の開始と終了を調整`} onPointerDown={e=>{if(locked||!duration||e.target instanceof HTMLInputElement)return;const box=e.currentTarget.getBoundingClientRect(),seconds=Math.max(0,Math.min(duration,(e.clientX-box.left)/box.width*duration));move(Math.abs(seconds-from)<=Math.abs(seconds-to)?'start':'end',seconds*1000);}} style={{'--range-from':`${duration?from/duration*100:0}%`,'--range-to':`${duration?to/duration*100:100}%`} as CSSProperties}>
 <div className="range-track"><span/></div><input type="range" aria-label={`${prefix}開始スライダー`} min="0" max={max||1} step="1" value={Math.round(from*1000)} disabled={locked||!duration} onPointerDown={()=>seek(value,'start')} onChange={e=>move('start',Number(e.target.value))}/><input type="range" aria-label={`${prefix}終了スライダー`} min="0" max={max||1} step="1" value={Math.ceil(to*1000)} disabled={locked||!duration} onPointerDown={()=>seek(value,'end')} onChange={e=>move('end',Number(e.target.value))}/>
 </div><div className="range-scale"><span>{rangeClock(from)}</span><span>{rangeClock(to,true)}</span></div>
 {loading&&<span role="status">長さを確認中</span>}{range.mediaError&&<span role="status">{range.mediaError}</span>}{error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
