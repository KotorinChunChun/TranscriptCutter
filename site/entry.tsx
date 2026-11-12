import './app/globals.css';
import {createRoot} from 'react-dom/client';
import {memo,useCallback,useEffect,useState} from 'react';
import Home,{type WorkspaceView} from './app/page';
import {Recognition} from './recognition';
import './browser.css';
import {saveProcessingMetrics} from './processing-metrics';
const Editor=memo(Home);
function Workbench(){
 const [stage,setStage]=useState(1),[message,setMessage]=useState(''),[activity,setActivity]=useState({busy:false,label:''});
 const [workspaceView,setWorkspaceView]=useState<WorkspaceView>('chat'),[workspaceBusy,setWorkspaceBusy]=useState(false);
 const changeWorkspaceView=useCallback((view:WorkspaceView)=>{setWorkspaceView(view);setStage(view==='compare'?2:3);},[]);
 useEffect(()=>{const listener=(e:Event)=>{const d=(e as CustomEvent).detail;setMessage(d.ok?'VTTを引き継ぎました。':d.error);};window.addEventListener('tc-transfer-result',listener);return()=>window.removeEventListener('tc-transfer-result',listener);},[]);
 return <><nav className="workflow"><strong>TranscriptCutter</strong><div className="stage-toggle" role="group" aria-label="作業切替"><button aria-pressed={stage===1} onClick={()=>setStage(1)}>文字起こし</button><button aria-pressed={stage===2} disabled={workspaceBusy} onClick={()=>changeWorkspaceView('compare')}>VTT比較</button><button aria-pressed={stage===3} disabled={workspaceBusy} onClick={()=>changeWorkspaceView(workspaceView==='compare'?'chat':workspaceView)}>編集・カット</button></div><span aria-live="polite">{activity.label}</span><button onClick={saveProcessingMetrics}>処理計測を保存</button><span>v0.1.1</span></nav><div className="workflow-pane" hidden={stage!==1}><Recognition active={stage===1} onActivity={setActivity} onTransfer={payload=>{setMessage('VTTを引継ぎ中');window.dispatchEvent(new CustomEvent('tc-transfer',{detail:payload}));}}/></div><div className="workflow-pane" hidden={stage===1}><Editor active={stage!==1} view={workspaceView} onViewChange={changeWorkspaceView} onWorkspaceBusyChange={setWorkspaceBusy}/></div><output className="workflow-status" aria-live="polite">{message}</output></>;
}
createRoot(document.getElementById('root')!).render(<Workbench/>);
