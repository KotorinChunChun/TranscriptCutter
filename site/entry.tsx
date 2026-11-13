import './app/globals.css';
import {createRoot} from 'react-dom/client';
import {memo,useCallback,useEffect,useLayoutEffect,useState} from 'react';
import Home,{type WorkspaceView} from './app/page';
import {Recognition} from './recognition';
import './browser.css';
import {saveProcessingMetrics} from './processing-metrics';
import {Modal} from './components/editor-ui';
import {initializeWorkspaceStorage,restoreNavigation,saveNavigation,useWorkspaceStorageStatus,installWorkspaceReloadGuard,resetWorkspaceStorage} from './workspace-storage';
const Editor=memo(Home);
function Workbench({onReset}:{onReset:()=>void}){
 const [stage,setStage]=useState<number>(()=>restoreNavigation().stage),[message,setMessage]=useState(''),[activity,setActivity]=useState({busy:false,label:''});
 const [workspaceView,setWorkspaceView]=useState<WorkspaceView>(()=>restoreNavigation().view),[workspaceBusy,setWorkspaceBusy]=useState(false);
 const storage=useWorkspaceStorageStatus();
 const [resetOpen,setResetOpen]=useState(false),[resetting,setResetting]=useState(false),[resetError,setResetError]=useState('');
 const resetBlocked=activity.busy||workspaceBusy||resetting;
 const reset=async()=>{if(resetBlocked)return;setResetting(true);setResetError('');try{await resetWorkspaceStorage();onReset();}catch(error){setResetError(String(error));setResetting(false);}};
 useLayoutEffect(()=>saveNavigation(stage,workspaceView),[stage,workspaceView]);
 useEffect(installWorkspaceReloadGuard,[]);
 const changeWorkspaceView=useCallback((view:WorkspaceView)=>{setWorkspaceView(view);setStage(view==='compare'?2:3);},[]);
 useEffect(()=>{const listener=(e:Event)=>{const d=(e as CustomEvent).detail;setMessage(d.ok?'VTTを引き継ぎました。':d.error);};window.addEventListener('tc-transfer-result',listener);return()=>window.removeEventListener('tc-transfer-result',listener);},[]);
 return <><nav className="workflow"><button type="button" className="workflow-brand" aria-label="TranscriptCutter：作業をリセット" title={resetBlocked?"処理が終わるか中止してからリセットできます":"作業をリセット"} disabled={resetBlocked} onClick={()=>{setResetError('');setResetOpen(true);}}>TranscriptCutter</button><div className="stage-toggle" role="group" aria-label="作業切替"><button aria-pressed={stage===1} onClick={()=>setStage(1)}>文字起こし</button><button aria-pressed={stage===2} disabled={workspaceBusy} onClick={()=>changeWorkspaceView('compare')}>VTT比較</button><button aria-pressed={stage===3} disabled={workspaceBusy} onClick={()=>changeWorkspaceView(workspaceView==='compare'?'chat':workspaceView)}>編集・カット</button></div><span aria-live="polite">{activity.label}</span><button onClick={saveProcessingMetrics}>処理計測を保存</button><span>v0.1.1</span></nav><div className="workflow-pane" hidden={stage!==1}><Recognition active={stage===1} onActivity={setActivity} onTransfer={payload=>{setMessage('VTTを引継ぎ中');window.dispatchEvent(new CustomEvent('tc-transfer',{detail:payload}));}}/></div><div className="workflow-pane" hidden={stage===1}><Editor active={stage!==1} view={workspaceView} onViewChange={changeWorkspaceView} onWorkspaceBusyChange={setWorkspaceBusy}/></div><output className="workflow-status" aria-live="polite">{storage.problem||(storage.pending?"作業を保存中…":message)}</output>{resetOpen&&<Modal title="作業をリセット" onClose={()=>{if(!resetting)setResetOpen(false);}} footer={<><button className="button secondary" disabled={resetting} onClick={()=>setResetOpen(false)}>キャンセル</button><button className="button danger" disabled={resetBlocked} onClick={()=>void reset()}>{resetting?"リセット中…":"リセットする"}</button></>}><p>開いている字幕・動画と編集内容、自動復元データをリセットします。</p><p>元ファイル・サーバーの認識履歴・接続設定・導入済みモデルは残ります。</p>{resetError&&<p role="alert" className="field-error">リセットできませんでした。{resetError}</p>}</Modal>}</>;
}
function Application(){const [generation,setGeneration]=useState(0);return <Workbench key={generation} onReset={()=>setGeneration(n=>n+1)}/>;}
document.getElementById('root')!.textContent='前回の作業を開いています…';
void initializeWorkspaceStorage().finally(()=>createRoot(document.getElementById('root')!).render(<Application/>));
