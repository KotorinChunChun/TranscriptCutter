import {useState} from 'react';
import {Modal} from './editor-ui';
export function WordTimingInput({onLoad,onClose}:{onLoad:(value:unknown)=>void;onClose:()=>void}){
 const [text,setText]=useState(''),[error,setError]=useState('');
 const load=(raw:string)=>{try{onLoad(JSON.parse(raw));onClose();}catch(e){setError(e instanceof Error?e.message:String(e));}};
 return <Modal title="単語時刻JSONを追加" onClose={onClose} footer={<><button className="button secondary" onClick={onClose}>閉じる</button><button className="button primary" disabled={!text.trim()} onClick={()=>load(text)}>原文に時刻候補を追加</button></>}>
 <div className="file-drop-zone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();e.stopPropagation();const files=Array.from(e.dataTransfer.files);if(files.length!==1||files[0].size>20*1024*1024){setError('20 MB以下の単語時刻JSONを1つドロップしてください。');return;}void files[0].text().then(load).catch(e=>setError(String(e)));}}>単語時刻JSONをドロップ</div>
 <textarea aria-label="単語時刻JSON" value={text} onChange={e=>setText(e.target.value)} rows={7} placeholder="JSONを貼り付け" style={{width:'100%',boxSizing:'border-box'}}/>
 {error&&<p role="alert" className="field-error">{error}</p>}
 </Modal>;
}
