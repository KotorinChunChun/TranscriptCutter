import {useSaveOptions} from './save-menu';
import {useEffect,useMemo,useRef,useState} from 'react';
import {restoredWorkspace,useWorkspaceSave} from './workspace-storage';
import type {RangeSelection} from './recognition-range';
import {fileKey,confirmAction} from './browser';
import {loadSpeechPreferences,saveSpeechPreferences} from './speech-preferences';
import {BrowserWhisper,browserWhisperModels,browserWhisperInstalled,browserWhisperCached,probeBrowserWhisperGPU,removeBrowserWhisper,openWhisperAudio,whisperAudioChunk} from './browser-whisper';
import {whisperSegments,type BrowserWhisperModel} from './browser-whisper-config';
import {whisperDtype,whisperDevices,resolveWhisperDevice,whisperDeviceLabel,type WhisperDevice,type WhisperGpuStatus} from './browser-whisper-device';
import {finishEstimate} from './recognition-options';
import {useRecognitionRange,RecognitionRangeControls} from './recognition-range-controls';
import {MediaDrop} from './media-drop';
import {useMediaRangeSeek} from './use-media-range-seek';
import {beginMetric,measure,processingMetrics} from './processing-metrics';
import {recognitionProgress,transcriptionName} from './recognition-state';
import {segmentsToVtt} from './segments-vtt';
import type {Job,Segment} from './speech-client';
import type {RecognitionProps} from './recognition';
export function BrowserRecognition({active,onTransfer,onActivity,sourceControls}:RecognitionProps){
 const [restored]=useState(()=>restoredWorkspace<{range:RangeSelection;job:Job|null;segments:Segment[]}>('browser-recognition'));
 const engine=useRef(new BrowserWhisper()).current,controller=useRef<AbortController|null>(null),player=useRef<HTMLVideoElement>(null),sourceKey=useRef(restored?.file?fileKey(restored.file):'');
 const [modelId,setModelId]=useState(()=>{const id=loadSpeechPreferences('http://browser-whisper.local/').modelId;return browserWhisperModels.some(m=>m.id===id)?id:'tiny';}),[installed,setInstalled]=useState<Record<string,boolean>>({}),[working,setWorking]=useState(false),[installing,setInstalling]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [devices,setDevices]=useState(()=>loadSpeechPreferences('http://browser-whisper.local/').devices),[gpu,setGpu]=useState<WhisperGpuStatus>({available:false,reason:'確認中'}),[checkingGpu,setCheckingGpu]=useState(true);
 const deviceFor=(id:string)=>resolveWhisperDevice(devices[id],gpu);
 const [cached,setCached]=useState<Record<string,boolean>>({}),[deleting,setDeleting]=useState(''),[operationModel,setOperationModel]=useState('');
 const [file,setFile]=useState<File|null>(restored?.file??null),[url,setUrl]=useState(()=>restored?.file?URL.createObjectURL(restored.file):''),[job,setJob]=useState<Job|null>(()=>restored?.data.job?{...restored.data.job,...(['running','queued'].includes(restored.data.job.status)?{status:'interrupted',phase:'interrupted'}:{})}:null),[segments,setSegments]=useState<Segment[]>(restored?.data.segments??[]),[now,setNow]=useState(Date.now());
 const range=useRecognitionRange(file,restored?.data.range);
 const snapshot=useMemo(()=>({range:range.value,job,segments}),[range.value,job,segments]);useWorkspaceSave('browser-recognition',snapshot,file);
 const rangeSeek=useMediaRangeSeek(file,player,range,working);
 const model=browserWhisperModels.find(m=>m.id===modelId)!,position=recognitionProgress(job),estimate=finishEstimate(job,now);
 const supported=typeof Worker!=='undefined'&&typeof WebAssembly!=='undefined'&&typeof OfflineAudioContext!=='undefined'&&!!globalThis.caches;
 const check=async()=>{const states=await Promise.all(browserWhisperModels.map(async m=>({id:m.id,wasm:await browserWhisperInstalled(m,'wasm'),webgpu:await browserWhisperInstalled(m,'webgpu'),cached:await browserWhisperCached(m)})));setInstalled(Object.fromEntries(states.flatMap(m=>[[m.id+':wasm',m.wasm],[m.id+':webgpu',m.webgpu]])));setCached(Object.fromEntries(states.map(m=>[m.id,m.cached])));};
 useEffect(()=>{let alive=true;void probeBrowserWhisperGPU().then(value=>{if(alive){setGpu(value);setCheckingGpu(false);}});return()=>{alive=false;};},[]);
 useEffect(()=>{void check();return()=>{controller.current?.abort();engine.stop();};},[]);
 useEffect(()=>{if(!working)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[working]);
 useEffect(()=>{onActivity?.({busy:working,label:working?deleting?'ブラウザーモデルを削除中':installing?'ブラウザーWhisperを導入中':`ブラウザー認識 ${Math.round(position.fraction*100)}%・字幕${segments.length}件`:job?.status==='complete'?`ブラウザー認識完了・字幕${segments.length}件`:''});},[working,installing,deleting,position.fraction,segments.length,job?.status,onActivity]);
 useEffect(()=>{if(!active)player.current?.pause();},[active]);
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
 const progress=(p:{file?:string;loaded?:number;total?:number;status?:string})=>setMessage(`${p.file??'モデルを準備中'}${typeof p.loaded==='number'?` ${(p.loaded/1024**2).toFixed(1)}${p.total?' / '+(p.total/1024**2).toFixed(1):''} MB`:p.status==='done'?'・取得済み':''}`);
 const install=async(model:BrowserWhisperModel)=>{
  if(working||checkingGpu)return;const device=deviceFor(model.id);setOperationModel(model.id);
  setWorking(true);setInstalling(true);setError('');setMessage('実行環境を取得中');const abort=new AbortController();controller.current=abort;const finish=beginMetric('browser-whisper-install',{modelId:model.id,revision:model.revision,device});
  try{await engine.prepare(model,true,abort.signal,progress,device);finish();await check();setMessage(model.label+'・'+whisperDeviceLabel(device)+'を導入しました');}
  catch(error){finish(abort.signal.aborted?'cancelled':'error');await check();setError(abort.signal.aborted?'導入を中止しました。':String(error));}
  finally{controller.current=null;setWorking(false);setInstalling(false);setOperationModel('');}
 };
 const selectModel=(id:string)=>{if(working)return;engine.stop();setModelId(id);saveSpeechPreferences('http://browser-whisper.local/',{modelId:id,mode:'none',devices});setMessage('');};
 const selectDevice=(id:string,value:string)=>{if(working||checkingGpu)return;const next={...devices,[id]:resolveWhisperDevice(value,gpu)};engine.stop();setDevices(next);saveSpeechPreferences('http://browser-whisper.local/',{modelId,mode:'none',devices:next});setMessage('');};
 const removeModel=async(model:BrowserWhisperModel)=>{if(working||!(await confirmAction(model.label+'（CPU/GPU両方式）をこのブラウザーから削除します。再利用には再導入が必要です。')))return;setWorking(true);setDeleting(model.id);setOperationModel(model.id);setError('');const finish=beginMetric('browser-whisper-delete',{modelId:model.id});try{engine.stop();await removeBrowserWhisper(model);await check();finish();setMessage(model.label+'を削除しました');}catch(error){finish('error');setError(String(error));}finally{setWorking(false);setDeleting('');setOperationModel('');}};
 const speed=(id:string)=>{const seconds=Number(job?.metadata?.runSeconds),length=Number(job?.rangeEnd??0)-Number(job?.rangeStart??0);return job?.status==='complete'&&job.engine==='browser-whisper'&&job.modelId===id&&(job.metadata?.executionDevice??'wasm')===deviceFor(id)&&seconds>0&&length>0?(length/seconds).toFixed(1)+'倍速':'未測定';};
 const load=(selected:File)=>{if(working)return;if(!/\.(mp4|mov|mkv|webm|avi|m4v|wmv|mts|m2ts|wav|mp3|m4a|ogg|flac|aac)$/i.test(selected.name)){setError('動画・音声を選択してください。');return;}setFile(selected);setUrl(URL.createObjectURL(selected));setError('');if(sourceKey.current!==fileKey(selected)){setJob(null);setSegments([]);}};
 const recognize=async()=>{
  const device=deviceFor(model.id);if(!file||working||checkingGpu||!installed[model.id+':'+device])return;let bounds;try{bounds=range.request();}catch(error){setError(String(error));return;}
  const abort=new AbortController();controller.current=abort;setWorking(true);setError('');setMessage('音声を準備中');setSegments([]);sourceKey.current=fileKey(file);
  let current:Job={id:crypto.randomUUID().replaceAll('-',''),status:'running',phase:'preparing',engine:'browser-whisper',modelId:model.id,fileName:file.name,rangeStart:bounds.from,segmentCount:0,metadata:{executionTarget:'browser',executionDevice:device,modelDtype:whisperDtype(device),...(device==='webgpu'?{gpuAdapter:gpu.adapter}:{}),modelRevision:model.revision,startedAt:new Date().toISOString()}},input:Awaited<ReturnType<typeof openWhisperAudio>>|undefined;
  const publish=(patch:Partial<Job>)=>{current={...current,...patch};setJob(current);};publish({});const rows:Segment[]=[],details={jobId:current.id,fileName:file.name,engine:'browser-whisper',modelId:model.id,executionDevice:device},started=performance.now();
  try{
   input=await measure('browser-media-inspection',details,()=>openWhisperAudio(file));
   const to=bounds.to??input.duration;if(bounds.from>=to||to>input.duration+0.000001)throw Error('認識範囲が音声の長さを超えています。');
   publish({duration:input.duration,rangeEnd:to,processedUntil:bounds.from});
   await measure('browser-whisper-loading',details,()=>engine.prepare(model,false,abort.signal,progress,device));
   for(let from=bounds.from;from<to;from+=30){
    if(abort.signal.aborted)throw new DOMException('中止','AbortError');const until=Math.min(from+30,to);publish({phase:'converting'});setMessage('音声を読み取り中');
    const audio=await whisperAudioChunk(input.sink,from,until,abort.signal,details);publish({phase:'transcribing'});setMessage(whisperDeviceLabel(device)+'で認識中');
    const result=await measure('browser-whisper-transcribing',{...details,from,to:until},()=>engine.recognize(audio,abort.signal));
    if(result.executionDevice!==device)throw Error('選択した処理方式と実行結果が一致しません。');
    rows.push(...whisperSegments(result.chunks??[],from,until,rows.length+1));setSegments([...rows]);publish({processedUntil:until,segmentCount:rows.length});
   }
   publish({status:'complete',phase:'complete',metadata:{...current.metadata,finishedAt:new Date().toISOString(),runSeconds:(performance.now()-started)/1000}});setMessage('認識完了');
  }catch(error){publish({status:abort.signal.aborted?'cancelled':'error',phase:abort.signal.aborted?'cancelled':'error',error:abort.signal.aborted?undefined:String(error),metadata:{...current.metadata,finishedAt:new Date().toISOString(),runSeconds:(performance.now()-started)/1000}});setError(abort.signal.aborted?'認識を中止しました。確定済み字幕は保持しています。':String(error));}
  finally{input?.input.dispose();controller.current=null;setWorking(false);}
 };
 const outputName=(extension='vtt')=>transcriptionName(job!,file?.name??'transcript','',extension);
 const download=(record=false)=>{if(!job)return;const text=record?JSON.stringify({schemaVersion:2,job,segments,clientMeasurements:processingMetrics().filter(m=>m.details.jobId===job.id),memoryNote:'Optional JS heap snapshots, not process/GPU/peak memory.'},null,2):segmentsToVtt(segments),blob=new Blob([text],{type:record?'application/json':'text/vtt;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=outputName(record?'json':'vtt');a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
 useSaveOptions(active,[
  {id:'recognition-vtt',label:job?.status==='complete'?'認識結果の字幕（VTT）':'認識途中の字幕（VTT）',description:'文字起こしで確定した字幕を保存',disabled:!segments.length,run:()=>download()},
  {id:'recognition-record',label:'認識処理記録（JSON）',description:'この認識のモデル・処理時間・ブラウザー計測',disabled:!job,run:()=>download(true)},
 ]);
 return <section className="recognition guided-recognition browser-recognition" aria-label="ブラウザー文字起こし">
 {!supported&&<p role="alert" className="error">このブラウザーでは必要な音声処理・キャッシュ機能を利用できません。</p>}{error&&<p role="alert" className="error">{error}</p>}
 <div className="panes"><section className="setup-column">{sourceControls}
 <section className="setup-card"><div className="setup-static-heading"><span className="setup-number">2</span><strong>モデル</strong><span className="browser-gpu-status" role="status" title={gpu.reason+(gpu.adapter?' '+gpu.adapter:'')}>{checkingGpu?'WebGPU確認中':gpu.available?'WebGPU利用可':'CPUのみ'}</span></div><div className="setup-content"><div className="browser-model-table-wrap"><table className="browser-model-table" aria-label="ブラウザーモデル一覧"><thead><tr><th>モデル名</th><th>導入</th><th>削除</th><th>選択</th><th>速度</th><th>精度</th><th>CPU/GPU</th></tr></thead><tbody>{browserWhisperModels.map(m=><tr key={m.id} aria-selected={m.id===modelId}><th scope="row"><strong>{m.label}</strong><span className="browser-model-state">{working&&operationModel===m.id?deleting?'削除中':'導入中':installed[m.id+':'+deviceFor(m.id)]?'導入済み':installed[m.id+':'+(deviceFor(m.id)==='wasm'?'webgpu':'wasm')]?'未導入（別方式済み）':cached[m.id]?'一部保存':installed[m.id+':'+deviceFor(m.id)]===false?'未導入':'確認中'}</span></th><td><button className="primary-action" aria-label={m.label+'を導入'} disabled={working||checkingGpu||!supported||installed[m.id+':'+deviceFor(m.id)]} onClick={()=>void install(m)}>導入</button></td><td><button className="danger-action" aria-label={m.label+'を削除'} disabled={working||!cached[m.id]} onClick={()=>void removeModel(m)}>削除</button></td><td><button aria-label={m.label+'を選択'} aria-pressed={modelId===m.id} disabled={working||!supported} onClick={()=>selectModel(m.id)}>{modelId===m.id?'選択中':'選択'}</button></td><td title="同モデルの直近のブラウザー認識結果">{speed(m.id)}</td><td title="正解字幕による評価は未実施">未評価</td><td><select aria-label={m.label+'の処理方式'} value={deviceFor(m.id)} disabled={working||checkingGpu||!supported} onChange={event=>selectDevice(m.id,event.target.value)}>{whisperDevices(gpu).map(device=><option key={device} value={device}>{whisperDeviceLabel(device)}</option>)}</select></td></tr>)}</tbody></table></div><p role="status" className="browser-model-message">{message}</p></div></section>
 <section className="setup-card"><div className="setup-static-heading"><span className="setup-number">3</span><strong>動画・音声</strong></div><div className="setup-content"><MediaDrop disabled={working} onLoad={load} label="ブラウザー認識の動画ドロップ領域" text="動画または音声ファイルをドロップ"/></div></section>
 <section className="setup-card"><div className="setup-static-heading"><span className="setup-number">4</span><strong>文字起こし</strong></div><div className="setup-content"><RecognitionRangeControls range={range} disabled={working||!file} prefix="ブラウザー認識" onSeek={rangeSeek.seek}/><button className="primary-action start-recognition" disabled={working||!file||checkingGpu||!installed[modelId+':'+deviceFor(modelId)]||!supported||!range.valid} onClick={()=>void recognize()}>ブラウザーで文字起こし開始</button></div></section>{url&&<video ref={player} controls src={url} preload="metadata" onLoadedMetadata={rangeSeek.loaded} onSeeked={rangeSeek.seeked}/>}
 </section><section className="recognition-output">{working&&<button className="cancel-action" onClick={()=>controller.current?.abort()}>{installing?'導入を中止':'認識中止'}</button>}{job&&<><section className="recognition-progress" data-execution-device={String(job.metadata?.executionDevice??'wasm')} data-model-dtype={job.metadata?.modelDtype?JSON.stringify(job.metadata.modelDtype):undefined} data-run-seconds={typeof job.metadata?.runSeconds==='number'?job.metadata.runSeconds:undefined}><strong>{job.status==='complete'?'完了':job.status==='running'?'処理中':job.status==='cancelled'?'中止':job.status==='interrupted'?'中断':'エラー'}・{Math.round(position.fraction*100)}%</strong><progress aria-label="ブラウザー認識の進捗" max={1} value={position.fraction}/><p aria-label="ブラウザー認識の終了見込み">{estimate?`認識終了見込み（推定） ${new Date(estimate.finishAt).toLocaleTimeString('ja-JP')}・残り約${Math.ceil(estimate.remainingSeconds)}秒`:job.status==='running'?'終了見込み：進捗が得られるまで算出待ち':''}</p><p>確定字幕 {segments.length}件・{whisperDeviceLabel(job.metadata?.executionDevice==='webgpu'?'webgpu':'wasm')}</p></section><div className="row"><button className="primary-action" disabled={working||job.status!=='complete'||!segments.length||!file||sourceKey.current!==fileKey(file)} onClick={()=>{if(file){player.current?.pause();onTransfer({media:file,vtt:segmentsToVtt(segments),name:outputName()});}}}>VTT編集</button></div><div className="results"><table><thead><tr><th>時刻</th><th>本文</th></tr></thead><tbody>{segments.map(s=><tr key={s.id}><td><button onClick={()=>{rangeSeek.preview(s.start);}}>{s.start.toFixed(3)}</button></td><td>{s.text}</td></tr>)}</tbody></table></div></>}</section></div></section>;
}
