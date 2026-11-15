import {subtitleCsv} from './src/lib/subtitle-csv';
import {isRecognitionMediaName} from './src/lib/media-file';
import {parseVtt} from './src/lib/vtt';
import {SaveMenu,useSaveOptions} from './save-menu';
import {useEffect,useMemo,useRef,useState} from 'react';
import {restoredWorkspace,useWorkspaceSave} from './workspace-storage';
import type {RangeSelection} from './recognition-range';
import {fileKey,confirmAction} from './browser';
import {loadSpeechPreferences,saveSpeechPreferences} from './speech-preferences';
import {BrowserWhisper,browserWhisperModels,browserWhisperInstalled,browserWhisperCached,probeBrowserWhisperGPU,removeBrowserWhisper,openWhisperAudio,whisperAudioChunk} from './browser-whisper';
import {whisperSegments,type BrowserWhisperModel} from './browser-whisper-config';
import {BrowserHaas,browserHaasInstalled,browserHaasCached,installBrowserHaas,removeBrowserHaas} from './browser-haas';
import {browserHaasModel} from './browser-haas-config';
import {whisperDtype,whisperDevices,resolveWhisperDevice,whisperDeviceLabel,type WhisperGpuStatus} from './browser-whisper-device';
import {finishEstimate} from './recognition-options';
import {useRecognitionRange,RecognitionRangeControls} from './recognition-range-controls';
import {MediaDrop,RecognitionMediaPreview} from './media-drop';
import {browserWhisperModelSize} from './browser-whisper-config';
import {useMediaRangeSeek} from './use-media-range-seek';
import {beginMetric,measure,processingMetrics} from './processing-metrics';
import {recognitionProgress,transcriptionName} from './recognition-state';
import {segmentsToVtt} from './segments-vtt';
import type {Job,Segment} from './speech-client';
import type {RecognitionProps} from './recognition';
export function BrowserRecognition({active,onTransfer,onActivity,sourceControls,incomingMedia}:RecognitionProps){
 const [restored]=useState(()=>restoredWorkspace<{range:RangeSelection;job:Job|null;segments:Segment[]}>('browser-recognition'));
 const engine=useRef(new BrowserWhisper()).current,haasEngine=useRef(new BrowserHaas()).current,controller=useRef<AbortController|null>(null),player=useRef<HTMLMediaElement>(null),sourceKey=useRef(restored?.file?fileKey(restored.file):'');
 const [modelId,setModelId]=useState(()=>{const id=loadSpeechPreferences('http://browser-whisper.local/').modelId;return id===browserHaasModel.id||browserWhisperModels.some(m=>m.id===id)?id:'tiny';}),[installed,setInstalled]=useState<Record<string,boolean>>({}),[working,setWorking]=useState(false),[installing,setInstalling]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [devices,setDevices]=useState(()=>loadSpeechPreferences('http://browser-whisper.local/').devices),[gpu,setGpu]=useState<WhisperGpuStatus>({available:false,reason:'確認中'}),[checkingGpu,setCheckingGpu]=useState(true);
 const [diarize,setDiarize]=useState(()=>loadSpeechPreferences('http://browser-whisper.local/').mode==='nemotron'),[nemotronInstalled,setNemotronInstalled]=useState<boolean|null>(null),[nemotronCached,setNemotronCached]=useState(false);
 const deviceFor=(id:string)=>id===browserHaasModel.id?'wasm':resolveWhisperDevice(devices[id],gpu,browserWhisperModels.find(m=>m.id===id)?.devices);
 const [cached,setCached]=useState<Record<string,boolean>>({}),[deleting,setDeleting]=useState(''),[operationModel,setOperationModel]=useState('');
 const [file,setFile]=useState<File|null>(restored?.file??null),[url,setUrl]=useState(()=>restored?.file?URL.createObjectURL(restored.file):''),[job,setJob]=useState<Job|null>(()=>restored?.data.job?{...restored.data.job,...(['running','queued'].includes(restored.data.job.status)?{status:'interrupted',phase:'interrupted'}:{})}:null),[segments,setSegments]=useState<Segment[]>(restored?.data.segments??[]),[now,setNow]=useState(Date.now());
 const range=useRecognitionRange(file,restored?.data.range);
 const snapshot=useMemo(()=>({range:range.value,job,segments}),[range.value,job,segments]);useWorkspaceSave('browser-recognition',snapshot,file);
 const rangeSeek=useMediaRangeSeek(file,player,range,working);
 const haasSelected=modelId===browserHaasModel.id,whisperModel=browserWhisperModels.find(m=>m.id===modelId),model=haasSelected?browserHaasModel:whisperModel!,position=recognitionProgress(job),estimate=finishEstimate(job,now);
 const stopEngines=()=>{engine.stop();haasEngine.stop();};
 const savePreferences=(id=modelId,nextDevices=devices,nextDiarize=diarize)=>saveSpeechPreferences('http://browser-whisper.local/',{modelId:id,mode:nextDiarize?'nemotron':'none',devices:nextDevices});
 const supported=typeof Worker!=='undefined'&&typeof WebAssembly!=='undefined'&&typeof OfflineAudioContext!=='undefined'&&!!globalThis.caches;
 const check=async()=>{
  const [states,haasReady,haasCached,nemotronReady,nemotronPartial]=await Promise.all([
   Promise.all(browserWhisperModels.map(async m=>({id:m.id,wasm:await browserWhisperInstalled(m,'wasm'),webgpu:await browserWhisperInstalled(m,'webgpu'),cached:await browserWhisperCached(m)}))),
   browserHaasInstalled('haas'),browserHaasCached('haas'),browserHaasInstalled('nemotron'),browserHaasCached('nemotron'),
  ]);
  setInstalled({...Object.fromEntries(states.flatMap(m=>[[m.id+':wasm',m.wasm],[m.id+':webgpu',m.webgpu]])),[browserHaasModel.id+':wasm']:haasReady});
  setCached({...Object.fromEntries(states.map(m=>[m.id,m.cached])),[browserHaasModel.id]:haasCached});setNemotronInstalled(nemotronReady);setNemotronCached(nemotronPartial);
 };
 useEffect(()=>{let alive=true;void probeBrowserWhisperGPU().then(value=>{if(alive){setGpu(value);setCheckingGpu(false);}});return()=>{alive=false;};},[]);
 useEffect(()=>{void check().catch(error=>setError(String(error)));return()=>{controller.current?.abort();stopEngines();};},[]);
 useEffect(()=>{if(!working)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[working]);
 useEffect(()=>{onActivity?.({busy:working,label:working?deleting?'ブラウザーモデルを削除中':installing?'ローカルモデルを導入中':`ブラウザー認識 ${Math.round(position.fraction*100)}%・字幕${segments.length}件`:job?.status==='complete'?`ブラウザー認識完了・字幕${segments.length}件`:''});},[working,installing,deleting,position.fraction,segments.length,job?.status,onActivity]);
 useEffect(()=>{if(!active)player.current?.pause();},[active]);
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
 const progress=(p:{file?:string;loaded?:number;total?:number;status?:string;message?:string})=>setMessage(p.message??`${p.file??'モデルを準備中'}${typeof p.loaded==='number'?` ${(p.loaded/1024**2).toFixed(1)}${p.total?' / '+(p.total/1024**2).toFixed(1):''} MB`:p.status==='done'?'・取得済み':''}`);
 const install=async(model:BrowserWhisperModel)=>{
  if(working||checkingGpu)return;const device=deviceFor(model.id);setOperationModel(model.id);
  stopEngines();setWorking(true);setInstalling(true);setError('');setMessage('実行環境を取得中');const abort=new AbortController();controller.current=abort;const finish=beginMetric('browser-whisper-install',{modelId:model.id,revision:model.revision,device});
  try{await engine.prepare(model,true,abort.signal,progress,device);finish();await check();setMessage(model.label+'・'+whisperDeviceLabel(device)+'を導入しました');}
  catch(error){finish(abort.signal.aborted?'cancelled':'error');await check();setError(abort.signal.aborted?'導入を中止しました。':String(error));}
  finally{controller.current=null;setWorking(false);setInstalling(false);setOperationModel('');}
 };
 const installHaas=async(kind:'haas'|'nemotron')=>{
  if(working)return;const id=kind==='haas'?browserHaasModel.id:'aux-nemotron',label=kind==='haas'?browserHaasModel.label:'Nemotron 3 Diarization';
  stopEngines();setOperationModel(id);setWorking(true);setInstalling(true);setError('');setMessage('モデルを取得中');const abort=new AbortController();controller.current=abort;
  const finish=beginMetric('browser-haas-install',{bundle:kind});
  try{await installBrowserHaas(kind,abort.signal,progress);finish();await check();setMessage(label+'を導入しました');}
  catch(error){finish(abort.signal.aborted?'cancelled':'error');await check();setError(abort.signal.aborted?'導入を中止しました。':String(error));}
  finally{controller.current=null;setWorking(false);setInstalling(false);setOperationModel('');}
 };
 const selectModel=(id:string)=>{if(working)return;stopEngines();setModelId(id);savePreferences(id);setMessage('');};
 const selectDiarization=(value:boolean)=>{if(working)return;stopEngines();setDiarize(value);savePreferences(modelId,devices,value);setMessage('');};
 const selectDevice=(id:string,value:string)=>{if(working||checkingGpu)return;const next={...devices,[id]:resolveWhisperDevice(value,gpu,browserWhisperModels.find(m=>m.id===id)?.devices)};stopEngines();setDevices(next);savePreferences(modelId,next);setMessage('');};
 const removeModel=async(model:BrowserWhisperModel)=>{if(working||!(await confirmAction(model.label+'（保存済みの全方式）をこのブラウザーから削除します。再利用には再導入が必要です。')))return;setWorking(true);setDeleting(model.id);setOperationModel(model.id);setError('');const finish=beginMetric('browser-whisper-delete',{modelId:model.id});try{stopEngines();await removeBrowserWhisper(model);await check();finish();setMessage(model.label+'を削除しました');}catch(error){finish('error');setError(String(error));}finally{setWorking(false);setDeleting('');setOperationModel('');}};
 const removeHaas=async(kind:'haas'|'nemotron')=>{
  const id=kind==='haas'?browserHaasModel.id:'aux-nemotron',label=kind==='haas'?browserHaasModel.label:'Nemotron 3 Diarization';
  if(working||!(await confirmAction(label+'をこのブラウザーから削除します。再利用には再導入が必要です。')))return;
  setWorking(true);setDeleting(id);setOperationModel(id);setError('');const finish=beginMetric('browser-haas-delete',{bundle:kind});
  try{stopEngines();await removeBrowserHaas(kind);await check();finish();setMessage(label+'を削除しました');}
  catch(error){finish('error');setError(String(error));}finally{setWorking(false);setDeleting('');setOperationModel('');}
 };
 const speed=(id:string)=>{const seconds=Number(job?.metadata?.runSeconds),length=Number(job?.rangeEnd??0)-Number(job?.rangeStart??0),engineId=id===browserHaasModel.id?'browser-haas':'browser-whisper',sameMode=id!==browserHaasModel.id||job?.metadata?.diarize===diarize;return job?.status==='complete'&&job.engine===engineId&&job.modelId===id&&sameMode&&(job.metadata?.executionDevice??'wasm')===deviceFor(id)&&seconds>0&&length>0?(length/seconds).toFixed(1)+'倍速':'未測定';};
 useEffect(()=>{if(incomingMedia){player.current?.pause();load(incomingMedia);}},[incomingMedia]);
 const load=(selected:File)=>{if(working)return;if(!isRecognitionMediaName(selected.name)){setError('動画・音声を選択してください。');return;}setFile(selected);setUrl(URL.createObjectURL(selected));setError('');if(sourceKey.current!==fileKey(selected)){setJob(null);setSegments([]);}};
 const recognize=async()=>{
  const device=deviceFor(model.id);if(!file||working||(!haasSelected&&checkingGpu)||!installed[model.id+':'+device]||(haasSelected&&diarize&&!nemotronInstalled))return;let bounds;try{bounds=range.request();}catch(error){setError(String(error));return;}
  const abort=new AbortController();controller.current=abort;setWorking(true);setError('');setMessage('音声を準備中');setSegments([]);sourceKey.current=fileKey(file);
  const engineId=haasSelected?'browser-haas':'browser-whisper';
  let current:Job={id:crypto.randomUUID().replaceAll('-',''),status:'running',phase:'preparing',engine:engineId,modelId:model.id,fileName:file.name,rangeStart:bounds.from,segmentCount:0,metadata:{executionTarget:'browser',executionDevice:device,modelDtype:haasSelected?'int4-onecomp':whisperDtype(device),...(device==='webgpu'?{gpuAdapter:gpu.adapter}:{}),modelRevision:model.revision,...(haasSelected?{diarize,diarizationModel:diarize?'nemotron-3-diarization':null}:{}),startedAt:new Date().toISOString()}},input:Awaited<ReturnType<typeof openWhisperAudio>>|undefined;
  const publish=(patch:Partial<Job>)=>{current={...current,...patch};setJob(current);};publish({});const rows:Segment[]=[],details={jobId:current.id,fileName:file.name,engine:engineId,modelId:model.id,executionDevice:device},started=performance.now();
  try{
   input=await measure('browser-media-inspection',details,()=>openWhisperAudio(file));
   const to=bounds.to??input.duration;if(bounds.from>=to||to>input.duration+0.000001)throw Error('認識範囲が音声の長さを超えています。');
   publish({duration:input.duration,rangeEnd:to,processedUntil:bounds.from});
   if(haasSelected){
    publish({phase:'converting'});setMessage('音声を読み取り中');
    const audio=await whisperAudioChunk(input.sink,bounds.from,to,abort.signal,details);
    const localProgress=(p:{message?:string;stage?:string;fraction?:number;file?:string;loaded?:number;total?:number;status?:string})=>{
     progress(p);if(p.stage)publish({phase:['transcribing','diarizing','voice-detection'].includes(p.stage)?p.stage:'preparing'});
    };
    await measure('browser-haas-loading',details,()=>haasEngine.prepare(abort.signal,localProgress,diarize));
    const result=await measure('browser-haas-transcribing',{...details,from:bounds.from,to,diarize},()=>haasEngine.recognize(audio,{from:bounds.from,to,diarize},abort.signal,localProgress,(confirmed,processedUntil)=>{
     rows.splice(0,rows.length,...confirmed);setSegments([...rows]);publish({processedUntil,segmentCount:rows.length});
    }));
    if(result.executionDevice!=='wasm')throw Error('CPU方式と実行結果が一致しません。');
    rows.splice(0,rows.length,...result.segments);setSegments([...rows]);
    const {segments:_segments,...record}=result;
    publish({processedUntil:to,segmentCount:rows.length,metadata:{...current.metadata,browserHaas:record,stages:result.timings,retainedSeconds:result.retainedSeconds,removedSeconds:result.removedSeconds}});
   }else{
    await measure('browser-whisper-loading',details,()=>engine.prepare(whisperModel!,false,abort.signal,progress,device));
    for(let from=bounds.from;from<to;from+=30){
     if(abort.signal.aborted)throw new DOMException('中止','AbortError');const until=Math.min(from+30,to);publish({phase:'converting'});setMessage('音声を読み取り中');
     const audio=await whisperAudioChunk(input.sink,from,until,abort.signal,details);publish({phase:'transcribing'});setMessage(whisperDeviceLabel(device)+'で認識中');
     const result=await measure('browser-whisper-transcribing',{...details,from,to:until},()=>engine.recognize(audio,abort.signal));
     if(result.executionDevice!==device)throw Error('選択した処理方式と実行結果が一致しません。');
     rows.push(...whisperSegments(result.chunks??[],from,until,rows.length+1));setSegments([...rows]);publish({processedUntil:until,segmentCount:rows.length});
    }
   }
   publish({status:'complete',phase:'complete',metadata:{...current.metadata,finishedAt:new Date().toISOString(),runSeconds:(performance.now()-started)/1000}});setMessage('認識完了');
  }catch(error){publish({status:abort.signal.aborted?'cancelled':'error',phase:abort.signal.aborted?'cancelled':'error',error:abort.signal.aborted?undefined:String(error),metadata:{...current.metadata,finishedAt:new Date().toISOString(),runSeconds:(performance.now()-started)/1000}});setError(abort.signal.aborted?'認識を中止しました。確定済み字幕は保持しています。':String(error));}
  finally{input?.input.dispose();controller.current=null;setWorking(false);}
 };
 const outputName=(extension='vtt')=>transcriptionName(job!,file?.name??'transcript','',extension);
 const download=(record=false)=>{if(!job)return;const text=record?JSON.stringify({schemaVersion:2,job,segments,clientMeasurements:processingMetrics().filter(m=>m.details.jobId===job.id),memoryNote:'Optional JS heap snapshots, not process/GPU/peak memory.'},null,2):segmentsToVtt(segments),blob=new Blob([text],{type:record?'application/json':'text/vtt;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=outputName(record?'json':'vtt');a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
 useSaveOptions(active,[
  {id:'recognition-csv',label:'認識結果の字幕（CSV）',description:'開始・終了・話者・本文を表形式で保存',disabled:!segments.length,run:()=>{if(!job)return;const url=URL.createObjectURL(new Blob([subtitleCsv(parseVtt(segmentsToVtt(segments)).cues)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=outputName('csv');a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}},
  {id:'recognition-vtt',label:job?.status==='complete'?'認識結果の字幕（VTT）':'認識途中の字幕（VTT）',description:'文字起こしで確定した字幕を保存',disabled:!segments.length,run:()=>download()},
  {id:'recognition-record',label:'認識処理記録（JSON）',description:'この認識のモデル・処理時間・ブラウザー計測',disabled:!job,run:()=>download(true)},
 ]);
 const showSpeakers=job?.metadata?.diarize===true||segments.some(segment=>!!segment.speaker);
 return <section className="recognition guided-recognition browser-recognition" aria-label="ブラウザー文字起こし">
 {!supported&&<p role="alert" className="error">このブラウザーでは必要な音声処理・キャッシュ機能を利用できません。</p>}{error&&<p role="alert" className="error">{error}</p>}
 <div className="panes"><section className="setup-column">{sourceControls}
 <section className="setup-card"><div className="setup-static-heading"><span className="setup-number">2</span><strong>モデル</strong><span className="browser-gpu-status" role="status" title={gpu.reason+(gpu.adapter?' '+gpu.adapter:'')}>{checkingGpu?'WebGPU確認中':gpu.available?'WebGPU利用可':'CPUのみ'}</span></div><div className="setup-content"><div className="browser-model-table-wrap"><table className="browser-model-table" aria-label="ブラウザーモデル一覧"><thead><tr><th>モデル名</th><th>導入</th><th>削除</th><th>選択</th><th>速度</th><th>精度</th><th>CPU/GPU</th></tr></thead><tbody>{browserWhisperModels.map(m=><tr key={m.id} aria-selected={m.id===modelId}><th scope="row"><strong>{m.label}</strong><span className="browser-model-state" title="選択方式のONNXモデル本体合計。実行環境・設定・作業用メモリは別です。">{browserWhisperModelSize(m,deviceFor(m.id))}</span><span className="browser-model-state">{working&&operationModel===m.id?deleting?'削除中':'導入中':installed[m.id+':'+deviceFor(m.id)]?'導入済み':installed[m.id+':'+(deviceFor(m.id)==='wasm'?'webgpu':'wasm')]?'未導入（別方式済み）':cached[m.id]?'一部保存':installed[m.id+':'+deviceFor(m.id)]===false?'未導入':'確認中'}</span></th><td><button className="primary-action" aria-label={m.label+'を導入'} disabled={working||checkingGpu||!supported||installed[m.id+':'+deviceFor(m.id)]} onClick={()=>void install(m)}>導入</button></td><td><button className="danger-action" aria-label={m.label+'を削除'} disabled={working||!cached[m.id]} onClick={()=>void removeModel(m)}>削除</button></td><td><button aria-label={m.label+'を選択'} aria-pressed={modelId===m.id} disabled={working||!supported} onClick={()=>selectModel(m.id)}>{modelId===m.id?'選択中':'選択'}</button></td><td title="同モデルの直近のブラウザー認識結果">{speed(m.id)}</td><td title="正解字幕による評価は未実施">未評価</td><td><select aria-label={m.label+'の処理方式'} title={m.devices.length===1?'このモデルはCPUのみ対応しています。':undefined} value={deviceFor(m.id)} disabled={working||checkingGpu||!supported} onChange={event=>selectDevice(m.id,event.target.value)}>{whisperDevices(gpu,m.devices).map(device=><option key={device} value={device}>{whisperDeviceLabel(device)}</option>)}</select></td></tr>)}
<tr aria-selected={haasSelected}>
 <th scope="row"><strong>{browserHaasModel.label}</strong><span className="browser-model-state" title="モデル本体の合計。実行環境・設定・作業用メモリは別です。">モデル本体 約{Math.ceil(browserHaasModel.modelBytes.wasm/1e6).toLocaleString('ja-JP')} MB</span><span className="browser-model-state">{working&&operationModel===browserHaasModel.id?deleting?'削除中':'導入中':installed[browserHaasModel.id+':wasm']?'導入済み':cached[browserHaasModel.id]?'一部保存':installed[browserHaasModel.id+':wasm']===false?'未導入':'確認中'}</span></th>
 <td><button className="primary-action" aria-label={browserHaasModel.label+'を導入'} disabled={working||!supported||installed[browserHaasModel.id+':wasm']} onClick={()=>void installHaas('haas')}>導入</button></td>
 <td><button className="danger-action" aria-label={browserHaasModel.label+'を削除'} disabled={working||!cached[browserHaasModel.id]} onClick={()=>void removeHaas('haas')}>削除</button></td>
 <td><button aria-label={browserHaasModel.label+'を選択'} aria-pressed={haasSelected} disabled={working||!supported} onClick={()=>selectModel(browserHaasModel.id)}>{haasSelected?'選択中':'選択'}</button></td>
 <td title="同モデル・同じ話者識別設定の直近の認識結果">{speed(browserHaasModel.id)}</td><td title="正解字幕による評価は未実施">未評価</td><td title="Silero VAD＋HaasはCPUのみ対応しています。">CPU（WASM）</td>
</tr>
</tbody></table></div>
{haasSelected&&<div className="browser-speaker-options">
 <label><span>話者識別</span><select aria-label="ローカルの話者識別" value={diarize?'nemotron':'none'} disabled={working||!supported} onChange={event=>selectDiarization(event.target.value==='nemotron')}><option value="none">話者識別なし</option><option value="nemotron">Nemotron 3 Diarization</option></select></label>
 <div className="browser-auxiliary-model"><div><strong>Nemotron 3 Diarization</strong><span className="browser-model-state" title="話者識別を選択した場合だけ使用する補助モデルです。音源分離は行いません。">モデル本体 約106 MB・{working&&operationModel==='aux-nemotron'?deleting?'削除中':'導入中':nemotronInstalled?'導入済み':nemotronCached?'一部保存':nemotronInstalled===false?'未導入':'確認中'}</span></div><button className="primary-action" aria-label="Nemotron 3 Diarizationを導入" disabled={working||!supported||nemotronInstalled===true} onClick={()=>void installHaas('nemotron')}>導入</button><button className="danger-action" aria-label="Nemotron 3 Diarizationを削除" disabled={working||!nemotronCached} onClick={()=>void removeHaas('nemotron')}>削除</button></div>
</div>}
<p role="status" className="browser-model-message">{message}</p></div></section>
 <section className="setup-card"><div className="setup-static-heading"><span className="setup-number">3</span><strong>動画・音声</strong></div><div className="setup-content"><MediaDrop disabled={working} onLoad={load} label="ブラウザー認識の動画ドロップ領域">{url&&file&&<RecognitionMediaPreview file={file} url={url} player={player} onLoadedMetadata={rangeSeek.loaded} onSeeked={rangeSeek.seeked} onTimeUpdate={rangeSeek.timeUpdate} onError={()=>setError('この形式はブラウザーでプレビューできません。')}/>}</MediaDrop></div></section>
 <section className="setup-card"><div className="setup-static-heading"><span className="setup-number">4</span><strong>文字起こし</strong></div><div className="setup-content"><RecognitionRangeControls range={range} disabled={working||!file} prefix="ブラウザー認識" onSeek={rangeSeek.seek}/><button className="primary-action start-recognition" disabled={working||!file||(!haasSelected&&checkingGpu)||!installed[modelId+':'+deviceFor(modelId)]||(haasSelected&&diarize&&!nemotronInstalled)||!supported||!range.valid} onClick={()=>void recognize()}>ブラウザーで文字起こし開始</button></div></section>
 </section><section className="recognition-output">{job&&<div className="recognition-save-tools"><SaveMenu stage={1} active={active} className="primary-action"/></div>}{working&&!deleting&&<button className="cancel-action" onClick={()=>{controller.current?.abort();stopEngines();}}>{installing?'導入を中止':'認識中止'}</button>}{job&&<><section className="recognition-progress" data-execution-device={String(job.metadata?.executionDevice??'wasm')} data-model-dtype={job.metadata?.modelDtype?JSON.stringify(job.metadata.modelDtype):undefined} data-run-seconds={typeof job.metadata?.runSeconds==='number'?job.metadata.runSeconds:undefined}><strong>{job.status==='complete'?'完了':job.status==='running'?'処理中':job.status==='cancelled'?'中止':job.status==='interrupted'?'中断':'エラー'}・{Math.round(position.fraction*100)}%</strong><progress aria-label="ブラウザー認識の進捗" max={1} value={position.fraction}/><p aria-label="ブラウザー認識の終了見込み">{estimate?`認識終了見込み（推定） ${new Date(estimate.finishAt).toLocaleTimeString('ja-JP')}・残り約${Math.ceil(estimate.remainingSeconds)}秒`:job.status==='running'?'終了見込み：進捗が得られるまで算出待ち':''}</p><p>確定字幕 {segments.length}件・{whisperDeviceLabel(job.metadata?.executionDevice==='webgpu'?'webgpu':'wasm')}{job.engine==='browser-haas'&&(job.metadata?.diarize?'・話者識別あり':'・話者識別なし')}</p>{job.status==='complete'&&typeof job.metadata?.runSeconds==='number'&&<p aria-label="ブラウザー認識の処理時間">処理時間 {job.metadata.runSeconds.toFixed(2)}秒</p>}</section><div className="row"><button className="primary-action" disabled={working||job.status!=='complete'||!segments.length||!file||sourceKey.current!==fileKey(file)} onClick={()=>{if(file){player.current?.pause();onTransfer({media:file,vtt:segmentsToVtt(segments),name:outputName(),segments});}}}>VTT編集</button></div><div className="results"><table><thead><tr><th>時刻</th>{showSpeakers&&<th>話者</th>}<th>本文</th></tr></thead><tbody>{segments.map(s=><tr key={s.id}><td><button onClick={()=>{rangeSeek.preview(s.start);}}>{s.start.toFixed(3)}</button></td>{showSpeakers&&<td className="browser-result-speaker">{s.speaker??'話者不明'}</td>}<td>{s.text}</td></tr>)}</tbody></table></div></>}</section></div></section>;
}
