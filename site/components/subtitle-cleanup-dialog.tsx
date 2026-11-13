import {useState} from 'react';
import {Modal} from './editor-ui';
import {cleanByRules} from '../src/lib/subtitle-cleanup';
import type {ComparisonSource} from '../src/lib/comparison';
import {useTermRules} from '../terminology-store';
export function SubtitleCleanupDialog({sources,onGenerated,onClose}:{sources:ComparisonSource[];onGenerated:(source:ComparisonSource)=>void;onClose:()=>void}){
 const rules=useTermRules(),[error,setError]=useState(''),[fillers,setFillers]=useState('えっと、えーと、えーっと、えー、あの、まあ'),[removeFillers,setRemoveFillers]=useState(true),[base,setBase]=useState(sources[0]?.id??'');
 const generate=()=>{try{const source=sources.find(s=>s.id===base);if(!source)throw Error('元字幕を選んでください。');const result=cleanByRules(source.cues,rules,removeFillers?fillers.split(/[、,\n]/).map(s=>s.trim()).filter(Boolean):[]);if(!result.cues.length)throw Error('整理後の字幕が空です。削除するフィラーを調整してください。');onGenerated({id:`cleanup-${crypto.randomUUID()}`,name:'ルール整理案',fileName:'ルール整理案.vtt',cues:result.cues,warnings:[`ルール整理 ${result.changes}箇所。元の字幕時刻を保持しています。`],generated:true});}catch(e){setError(String(e));}};
 return <Modal title="字幕を整える" wide onClose={onClose} footer={<><button className="button secondary" onClick={onClose}>キャンセル</button><button className="button primary" onClick={generate}>整理案を比較に追加</button></>}>
 <label className="form-field">方式<select className="select-input" aria-label="字幕整理方式"><option>ルール置換</option></select></label>
 <label className="form-field">元字幕<select className="select-input" aria-label="整理する元字幕" value={base} onChange={e=>setBase(e.target.value)}>{sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
 <label><input type="checkbox" checked={removeFillers} onChange={e=>setRemoveFillers(e.target.checked)}/>フィラーを削除</label><input className="select-input" aria-label="整理時に削除するフィラー" value={fillers} disabled={!removeFillers} onChange={e=>setFillers(e.target.value)}/><p>有効な用語 {rules.filter(r=>r.enabled&&r.logic).length}件</p>{error&&<p role="alert" className="field-error">{error}</p>}
 </Modal>;
}
