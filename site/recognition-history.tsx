import {Modal} from './components/editor-ui';
import type {Job} from './speech-client';
import {deletableHistory} from './recognition-history-state';
import {recognitionElapsed,recognitionLabels} from './recognition-state';
const created=(job:Job)=>{const value=Date.parse(String(job.createdAt??''));return Number.isFinite(value)?new Date(value).toLocaleString('ja-JP'):'';};
const elapsed=(job:Job)=>{const value=recognitionElapsed(job,Date.now());return value.seconds===null?'経過 未記録':`経過 ${Math.round(value.seconds)}秒${value.source==='timestamps'?'（時刻差）':''}`;};
type Props={jobs:Job[];total:number;page:number;hasNext:boolean;loading:boolean;error:string;busy:boolean;canDelete:boolean;pendingDelete:Job|null;deleting:boolean;onClose:()=>void;onPage:(page:number)=>void;onSelect:(job:Job)=>void;onDelete:(job:Job)=>void;onCancelDelete:()=>void;onConfirmDelete:()=>void};
export function RecognitionHistory(props:Props){
 const {jobs,total,page,hasNext,loading,error,busy,canDelete,pendingDelete,deleting}=props;
 return <Modal title={pendingDelete?'履歴を削除':'認識履歴'} onClose={()=>{if(!deleting)props.onClose();}} wide>
 {pendingDelete?<div className="history-delete-confirm"><p>{pendingDelete.fileName}</p><p>{String(pendingDelete.engine??'')} / {String(pendingDelete.modelId??'')}</p><p>認識結果・字幕とサーバー保存音声を削除します。このPCで選択した元ファイルは削除しません。</p><div className="row"><button disabled={deleting} onClick={props.onCancelDelete}>戻る</button><button className="danger-action" disabled={busy||deleting||!deletableHistory(pendingDelete,canDelete)} onClick={props.onConfirmDelete}>{deleting?'削除中':'認識結果と保存音声を削除'}</button></div></div>:<>
 <p className="history-count">{total}件</p>
 {!canDelete&&<p className="history-notice">この接続先は履歴削除に未対応です。</p>}
 <div className="history-list">{jobs.length===0&&!loading&&<p>履歴はありません。</p>}{jobs.map(job=>{const labels=recognitionLabels(job);return <article key={job.id} className="history-entry"><div><strong>{String(job.fileName??'名称なし')}</strong><span>{String(job.engine??'')} / {String(job.modelId??'')}・{labels.phaseLabel===labels.statusLabel?labels.statusLabel:labels.statusLabel+'・'+labels.phaseLabel}・{elapsed(job)}</span>{labels.waitingReason&&<span aria-label="資源待ちの理由">{labels.waitingReason}</span>}{created(job)&&<span>{created(job)}</span>}</div><button className="primary-action" disabled={busy||loading} onClick={()=>props.onSelect(job)}>開く</button><button className="danger-action" disabled={busy||loading||!deletableHistory(job,canDelete)} onClick={()=>props.onDelete(job)}>削除</button></article>;})}</div>
 <div className="row history-pages"><button disabled={page===0||loading} onClick={()=>props.onPage(page-1)}>前へ</button><span>{page+1}ページ</span><button disabled={!hasNext||loading} onClick={()=>props.onPage(page+1)}>次へ</button></div>
 </>}{loading&&<p role="status">履歴を取得中</p>}{error&&<p role="alert" className="error">{error}</p>}
 </Modal>;
}
