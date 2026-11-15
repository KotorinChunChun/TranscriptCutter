import {useState} from 'react';
import {Modal} from './editor-ui';
export function RestorePointsDialog({points,busy,onSave,onRestore,onClose}:{points:{key:string;name:string;createdAt:number}[];busy:boolean;onSave:(name:string)=>Promise<void>;onRestore:(key:string)=>void;onClose:()=>void}){
 const [name,setName]=useState('編集の保存ポイント'),[error,setError]=useState('');
 return <Modal title="保存ポイント" wide onClose={()=>{if(!busy)onClose();}} footer={<button className="button secondary" disabled={busy} onClick={onClose}>閉じる</button>}>
  <div className="review-panel-tools"><label>名前<input aria-label="保存ポイント名" maxLength={120} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label><button className="button primary" disabled={busy||!name.trim()} onClick={()=>{setError('');void onSave(name).catch(e=>setError(String(e)));}}>現在の状態を保存</button></div>
  {error&&<p role="alert">{error}</p>}
  <div className="review-panel-list">{points.map(p=><div className="review-panel-item" key={p.key}><span><time>{new Date(p.createdAt).toLocaleString('ja-JP')}</time>　<strong>{p.name}</strong></span><button className="button secondary" disabled={busy} onClick={()=>onRestore(p.key)}>この状態に戻す</button></div>)}</div>
 </Modal>;
}
