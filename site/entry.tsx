import './app/globals.css';
import {createRoot} from 'react-dom/client';
import {memo,useEffect,useState} from 'react';
import Home from './app/page';
import {Recognition} from './recognition';
import './browser.css';
import {saveProcessingMetrics} from './processing-metrics';
const Editor=memo(Home);
function Workbench(){
 const [stage,setStage]=useState(1),[message,setMessage]=useState(''),[activity,setActivity]=useState({busy:false,label:''});
 useEffect(()=>{const listener=(e:Event)=>{const d=(e as CustomEvent).detail;setMessage(d.ok?'工程2へ追加しました。':d.error);};window.addEventListener('tc-transfer-result',listener);return()=>window.removeEventListener('tc-transfer-result',listener);},[]);
 return <><nav className="workflow"><strong>TranscriptCutter</strong><button aria-pressed={stage===1} onClick={()=>setStage(1)}>工程1 文字起こし</button><button aria-pressed={stage===2} onClick={()=>setStage(2)}>工程2 VTT統合・編集・カット</button><span aria-live="polite">{activity.label}</span><button onClick={saveProcessingMetrics}>処理計測を保存</button><span>v0.1.1</span></nav><div className="workflow-pane" hidden={stage!==1}><Recognition active={stage===1} onActivity={setActivity} onTransfer={payload=>{setStage(2);setMessage('工程2へ追加中');window.dispatchEvent(new CustomEvent('tc-transfer',{detail:payload}));}}/></div><div className="workflow-pane" hidden={stage!==2}><Editor active={stage===2}/></div><output className="workflow-status" aria-live="polite">{message}</output></>;
}
createRoot(document.getElementById('root')!).render(<Workbench/>);
