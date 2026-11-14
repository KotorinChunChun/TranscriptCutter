import {Modal} from './editor-ui';
import {formatTime} from '../src/lib/vtt';
import type {MuteRange} from '../src/lib/audio-mute';
export function MuteDialog({ranges,onRemove,onSeek,onClose}:{ranges:readonly MuteRange[];onRemove:(range:MuteRange)=>void;onSeek:(ms:number)=>void;onClose:()=>void}){
 return <Modal title="音声のミュート区間" onClose={onClose} footer={<button className="button secondary" onClick={onClose}>閉じる</button>}>
  {!ranges.length?<p>ミュート区間はありません。</p>:ranges.map(r=><div className="panel-actions" key={r.start}><button className="button secondary" onClick={()=>onSeek(r.start)}>{formatTime(r.start,true)} → {formatTime(r.end,true)}</button><button className="button secondary" onClick={()=>onRemove(r)}>解除</button></div>)}
 </Modal>;
}
