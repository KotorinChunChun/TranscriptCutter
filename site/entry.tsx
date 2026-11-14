import './app/globals.css';
import {createRoot} from 'react-dom/client';
import {memo,useCallback,useEffect,useLayoutEffect,useState} from 'react';
import Home,{type WorkspaceView} from './app/page';
import {Recognition} from './recognition';
import './browser.css';
import './ui-consistency.css';
import './app/editor-table.css';
import {LauncherSettingsLink} from './launcher-settings';
import {TerminologyDialog} from './components/terminology-dialog';
import {Modal} from './components/editor-ui';
import {initializeWorkspaceStorage,restoreNavigation,saveNavigation,useWorkspaceStorageStatus,installWorkspaceReloadGuard,resetWorkspaceStorage} from './workspace-storage';
const Editor=memo(Home);
function Workbench({onReset}:{onReset:()=>void}){
 const [stage,setStage]=useState<number>(()=>restoreNavigation().stage),[message,setMessage]=useState(''),[activity,setActivity]=useState({busy:false,label:''});
 const [workspaceView,setWorkspaceView]=useState<WorkspaceView>(()=>restoreNavigation().view),[workspaceBusy,setWorkspaceBusy]=useState(false);
 const storage=useWorkspaceStorageStatus();
 const [resetOpen,setResetOpen]=useState(false),[resetting,setResetting]=useState(false),[resetError,setResetError]=useState('');
 const [termsOpen,setTermsOpen]=useState(false);
 const resetBlocked=activity.busy||workspaceBusy||resetting;
 const reset=async()=>{if(resetBlocked)return;setResetting(true);setResetError('');try{await resetWorkspaceStorage();onReset();}catch(error){setResetError(String(error));setResetting(false);}};
 useLayoutEffect(()=>saveNavigation(stage,workspaceView),[stage,workspaceView]);
 useEffect(installWorkspaceReloadGuard,[]);
 const changeWorkspaceView=useCallback((view:WorkspaceView)=>{setWorkspaceView(view);setStage(view==='compare'?2:3);},[]);
 useEffect(()=>{const listener=(e:Event)=>{const d=(e as CustomEvent).detail;setMessage(d.ok?'VTTを引き継ぎました。':d.error);};window.addEventListener('tc-transfer-result',listener);return()=>window.removeEventListener('tc-transfer-result',listener);},[]);
 return <><nav className="workflow"><button type="button" className="workflow-brand" aria-label="TranscriptCutter：作業をリセット" title={resetBlocked?"処理が終わるか中止してからリセットできます":"作業をリセット"} disabled={resetBlocked} onClick={()=>{setResetError('');setResetOpen(true);}}><span className="brand-full">TranscriptCutter</span><span className="brand-short" aria-hidden="true">TC</span></button><LauncherSettingsLink/><div className="stage-toggle" role="group" aria-label="作業切替"><button aria-pressed={stage===1} onClick={()=>setStage(1)}>文字起こし</button><button aria-label="字幕比較" title="字幕比較" aria-pressed={stage===2} disabled={workspaceBusy} onClick={()=>changeWorkspaceView('compare')}><span className="tab-full">字幕比較</span><span className="tab-short" aria-hidden="true">比較</span></button><button aria-label="カット編集" title="カット編集" aria-pressed={stage===3} disabled={workspaceBusy} onClick={()=>changeWorkspaceView(workspaceView==='compare'?'chat':workspaceView)}><span className="tab-full">カット編集</span><span className="tab-short" aria-hidden="true">カット編集</span></button></div><span className="workflow-activity" aria-live="polite">{activity.label}</span><button className="workflow-terminology" aria-label="用語辞書" title="用語辞書" onClick={()=>setTermsOpen(true)}><span className="terms-full">用語辞書</span><span className="terms-short" aria-hidden="true">辞書</span></button><button className="workflow-help" aria-label="使い方" title="使い方" onClick={()=>window.dispatchEvent(new Event('tc-help'))}><span className="help-full">使い方</span><span className="help-short" aria-hidden="true">?</span></button><span className="workflow-version">v0.1.1</span></nav><div className="workflow-pane" hidden={stage!==1}><Recognition active={stage===1} onActivity={setActivity} onTransfer={payload=>{setMessage('VTTを引継ぎ中');window.dispatchEvent(new CustomEvent('tc-transfer',{detail:payload}));}}/></div><div className="workflow-pane" hidden={stage===1}><Editor active={stage!==1} view={workspaceView} onViewChange={changeWorkspaceView} onWorkspaceBusyChange={setWorkspaceBusy}/></div><output className="workflow-status" aria-live="polite">{storage.problem||(storage.pending?"作業を保存中…":activity.busy?activity.label:message)}</output>{termsOpen&&<TerminologyDialog onClose={()=>setTermsOpen(false)}/ >}{resetOpen&&<Modal title="作業をリセット" onClose={()=>{if(!resetting)setResetOpen(false);}} footer={<><button className="button secondary" disabled={resetting} onClick={()=>setResetOpen(false)}>キャンセル</button><button className="button danger" disabled={resetBlocked} onClick={()=>void reset()}>{resetting?"リセット中…":"リセットする"}</button></>}><p>開いている字幕・動画と編集内容、自動復元データをリセットします。</p><p>元ファイル・サーバーの認識履歴・接続設定・導入済みモデルは残ります。</p>{resetError&&<p role="alert" className="field-error">リセットできませんでした。{resetError}</p>}</Modal>}</>;
}
function Application(){const [generation,setGeneration]=useState(0);return <Workbench key={generation} onReset={()=>setGeneration(n=>n+1)}/>;}
document.getElementById('root')!.textContent='前回の作業を開いています…';
void initializeWorkspaceStorage().finally(()=>createRoot(document.getElementById('root')!).render(<Application/>));
