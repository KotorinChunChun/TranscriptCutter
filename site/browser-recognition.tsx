import {useEffect,useMemo,useRef,useState} from 'react';
import {restoredWorkspace,useWorkspaceSave} from './workspace-storage';
import type {RangeSelection} from './recognition-range';
import {fileKey} from './browser';
import {loadSpeechPreferences,saveSpeechPreferences} from './speech-preferences';
import {BrowserWhisper,browserWhisperModels,browserWhisperInstalled,openWhisperAudio,whisperAudioChunk} from './browser-whisper';
import {whisperSegments} from './browser-whisper-config';
import {finishEstimate} from './recognition-options';
import {useRecognitionRange,RecognitionRangeControls} from './recognition-range-controls';
import {MediaDrop} from './media-drop';
import {useMediaRangeSeek} from './use-media-range-seek';
import {beginMetric,measure,processingMetrics} from './processing-metrics';
import {recognitionProgress,transcriptionName} from './recognition-state';
import {segmentsToVtt} from './segments-vtt';
import type {Job,Segment} from './speech-client';
import type {RecognitionProps} from './recognition';
export function BrowserRecognition({active,onTransfer,onActivity}:RecognitionProps){
 const [restored]=useState(()=>restoredWorkspace<{range:RangeSelection;job:Job|null;segments:Segment[]}>('browser-recognition'));
 const engine=useRef(new BrowserWhisper()).current,controller=useRef<AbortController|null>(null),player=useRef<HTMLVideoElement>(null),sourceKey=useRef('');
 const [modelId,setModelId]=useState(()=>{const id=loadSpeechPreferences('http://browser-whisper.local/').modelId;return browserWhisperModels.some(m=>m.id===id)?id:'tiny';}),[installed,setInstalled]=useState<Record<string,boolean>>({}),[working,setWorking]=useState(false),[installing,setInstalling]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [file,setFile]=useState<File|null>(restored?.file??null),[url,setUrl]=useState(()=>restored?.file?URL.createObjectURL(restored.file):''),[job,setJob]=useState<Job|null>(()=>restored?.data.job?{...restored.data.job,...(['running','queued'].includes(restored.data.job.status)?{status:'interrupted',phase:'interrupted'}:{})}:null),[segments,setSegments]=useState<Segment[]>(restored?.data.segments??[]),[now,setNow]=useState(Date.now());
 const range=useRecognitionRange(file,restored?.data.range);
 const snapshot=useMemo(()=>({range:range.value,job,segments}),[range.value,job,segments]);useWorkspaceSave('browser-recognition',snapshot,file);
 const rangeSeek=useMediaRangeSeek(file,player,range,working);
 const model=browserWhisperModels.find(m=>m.id===modelId)!,position=recognitionProgress(job),estimate=finishEstimate(job,now);
 const supported=typeof Worker!=='undefined'&&typeof WebAssembly!=='undefined'&&typeof OfflineAudioContext!=='undefined'&&!!globalThis.caches;
 const check=async()=>{const states=await Promise.all(browserWhisperModels.map(async m=>[m.id,await browserWhisperInstalled(m)] as const));setInstalled(Object.fromEntries(states));};
 useEffect(()=>{void check();return()=>{controller.current?.abort();engine.stop();};},[]);
 useEffect(()=>{if(!working)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[working]);
 useEffect(()=>{onActivity?.({busy:working,label:working?installing?'ブラウザーWhisperを導入中':`ブラウザー認識 ${Math.round(position.fraction*100)}%・字幕${segments.length}件`:job?.status==='complete'?`ブラウザー認識完了・字幕${segments.length}件`:''});},[working,installing,position.fraction,segments.length,job?.status,onActivity]);
 useEffect(()=>{if(!active)player.current?.pause();},[active]);
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
 const progress=(p:{file?:string;loaded?:number;total?:number;status?:string})=>setMessage(`${p.file??'モデルを準備中'}${typeof p.loaded==='number'?` ${(p.loaded/1024**2).toFixed(1)}${p.total?' / '+(p.total/1024**2).toFixed(1):''} MB`:p.status==='done'?'・取得済み':''}`);
 const install=async()=>{
  setWorking(true);setInstalling(true);setError('');setMessage('実行環境を取得中');const abort=new AbortController();controller.current=abort;const finish=beginMetric('browser-whisper-install',{modelId:model.id,revision:model.revision});
  try{await engine.prepare(model,true,abort.signal,progress);finish();await check();setMessage('導入済み・開始できます');}
  catch(error){finish(abort.signal.aborted?'cancelled':'error');setError(abort.signal.aborted?'導入を中止しました。':String(error));}
  finally{controller.current=null;setWorking(false);setInstalling(false);}
 };
 const load=(selected:File)=>{if(working)return;if(!/\.(mp4|mov|mkv|webm|avi|m4v|wmv|mts|m2ts|wav|mp3|m4a|ogg|flac|aac)$/i.test(selected.name)){setError('動画・音声を選択してください。');return;}setFile(selected);setUrl(URL.createObjectURL(selected));setError('');if(sourceKey.current!==fileKey(selected)){setJob(null);setSegments([]);}};
 const recognize=async()=>{
  if(!file||working||!installed[model.id])return;let bounds;try{bounds=range.request();}catch(error){setError(String(error));return;}
  const abort=new AbortController();controller.current=abort;setWorking(true);setError('');setMessage('音声を準備中');setSegments([]);sourceKey.current=fileKey(file);
  let current:Job={id:crypto.randomUUID().replaceAll('-',''),status:'running',phase:'preparing',engine:'browser-whisper',modelId:model.id,fileName:file.name,rangeStart:bounds.from,segmentCount:0,metadata:{executionTarget:'browser',executionDevice:'wasm',modelRevision:model.revision,startedAt:new Date().toISOString()}},input:Awaited<ReturnType<typeof openWhisperAudio>>|undefined;
  const publish=(patch:Partial<Job>)=>{current={...current,...patch};setJob(current);};publish({});const rows:Segment[]=[],details={jobId:current.id,fileName:file.name,engine:'browser-whisper',modelId:model.id},started=performance.now();
  try{
   input=await measure('browser-media-inspection',details,()=>openWhisperAudio(file));
   const to=bounds.to??input.duration;if(bounds.from>=to||to>input.duration+0.000001)throw Error('認識範囲が音声の長さを超えています。');
   publish({duration:input.duration,rangeEnd:to,processedUntil:bounds.from});
   await measure('browser-whisper-loading',details,()=>engine.prepare(model,false,abort.signal,progress));
   for(let from=bounds.from;from<to;from+=30){
    if(abort.signal.aborted)throw new DOMException('中止','AbortError');const until=Math.min(from+30,to);publish({phase:'converting'});setMessage('音声を読み取り中');
    const audio=await whisperAudioChunk(input.sink,from,until,abort.signal,details);publish({phase:'transcribing'});setMessage('ブラウザー内で認識中');
    const result=await measure('browser-whisper-transcribing',{...details,from,to:until},()=>engine.recognize(audio,abort.signal));
    rows.push(...whisperSegments(result.chunks??[],from,until,rows.length+1));setSegments([...rows]);publish({processedUntil:until,segmentCount:rows.length});
   }
   publish({status:'complete',phase:'complete',metadata:{...current.metadata,finishedAt:new Date().toISOString(),runSeconds:(performance.now()-started)/1000}});setMessage('認識完了');
  }catch(error){publish({status:abort.signal.aborted?'cancelled':'error',phase:abort.signal.aborted?'cancelled':'error',error:abort.signal.aborted?undefined:String(error),metadata:{...current.metadata,finishedAt:new Date().toISOString(),runSeconds:(performance.now()-started)/1000}});setError(abort.signal.aborted?'認識を中止しました。確定済み字幕は保持しています。':String(error));}
  finally{input?.input.dispose();controller.current=null;setWorking(false);}
 };
 const outputName=(extension='vtt')=>transcriptionName(job!,file?.name??'transcript','',extension);
 const download=(record=false)=>{if(!job)return;const text=record?JSON.stringify({schemaVersion:2,job,segments,clientMeasurements:processingMetrics().filter(m=>m.details.jobId===job.id),memoryNote:'Optional JS heap snapshots, not process/GPU/peak memory.'},null,2):segmentsToVtt(segments),blob=new Blob([text],{type:record?'application/json':'text/vtt;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=outputName(record?'json':'vtt');a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
 return <section className="recognition guided-recognition browser-recognition"><header className="recognition-heading"><h1>ブラウザー内Whisper</h1><span>{working?'処理中':installed[modelId]?'導入済み':'未導入'}</span></header>
 {!supported&&<p role="alert" className="error">このブラウザーでは必要な音声処理・キャッシュ機能を利用できません。</p>}{error&&<p role="alert" className="error">{error}</p>}
 <div className="panes"><section className="setup-column"><div className="setup-card setup-content"><h2>モデル</h2><div className="model-fields"><label>ブラウザーモデル<select aria-label="ブラウザー認識モデル" disabled={working} value={modelId} onChange={e=>{engine.stop();setModelId(e.target.value);saveSpeechPreferences('http://browser-whisper.local/',{modelId:e.target.value,mode:'none',devices:{}});setMessage('');}}>{browserWhisperModels.map(m=><option key={m.id} value={m.id}>{m.label}（{installed[m.id]?'導入済み':'未導入'}）</option>)}</select></label><span>処理方式：このブラウザーのCPU（WASM）</span><button className="primary-action" disabled={working||!supported} onClick={()=>void install()}>{installed[modelId]?'モデルを再点検・再導入':'このブラウザーへ導入'}</button></div><p role="status">{message}</p></div>
 <div className="setup-card setup-content"><MediaDrop disabled={working} onLoad={load} label="ブラウザー認識の動画ドロップ領域"/>
 <RecognitionRangeControls range={range} disabled={working||!file} prefix="ブラウザー認識" onSeek={rangeSeek.seek}/>
 <button className="primary-action start-recognition" disabled={working||!file||!installed[modelId]||!supported||!range.valid} onClick={()=>void recognize()}>ブラウザーで文字起こし開始</button></div>{url&&<video ref={player} controls src={url} preload="metadata" onLoadedMetadata={rangeSeek.loaded} onSeeked={rangeSeek.seeked}/>}
 </section><section className="recognition-output">{working&&<button className="cancel-action" onClick={()=>controller.current?.abort()}>{installing?'導入を中止':'認識中止'}</button>}{job&&<><section className="recognition-progress"><strong>{job.status==='complete'?'完了':job.status==='running'?'処理中':job.status==='cancelled'?'中止':job.status==='interrupted'?'中断':'エラー'}・{Math.round(position.fraction*100)}%</strong><progress aria-label="ブラウザー認識の進捗" max={1} value={position.fraction}/><p aria-label="ブラウザー認識の終了見込み">{estimate?`認識終了見込み（推定） ${new Date(estimate.finishAt).toLocaleTimeString('ja-JP')}・残り約${Math.ceil(estimate.remainingSeconds)}秒`:job.status==='running'?'終了見込み：進捗が得られるまで算出待ち':''}</p><p>確定字幕 {segments.length}件</p></section><div className="row"><button className="primary-action" disabled={working||job.status!=='complete'||!segments.length||!file||sourceKey.current!==fileKey(file)} onClick={()=>{if(file){player.current?.pause();onTransfer({media:file,vtt:segmentsToVtt(segments),name:outputName()});}}}>VTT編集</button><button disabled={!segments.length} onClick={()=>download()}>{job.status==='complete'?'VTTを保存':'部分VTTを保存'}</button><button onClick={()=>download(true)}>処理記録を保存</button></div><div className="results"><table><thead><tr><th>時刻</th><th>本文</th></tr></thead><tbody>{segments.map(s=><tr key={s.id}><td><button onClick={()=>{rangeSeek.preview(s.start);}}>{s.start.toFixed(3)}</button></td><td>{s.text}</td></tr>)}</tbody></table></div></>}</section></div></section>;
}
