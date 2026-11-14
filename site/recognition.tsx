import {serverAcceptsJobs,preparationProgress,type ServerHealth} from './server-readiness';
import {subtitleCsv} from './src/lib/subtitle-csv';
import {isRecognitionMediaName} from './src/lib/media-file';
import {parseVtt} from './src/lib/vtt';
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {restoredWorkspace,useWorkspaceSave,speechSessionClientId} from './workspace-storage';
import type {RangeSelection} from './recognition-range';
import {createPortal} from 'react-dom';
import {fileKey,confirmAction} from './browser';
import {hashMedia,matchesSource,sourceIdentity} from './media-identity';
import {loadSpeechPreferences,saveSpeechPreferences,processingChoice,speakerModes,modelsForSpeakerMode} from './speech-preferences';
import {SpeechClient,needsBearerKey,canConfigureConnection,type Job,type Model,type Segment} from './speech-client';
import {modelReferenceSpeed} from './model-reference-speed';
function ModelReferenceSpeed({model}:{model:Model}){
 const reference=modelReferenceSpeed(model);
 return reference.details.length?<details className="model-reference-speed"><summary>{reference.summary}</summary>{reference.details.map((line,i)=><p key={i}>{line}</p>)}</details>:<p className="model-reference-speed" role="status">{reference.summary}</p>;
}
import {segmentsToVtt} from './segments-vtt';
import {formatTime} from './src/lib/vtt';
import {RecognitionResults,isActiveJob,recognitionProgress,recognitionElapsed,recognitionLabels,transcriptionName} from './recognition-state';
import {recognitionSetup,managementUrl,type SetupStep} from './recognition-setup';
import {effectiveDiarization,finishEstimate} from './recognition-options';
import {useRecognitionRange,RecognitionRangeControls} from './recognition-range-controls';
import {MediaDrop,RecognitionMediaPreview} from './media-drop';
import {beginMetric,processingMetrics} from './processing-metrics';
import {BrowserRecognition} from './browser-recognition';
import {ServerMeasurements} from './server-measurements';
import {RecognitionHistory} from './recognition-history';
import {deletableHistory,historyPageInfo} from './recognition-history-state';
import {useMediaRangeSeek} from './use-media-range-seek';
import {SaveMenu,useSaveOptions} from './save-menu';
export type RecognitionProps={active:boolean;onTransfer:(value:{vtt:string;name:string;media:File;segments?:readonly Segment[]})=>void;onActivity?:(value:{busy:boolean;label:string})=>void;sourceControls?:ReactNode};
export function Recognition(props:RecognitionProps){
 const [source,setSource]=useState(()=>restoredWorkspace<{source:string}>('recognition-source')?.data.source==='browser'?'browser':'server'),[serverActivity,setServerActivity]=useState({busy:false,label:''}),[browserActivity,setBrowserActivity]=useState({busy:false,label:''}),[historyHost,setHistoryHost]=useState<HTMLDivElement|null>(null);
 const sourceSnapshot=useMemo(()=>({source}),[source]);useWorkspaceSave('recognition-source',sourceSnapshot);
 const busy=serverActivity.busy||browserActivity.busy;
 useEffect(()=>{props.onActivity?.(source==='server'?serverActivity:browserActivity);},[source,serverActivity,browserActivity,props.onActivity]);
 const sourceControls=(forServer:boolean)=><section className="setup-card execution-target-card"><div className="setup-static-heading"><span className="setup-number">1</span><strong>文字起こしの実行先</strong></div><div className="setup-content recognition-source"><label><select aria-label="文字起こしの実行先" disabled={busy} value={source} onChange={e=>setSource(e.target.value)}><option value="server">サーバー：TranscriptionServer（ブラウザーを閉じても実行されます）</option><option value="browser">このPC内で実行（閉じたら中断されます）</option></select></label>{forServer&&<div className="history-toolbar" ref={setHistoryHost}/>}</div></section>;
 return <><div hidden={source!=='server'}><ServerRecognition {...props} active={props.active&&source==='server'} sourceControls={sourceControls(true)} historyHost={historyHost} onActivity={setServerActivity}/></div><div hidden={source!=='browser'}><BrowserRecognition {...props} sourceControls={sourceControls(false)} active={props.active&&source==='browser'} onActivity={setBrowserActivity}/></div></>;
}
function SetupCard({number,title,summary,active,disabled,onOpen,children,tone}:{number:SetupStep;title:string;summary:string;active:boolean;disabled:boolean;onOpen:()=>void;children:ReactNode;tone?:'warning'|'error'}){
 const [collapsed,setCollapsed]=useState(false);useEffect(()=>setCollapsed(false),[active]);const expanded=active&&!collapsed;
 return <section className="setup-card" data-current={expanded} data-tone={tone}><button className="setup-toggle" aria-expanded={expanded} aria-controls={`setup-${number}`} disabled={disabled} onClick={()=>{if(active)setCollapsed(!collapsed);else{setCollapsed(false);onOpen();}}}><span className="setup-number">{number+1}</span><span className="setup-label"><strong>{title}</strong>{summary&&<span>{summary}</span>}</span><span aria-hidden="true">{expanded?'−':'＋'}</span></button><div className="setup-content" id={`setup-${number}`} hidden={!expanded}>{children}</div></section>;
}
function ServerRecognition({active,onTransfer,onActivity,historyHost,sourceControls}:RecognitionProps&{historyHost:HTMLDivElement|null}){
 const [restored]=useState(()=>restoredWorkspace<{range:RangeSelection;step:SetupStep;job:Job|null;segments:Segment[];serverUrl:string}>('server-recognition'));
 const restoreJob=useRef(!!restored?.data.job),restoreSetup=useRef(!!restored);
 const client=useRef(new SpeechClient(speechSessionClientId())).current,reader=useRef(new RecognitionResults(client)).current;
 const resultList=useRef<HTMLDivElement>(null),player=useRef<HTMLMediaElement>(null),pendingCancel=useRef(false),owned=useRef(new Set<string>()),jobFile=useRef(''),uploadStarted=useRef(0);
 const [file,setFile]=useState<File|null>(restored?.file??null),[url,setUrl]=useState(()=>restored?.file?URL.createObjectURL(restored.file):''),[models,setModels]=useState<Model[]>([]),[modelId,setModelId]=useState(''),[device,setDevice]=useState('auto'),[speakerMode,setSpeakerMode]=useState('none'),[connected,setConnected]=useState(false),[message,setMessage]=useState('接続中'),[error,setError]=useState('');
 const range=useRecognitionRange(file,restored?.data.range);
 const [mediaHash,setMediaHash]=useState(''),[hashing,setHashing]=useState(false),[hashProgress,setHashProgress]=useState(0),[confirmedSource,setConfirmedSource]=useState<{id:string;hash:string}|null>(null);
 const uploadedHashes=useRef(new Map<string,string>());
 const historyEpoch=useRef(0);
 const [historyOpen,setHistoryOpen]=useState(false),[historyLoading,setHistoryLoading]=useState(false),[historyError,setHistoryError]=useState(''),[historyPage,setHistoryPage]=useState(0),[historyTotal,setHistoryTotal]=useState(0),[historyHasNext,setHistoryHasNext]=useState(false),[canDeleteHistory,setCanDeleteHistory]=useState(false),[pendingDelete,setPendingDelete]=useState<Job|null>(null),[deleting,setDeleting]=useState(false);
 const [job,setJob]=useState<Job|null>(restored?.data.job??null),[segments,setSegments]=useState<Segment[]>(restored?.data.segments??[]),[upload,setUpload]=useState(false),[progress,setProgress]=useState(0),[jobs,setJobs]=useState<Job[]>([]),[search,setSearch]=useState('');
 const [serverUrl,setServerUrl]=useState('http://127.0.0.1:8769/'),[connectedUrl,setConnectedUrl]=useState(restored?.data.serverUrl??'http://127.0.0.1:8769/'),[serverKey,setServerKey]=useState(''),[showConnection,setShowConnection]=useState(false),[connecting,setConnecting]=useState(false);
 const [authMode,setAuthMode]=useState<string|null>(null),[keyRequired,setKeyRequired]=useState(false);
 const [setupStep,setSetupStep]=useState<SetupStep>(restored?.data.step??1),[serverReady,setServerReady]=useState<boolean|undefined>(),[serverReason,setServerReason]=useState('');
 const snapshot=useMemo(()=>({range:range.value,step:setupStep,job,segments,serverUrl:connectedUrl}),[range.value,setupStep,job,segments,connectedUrl]);useWorkspaceSave('server-recognition',snapshot,file);
 const connectionError=(e:unknown)=>{const required=needsBearerKey(e);setConnected(false);setKeyRequired(required);if(required)setAuthMode('bearer');setShowConnection(true);setSetupStep(1);setError(String(e));};
 const [updatedAt,setUpdatedAt]=useState(0),[pollError,setPollError]=useState(''),[clock,setClock]=useState(Date.now()),[page,setPage]=useState(0),[follow,setFollow]=useState(true);
 const choices=modelsForSpeakerMode(models,speakerMode),modes=speakerModes(models),diarize=speakerMode!=='none';
 const model=choices.find(m=>m.id===modelId),busy=upload||isActiveJob(job),position=recognitionProgress(job);
 const rangeSeek=useMediaRangeSeek(file,player,range,busy);
 const [managementProxy,setManagementProxy]=useState<string|null>(null);
 const [healthError,setHealthError]=useState(''),[serverHealth,setServerHealth]=useState<ServerHealth>({});
 const preparation=preparationProgress(serverHealth);
 const applyHealth=(health:ServerHealth)=>{setServerHealth(health);setServerReady(serverAcceptsJobs(health));setServerReason(health.reason??'');};
 useEffect(()=>{if(!active||!connected||serverUrl!==connectedUrl)return;let cancelled=false,pending=false;
 const check=async()=>{if(pending)return;pending=true;try{const value=await client.connect(health=>{if(!cancelled)applyHealth(health);});if(!cancelled){setHealthError('');setModels(value.models);}}catch(e){if(!cancelled){setHealthError(String(e));setModels([]);}}finally{pending=false;}};
 void check();const timer=setInterval(()=>void check(),preparation.blocked?2000:15000);window.addEventListener('focus',check);return()=>{cancelled=true;clearInterval(timer);window.removeEventListener('focus',check);};},[active,connected,connectedUrl,serverUrl,client,preparation.blocked]);
 useEffect(()=>{if(busy||!models.length)return;const prefs=loadSpeechPreferences(connectedUrl),mode=speakerModes(models).some(m=>m.id===speakerMode)?speakerMode:'none',list=modelsForSpeakerMode(models,mode),selected=list.find(m=>m.id===modelId)??list.find(m=>m.id===prefs.modelId)??list[0];setSpeakerMode(mode);setModelId(selected?.id??'');setDevice(current=>processingChoice(selected,current));},[models,busy,connectedUrl,speakerMode,modelId]);
 const connectionCurrent=connected&&!healthError&&canConfigureConnection(true,connectedUrl,serverUrl),workflow=recognitionSetup({connected:connectionCurrent,ready:serverReady,modelSelected:!!model&&model.x_meeting.available!==false&&model.x_meeting.runtimeReady!==false,methodSelected:!!model?.x_meeting.processingMethods.some(m=>m.id===device),hasFile:!!file,busy}),manageLink=connectionCurrent?(managementProxy??managementUrl(connectedUrl)):null;
 useEffect(()=>{if(follow&&busy&&resultList.current)resultList.current.scrollTop=resultList.current.scrollHeight;},[segments.length,follow,busy,search]);
 const {statusLabel,phaseLabel,waitingReason}=recognitionLabels(job);
 const activityLabel=upload?`送信 ${Math.round(progress*100)}%`:job?`${statusLabel} ${Math.round(position.fraction*100)}%・字幕${segments.length}件`:'';
 useEffect(()=>{onActivity?.({busy,label:activityLabel});},[busy,activityLabel,onActivity]);
 useEffect(()=>{if(!busy)return;setClock(Date.now());const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[busy]);
 const chooseModel=(id:string,list=choices,mode=speakerMode,target=connectedUrl)=>{const prefs=loadSpeechPreferences(target),m=list.find(m=>m.id===id),method=processingChoice(m,prefs.devices[id]);setModelId(id);setDevice(method);saveSpeechPreferences(target,{...prefs,modelId:id,mode,devices:{...prefs.devices,[id]:method}});};
 const chooseMode=(mode:string)=>{const list=modelsForSpeakerMode(models,mode),prefs=loadSpeechPreferences(connectedUrl);setSpeakerMode(mode);chooseModel(list.find(m=>m.id===modelId)?.id??list.find(m=>m.id===prefs.modelId)?.id??list[0]?.id??'',list,mode);};
 const chooseDevice=(value:string)=>{setDevice(value);const prefs=loadSpeechPreferences(connectedUrl);saveSpeechPreferences(connectedUrl,{...prefs,modelId,mode:speakerMode,devices:{...prefs.devices,[modelId]:value}});};
 const history=async(page=0)=>{const epoch=++historyEpoch.current;setHistoryLoading(true);setHistoryError('');try{const raw=await client.request(`/api/jobs?limit=50&offset=${page*50}&clientId=transcript-cutter&workload=file`);if(epoch!==historyEpoch.current)return;const v=historyPageInfo(raw,page);setJobs(v.jobs);setHistoryPage(page);setHistoryTotal(v.total);setHistoryHasNext(v.hasNext);}catch(e){if(epoch===historyEpoch.current)setHistoryError(String(e));}finally{if(epoch===historyEpoch.current)setHistoryLoading(false);}};
 const connect=async()=>{setError('');setHealthError('');setConnecting(true);try{const v=await client.connect(applyHealth),config=await client.connectionSettings();setConnectedUrl(config.url);setServerUrl(config.url);setManagementProxy(config.managementUrl??null);setModels(v.models);if(!busy){const prefs=loadSpeechPreferences(config.url),availableModes=speakerModes(v.models),mode=availableModes.some(m=>m.id===prefs.mode)?prefs.mode:'none',list=modelsForSpeakerMode(v.models,mode);setSpeakerMode(mode);chooseModel(list.find(m=>m.id===prefs.modelId)?.id??list.find(m=>m.id==='whisper/base')?.id??list[0]?.id??'',list,mode,config.url);setSetupStep(restoreSetup.current&&restored?restored.data.step:file&&v.models.length&&serverAcceptsJobs(v.health)?4:2);}restoreSetup.current=false;applyHealth(v.health);setCanDeleteHistory(v.health.capabilities?.jobDeletion===true);setAuthMode(v.health.authMode);setKeyRequired(v.health.authMode==='bearer');setConnected(true);setShowConnection(false);if(restoreJob.current){restoreJob.current=false;if(restored&&restored.data.serverUrl===config.url&&restored.data.job){reader.select(restored.data.job.id);await refresh(true);}else{clearJob();setError('接続先が変わったため、前回の認識結果は自動再接続しません。');}}setMessage(`接続済み ${v.health.serverVersion??''}・${v.health.authMode==='lan'?'LAN（キー不要）':v.health.authMode==='bearer'?'Bearer':'このPC（キー不要）'}`);await history();}catch(e){setConnected(false);setCanDeleteHistory(false);setServerReady(false);setServerHealth({});setModels([]);setMessage('未接続');connectionError(e);}finally{setConnecting(false);}};
 const clearJob=()=>{reader.select('');setJob(null);setSegments([]);setUpdatedAt(0);setPollError('');setPage(0);jobFile.current='';};
 const applyConnection=async()=>{if(upload||connecting||!canConfigureConnection(busy,connectedUrl,serverUrl))return;const sameServer=canConfigureConnection(true,connectedUrl,serverUrl);setConnecting(true);setConnected(false);setError('');if(!busy&&!sameServer){clearJob();historyEpoch.current++;setJobs([]);setCanDeleteHistory(false);owned.current.clear();}try{await client.configure(serverUrl,serverKey);setServerKey('');await connect();}catch(e){setModels([]);setMessage('未接続');connectionError(e);}finally{setServerKey('');setConnecting(false);}};
 useEffect(()=>{void client.connectionSettings().then(config=>{setServerUrl(config.url);return connect();}).catch(e=>{setError(String(e));setMessage('未接続');setShowConnection(true);});return()=>{reader.select('');historyEpoch.current++;};},[]);
 useEffect(()=>{if(!active)player.current?.pause();},[active]);
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
 useEffect(()=>{setMediaHash('');setConfirmedSource(null);if(!file){setHashing(false);return;}const abort=new AbortController();setHashing(true);setHashProgress(0);const finish=beginMetric('media-identity',{fileName:file.name});void hashMedia(file,abort.signal,setHashProgress).then(hash=>{if(!abort.signal.aborted){setMediaHash(hash);finish();}}).catch(e=>{finish(abort.signal.aborted?'cancelled':'error');if(!abort.signal.aborted)setError('元動画を照合できません。ファイルを再ドロップしてください。'+String(e));}).finally(()=>{if(!abort.signal.aborted)setHashing(false);});return()=>abort.abort();},[file]);
 const load=(f:File)=>{if(busy)return;if(!isRecognitionMediaName(f.name)){setError('動画・音声を選択してください。');return;}setFile(f);setUrl(URL.createObjectURL(f));setSetupStep(3);setError('');setConfirmedSource(null);};
 const refresh=async(reset=false)=>{try{const result=await reader.refresh(reset);if(!result)return;setJob(result.job);setSegments(result.segments);setUpdatedAt(result.updatedAt);setPollError('');}catch(e){if(needsBearerKey(e))connectionError(e);setPollError(`更新できませんでした。取得済み字幕は保持しています。${String(e)}`);}};
 useEffect(()=>{if(!connected||!isActiveJob(job))return;const timer=setInterval(()=>void refresh(),1500);return()=>clearInterval(timer);},[connected,job?.id,job?.status]);
 const recognize=async()=>{if(!file||!model||!mediaHash||!workflow.canStart||connecting)return;setError('');let bounds;try{bounds=range.request();}catch(e){setError(String(e));return;}const {from,to}=bounds;setSetupStep(4);setUpload(true);setProgress(0);setFollow(true);pendingCancel.current=false;uploadStarted.current=Date.now();setMessage('送信中');const finish=beginMetric('upload',{fileName:file.name,engine:model.x_meeting.engineId,modelId:model.x_meeting.modelId});try{const fresh=await client.connect(applyHealth);setModels(fresh.models);const current=fresh.models.find(m=>m.id===model.id);if(!serverAcceptsJobs(fresh.health)||!current||!current.x_meeting.processingMethods.some(m=>m.id===device)||diarize&&!effectiveDiarization(true,current))throw Error('サーバーまたは選択したモデルが準備中です。準備状況を確認してください。');clearJob();const value=await client.upload(file,current,device,effectiveDiarization(diarize,model),from,to,setProgress);finish('complete',{jobId:value.job.id});jobFile.current=fileKey(file);uploadedHashes.current.set(value.job.id,mediaHash);owned.current.add(value.job.id);reader.select(value.job.id);setJob(value.job);setMessage('認識を受け付けました。');if(pendingCancel.current){const stopped=await client.request(`/api/jobs/${value.job.id}/cancel`,{});setJob(stopped.job);}await refresh();await history();}catch(e){finish('error');setError(String(e));}finally{setUpload(false);}};
 const cancel=async()=>{try{if(upload){pendingCancel.current=true;setMessage('送信受付後に中止します。');return;}if(job&&(owned.current.has(job.id)||job.clientId==='transcript-cutter')){await client.request(`/api/jobs/${job.id}/cancel`,{});await refresh();}}catch(e){setError(String(e));}};
 const exportVtt=()=>segmentsToVtt(segments);
 const outputName=(extension='vtt')=>transcriptionName(job!,String(job?.fileName??file?.name??'transcript'),connectedUrl,extension);
 const handoff=()=>{if(!file||job?.status!=='complete'||!segments.length)return;if(!sourceMatches){setError('認識した元動画と同じファイルを読み込んでください。');return;}try{player.current?.pause();onTransfer({media:file,vtt:exportVtt(),name:outputName(),segments});}catch(e){setError(String(e));}};
 const download=(record=false)=>{if(!job)return;try{const blob=new Blob([record?JSON.stringify({schemaVersion:2,recordedAt:new Date().toISOString(),serverUrl:connectedUrl,sourceFile:job.fileName,partial:job.status!=='complete',job,clientMeasurements:processingMetrics().filter(m=>m.details.jobId===job.id),memoryNote:'Browser memory values are optional JS heap snapshots; server measurement semantics are retained in job.metadata.'},null,2):exportVtt()],{type:record?'application/json':'text/vtt;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=outputName(record?'json':'vtt');a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(e){setError(String(e));}};
 useSaveOptions(active,[
  {id:'recognition-csv',label:'認識結果の字幕（CSV）',description:'開始・終了・話者・本文を表形式で保存',disabled:!segments.length,run:()=>{if(!job)return;const url=URL.createObjectURL(new Blob([subtitleCsv(parseVtt(segmentsToVtt(segments)).cues)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=outputName('csv');a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}},
  {id:'recognition-vtt',label:job?.status==='complete'?'認識結果の字幕（VTT）':'認識途中の字幕（VTT）',description:'文字起こしで確定した字幕を保存',disabled:!segments.length,run:()=>download()},
  {id:'recognition-record',label:'認識処理記録（JSON）',description:'この認識のモデル・処理時間・サーバー計測',disabled:!job,run:()=>download(true)},
 ]);
 const rows=segments.filter(s=>!search||`${s.speaker??''} ${s.text}`.includes(search)),pages=Math.max(1,Math.ceil(rows.length/200)),currentPage=follow&&busy?pages-1:Math.min(page,pages-1),visible=rows.slice(currentPage*200,(currentPage+1)*200);
 const elapsed=upload?{seconds:Math.max(0,(clock-uploadStarted.current)/1000),source:'live'}:recognitionElapsed(job,clock);
 const estimate=finishEstimate(job,clock);
 const openStep=(step:SetupStep)=>{setShowConnection(false);setSetupStep(step);};
 const currentStep=showConnection?1:setupStep,hasResult=!!job||upload;
 const sourceMatches=!!file&&!!job&&!!mediaHash&&(matchesSource(job,mediaHash,file.size)||uploadedHashes.current.get(job.id)===mediaHash||confirmedSource?.id===job.id&&confirmedSource.hash===mediaHash);
 const confirmLegacySource=async()=>{if(!job||!file||!mediaHash||sourceIdentity(job))return;const id=job.id,hash=mediaHash;if(await confirmAction('この履歴には元動画の内容照合情報がありません。認識元名：'+String(job.fileName??'不明')+'、選択名：'+file.name+'。同じ元動画であることを確認して引き継ぎますか？'))setConfirmedSource({id,hash});};
 const canCancel=upload||isActiveJob(job)&&!!job&&(owned.current.has(job.id)||job.clientId==='transcript-cutter');
 const openHistoryJob=async(selected:Job)=>{if(busy)return;reader.select(selected.id);setSegments([]);setUpdatedAt(0);setPage(0);setJob(selected);setHistoryOpen(false);setPendingDelete(null);openStep(4);jobFile.current='';await refresh();};
 const deleteHistoryJob=async()=>{const target=pendingDelete;if(!target||busy||deleting||!deletableHistory(target,canDeleteHistory))return;setDeleting(true);setHistoryError('');try{await client.deleteJob(target.id);if(job?.id===target.id){clearJob();setSetupStep(file?4:3);}setPendingDelete(null);await history(jobs.length===1&&historyPage>0?historyPage-1:historyPage);}catch(e){setHistoryError(`削除を完了できませんでした。${String(e)}`);}finally{setDeleting(false);}};
 return <section className={`recognition guided-recognition ${hasResult?'has-result':''}`}>
 {historyHost&&createPortal(<button hidden={!active} disabled={!connectionCurrent} onClick={()=>{setHistoryOpen(true);setPendingDelete(null);void history();}}>履歴</button>,historyHost)}
 {historyOpen&&active&&<RecognitionHistory jobs={jobs} total={historyTotal} page={historyPage} hasNext={historyHasNext} loading={historyLoading} error={historyError} busy={busy} canDelete={canDeleteHistory} pendingDelete={pendingDelete} deleting={deleting} onClose={()=>{setHistoryOpen(false);setPendingDelete(null);}} onPage={page=>void history(page)} onSelect={selected=>void openHistoryJob(selected)} onDelete={selected=>{if(deletableHistory(selected,canDeleteHistory)){setHistoryError('');setPendingDelete(selected);}}} onCancelDelete={()=>{setPendingDelete(null);setHistoryError('');}} onConfirmDelete={()=>void deleteHistoryJob()}/>}
 {error&&<p role="alert" className="error">{error}</p>}
 {healthError&&<p role="alert" className="error">準備状況を確認できません。{healthError}</p>}
 {connected&&preparation.blocked&&<div className="server-preparation" role="status"><strong>{preparation.label}</strong><progress aria-label="サーバーの準備進捗" max={1} value={preparation.fraction}/>{preparation.message&&<span>{preparation.message}</span>}</div>}
 <div className="panes"><section className="setup-column" aria-label="文字起こしの準備">{sourceControls}
 <SetupCard number={1} title="サーバー接続" tone={!connecting&&!connectionCurrent?'error':undefined} summary={connecting?'接続を確認中':connectionCurrent?`接続済み · ${connectedUrl}`:connected?`未接続（接続先の変更が未反映） · ${serverUrl}`:`エラー：未接続 · ${serverUrl}`} active={currentStep===1} disabled={connecting} onOpen={()=>openStep(1)}>
  <div className="connection-settings"><input type="url" aria-label="文字起こしサーバーURL" value={serverUrl} disabled={busy||connecting} onChange={e=>{setServerUrl(e.target.value);setServerKey('');setKeyRequired(false);setAuthMode(null);}}/>

  {keyRequired&&<label>接続キー（Bearer認証のみ） <input type="password" aria-label="サーバー接続キー" autoComplete="off" value={serverKey} disabled={upload||connecting} onChange={e=>setServerKey(e.target.value)}/></label>}
  <button className="primary-action" disabled={upload||connecting||!canConfigureConnection(busy,connectedUrl,serverUrl)} onClick={()=>void applyConnection()}>接続を確認</button></div>

 </SetupCard>
 <SetupCard number={2} tone={!workflow.allowed[3]?'warning':undefined} title={job?"次回のモデルと処理方式":"モデルと処理方式"} summary={!connectionCurrent?'接続待ち':preparation.blocked?'サーバー準備中':serverReady===false||!models.length?'利用可能なモデルなし':model?`${model.x_meeting.label}・${model.x_meeting.processingMethods.find(m=>m.id===device)?.label??'処理方式を選択'}`:'モデルを選択'} active={currentStep===2} disabled={busy||connecting||!workflow.allowed[2]} onOpen={()=>openStep(2)}>
  <div className="row server-actions">{manageLink&&<a className={`setup-link ${serverReady===false||!models.length?'primary-action':''}`} href={manageLink} target="_blank" rel="noopener noreferrer">サーバー管理を開く ↗</a>}<button disabled={busy||connecting} onClick={()=>void connect()}>準備状況を更新</button><div className="preparation-status" role="status">{serverReady===false||!models.length?serverReason||'利用可能なモデルがありません':`利用可能モデル ${models.length}件`}</div></div>
  <div className="model-fields server-model-fields"><label className="speaker-model">話者識別モデル<select aria-label="話者識別モデル" value={speakerMode} disabled={busy} onChange={e=>chooseMode(e.target.value)}>{modes.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
  <label>文字起こしモデル <select aria-label="認識モデル" value={modelId} disabled={!choices.length||busy||speakerMode.startsWith('integrated:')} onChange={e=>chooseModel(e.target.value)}>{!choices.length&&<option value="">利用可能なモデルなし</option>}{choices.map(m=><option key={m.id} value={m.id}>{m.x_meeting.engineLabel} / {m.x_meeting.label}{m.x_meeting.integratedDiarization?'（話者識別内蔵）':''}{m.x_meeting.available===false||m.x_meeting.runtimeReady===false?'（準備が必要）':''}</option>)}</select></label>
  <label>処理方式 <select aria-label="処理方式" disabled={busy||!model} value={device} onChange={e=>chooseDevice(e.target.value)}>{(model?.x_meeting.processingMethods??[]).map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
  </div>
  {model&&<ModelReferenceSpeed model={model}/>}
  <button className="next-step primary-action" disabled={!workflow.allowed[3]||busy} onClick={()=>openStep(3)}>次へ：動画・音声</button>
 </SetupCard>
 <SetupCard number={3} title="動画・音声" summary={file?.name??'未選択'} active={currentStep===3} disabled={busy||connecting||!workflow.allowed[3]&&!job} onOpen={()=>openStep(3)}>
  <MediaDrop disabled={busy} onLoad={load} label="工程1の動画ドロップ領域">{url&&file&&<RecognitionMediaPreview file={file} url={url} player={player} onLoadedMetadata={rangeSeek.loaded} onSeeked={rangeSeek.seeked} onTimeUpdate={rangeSeek.timeUpdate} onError={()=>setError('この形式はブラウザーでプレビューできません。')}/>}</MediaDrop>
  {file&&<button className="next-step primary-action" onClick={()=>openStep(4)}>次へ：文字起こし</button>}
 </SetupCard>
 <SetupCard number={4} title={job&&!busy?"次回の文字起こし":"文字起こし"} summary={upload?'送信中':job?statusLabel:''} active={currentStep===4} disabled={connecting||!workflow.allowed[4]&&!job} onOpen={()=>openStep(4)}>

  <RecognitionRangeControls range={range} disabled={busy||!file} onSeek={rangeSeek.seek}/>{hashing&&<p role="status">元動画を照合中 {Math.round(hashProgress*100)}%</p>}
  <button className="primary-action start-recognition" disabled={!workflow.canStart||connecting||!range.valid||!mediaHash} onClick={()=>void recognize()}>文字起こし開始</button>
 </SetupCard>

 </section>
 {hasResult&&<section className="recognition-output" aria-label="認識結果"><div className="row result-tools"><SaveMenu stage={1} active={active} className="primary-action"/><button disabled={upload||connecting} onClick={()=>void connect()}>サーバーへ再接続</button><button disabled={!job||upload} onClick={()=>void refresh(true)}>サーバーから結果を再取得</button>{canCancel&&<button className="cancel-action" onClick={()=>void cancel()}>認識中止</button>}</div>
 <section className="recognition-progress" aria-label="文字起こしの進捗"><strong aria-live="polite">{upload?`送信 ${Math.round(progress*100)}%`:job?`${statusLabel}${phaseLabel===statusLabel?'':'・'+phaseLabel}・${Math.round(position.fraction*100)}%`:'未実行'}</strong>
 <progress aria-label="認識範囲の進捗" max={1} value={upload?progress:position.fraction}/>
 {job&&<><p>認識済み {formatTime(Math.round(position.done*1000),true)} ／ 対象 {formatTime(Math.round(position.from*1000),true)} → {position.to>position.from?formatTime(Math.round(position.to*1000),true):'長さを確認中'}</p><p>経過 {elapsed.seconds===null?'計測値なし':Math.floor(elapsed.seconds)+'秒'+(elapsed.source==='timestamps'?'（時刻差）':'')}・保存字幕 {Number(job.segmentCount??segments.length)}件・表示取得 {segments.length}件</p>{isActiveJob(job)&&<p aria-label="終了見込み">{estimate?`認識終了見込み（推定） ${new Date(estimate.finishAt).toLocaleTimeString('ja-JP')}・残り約${Math.ceil(estimate.remainingSeconds)}秒`:'終了見込み：進捗が得られるまで算出待ち'}</p>}<p>{String(job.engine??'')} / {String(job.modelId??'')}・{String(job.metadata?.actualDevice??job.metadata?.executionDevice??job.device??'')}</p></>}
 {job&&<ServerMeasurements job={job}/>} {waitingReason?<p role="status" aria-label="資源待ちの理由">{waitingReason}</p>:job?.message&&job.status!=='complete'&&<p>{job.message}</p>}{job?.error&&<p role="alert" className="error">{job.error}</p>}{job&&job.status!=='complete'&&segments.length>0&&<p className="partial-result">途中結果（確定済み字幕のみ）。動画全体の認識完了ではありません。</p>}{pollError&&<p role="alert" className="error">{pollError}</p>}</section>
 {job&&<><div className="row"><h2>字幕</h2><button className={job.status==='complete'?'primary-action':''} disabled={job.status!=='complete'||!segments.length||!sourceMatches} onClick={handoff}>VTT編集</button>{job.status==='complete'&&!sourceMatches&&<>{file&&mediaHash&&!sourceIdentity(job)?<button onClick={()=>void confirmLegacySource()}>元動画の一致を確認</button>:<button onClick={()=>openStep(3)}>元動画・音声をドロップ</button>}{file&&mediaHash&&sourceIdentity(job)&&<span className="error">元動画の内容が認識結果と一致しません。</span>}</>}</div>
 <div className="row"><input aria-label="字幕検索" placeholder="字幕を検索" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/><span>{rows.length}件</span><label><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/>最新の字幕を追う</label></div>
 <div className="row"><button disabled={currentPage===0} onClick={()=>{setFollow(false);setPage(currentPage-1);}}>前の字幕</button><span aria-label="字幕の表示範囲">{rows.length?currentPage*200+1:0}〜{Math.min(rows.length,(currentPage+1)*200)} ／ {rows.length}件</span><button disabled={currentPage>=pages-1} onClick={()=>{setFollow(false);setPage(currentPage+1);}}>次の字幕</button></div>
 <div ref={resultList} className="results"><table><thead><tr><th>時刻</th><th>話者</th><th>本文</th></tr></thead><tbody>{visible.map(s=><tr key={s.id}><td><button onClick={()=>{rangeSeek.preview(s.start);}}>{formatTime(Math.round(s.start*1000),true)}</button></td><td>{s.speaker}</td><td>{s.text}</td></tr>)}</tbody></table></div></>}
 </section>}
 </div></section>;
}
