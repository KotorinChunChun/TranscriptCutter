import type { Dispatch, SetStateAction } from "react";
import { ArrowDownToLine, AudioLines, Check, Play, Scissors, Search, Trash2 } from "lucide-react";
import { CutRow, Highlight, Modal, PRECISION_LABEL } from "@/components/editor-ui";
import { MediaDrop } from "@/media-drop";
import { formatTime } from "@/src/lib/vtt";
import type { CutRecord, EditorDocument, FillerCandidate } from "@/src/lib/editor";
import type { SilenceRange, SubtitleGap } from "@/src/lib/silence";
import type { TimeRange } from "@/src/lib/timeline-review";

export const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(2)}秒`;

export function RenameSpeakerDialog({ target, value, error, onChange, onSubmit, onClose }: {
  target: string;
  value: string;
  error: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return <Modal title="話者名を一括変更" eyebrow="RENAME SPEAKER" onClose={onClose} footer={<>
    <button className="button secondary" onClick={onClose}>キャンセル</button>
    <button className="button primary" onClick={onSubmit}><Check size={16}/>一括変更</button>
  </>}>
    <p className="modal-help">「{target}」のすべての発言と、複数候補の中の名前を変更します。元の話者IDは保持します。</p>
    <div className="form-field">
      <label className="form-label" htmlFor="speaker-name">表示する名前</label>
      <input autoFocus id="speaker-name" className="select-input speaker-rename-input" value={value} maxLength={80} onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === "Enter") onSubmit(); }}/>
    </div>
    <p className="form-help">名前の変更は字幕の時刻や動画のカットに影響しません。</p>
    {error && <p className="field-error" role="alert">{error}</p>}
  </Modal>;
}

export function FillerDialog({ doc, terms, candidates, chosen, onTermsChange, onScan, onChosenChange, onDelete, onClose }: {
  doc: EditorDocument;
  terms: string;
  candidates: FillerCandidate[];
  chosen: Set<string>;
  onTermsChange: (value: string) => void;
  onScan: () => void;
  onChosenChange: Dispatch<SetStateAction<Set<string>>>;
  onDelete: (chosen: FillerCandidate[]) => void;
  onClose: () => void;
}) {
  const toggle = (id: string, checked: boolean) => onChosenChange(current => {
    const next = new Set(current);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });
  return <Modal title="フィラーを探して削除" eyebrow="REMOVE FILLERS" wide onClose={onClose} footer={<>
    <span className="modal-footer-note">{chosen.size}件を選択</span>
    <button className="button secondary" onClick={onClose}>閉じる</button>
    <button className="button danger" disabled={!chosen.size} onClick={() => onDelete(candidates.filter(c => chosen.has(c.id)))}><Trash2 size={16}/>選択したフィラーを削除</button>
  </>}>
    <div className="form-field">
      <label className="form-label" htmlFor="fillers">対象の言葉（読点またはカンマ区切り）</label>
      <div className="action-group">
        <input id="fillers" className="select-input filler-list-input" value={terms} onChange={e => onTermsChange(e.target.value)}/>
        <button className="button secondary" onClick={onScan}><Search size={15}/>候補を更新</button>
      </div>
    </div>
    <div className="inline-notice">文脈によって必要な言葉もあるため、候補を選んで削除できます。単語の時刻は字幕内の文字位置からの推定です。</div>
    <div className="panel-actions">
      <strong>{candidates.length}件の候補</strong>
      <button className="button ghost small" onClick={() => onChosenChange(new Set(candidates.map(c => c.id)))}>すべて選択</button>
      <button className="button ghost small" onClick={() => onChosenChange(new Set())}>選択解除</button>
    </div>
    <div className="candidate-list">
      {candidates.map(candidate => <label className="candidate-row" key={candidate.id}>
        <input className="candidate-checkbox" type="checkbox" checked={chosen.has(candidate.id)} onChange={e => toggle(candidate.id, e.target.checked)}/>
        <div className="candidate-copy">
          <span className="candidate-time">{formatTime(candidate.start, true)}–{formatTime(candidate.end, true)} <span className="precision-badge estimated">推定</span></span>
          <p><Highlight text={doc.cueById.get(candidate.cueId)?.text ?? candidate.text} query={candidate.term}/></p>
        </div>
      </label>)}
      {!candidates.length && <p className="empty-sentence">対象のフィラーは見つかりませんでした。言葉を変更して再検索できます。</p>}
    </div>
  </Modal>;
}

export type SilenceMode = "gap" | "audio";
export type SilenceCandidate = SilenceRange | SubtitleGap;

export function SilenceDialog(props: {
  mode: SilenceMode;
  threshold: string;
  padding: string;
  volumeThreshold: string;
  mediaFile: File | null;
  mediaExportBusy: boolean;
  detecting: boolean;
  progress: number;
  analysisNote: string;
  error: string;
  candidates: SilenceCandidate[];
  isCut: (candidate: SilenceCandidate) => boolean;
  onModeChange: (mode: SilenceMode) => void;
  onThresholdChange: (value: string) => void;
  onPaddingChange: (value: string) => void;
  onVolumeThresholdChange: (value: string) => void;
  onLoadMedia: (file: File) => void;
  onScan: () => void;
  onStop: () => void;
  onSeek: (ms: number) => void;
  onCut: (candidate: SilenceCandidate) => void;
  onCutAll: () => void;
  onClose: () => void;
}) {
  const { mode, mediaFile, detecting, progress, analysisNote, candidates, isCut } = props;
  return <Modal title="無音・字幕の空白を探す" eyebrow="FIND QUIET MOMENTS" wide onClose={props.onClose} footer={<>
    <button className="button secondary" onClick={props.onClose}>閉じる</button>
    <button className="button danger" disabled={!candidates.some(c => !isCut(c)) || detecting} onClick={props.onCutAll}><Scissors size={16}/>未追加の候補をすべてカット</button>
  </>}>
    <div className="tabs-compact">
      <button className={`mode-button${mode === "gap" ? " active" : ""}`} onClick={() => props.onModeChange("gap")}>VTTから字幕の空白</button>
      <button className={`mode-button${mode === "audio" ? " active" : ""}`} onClick={() => props.onModeChange("audio")}>音声から無音を解析</button>
    </div>
    <p className="modal-help">{mode === "gap"
      ? "字幕の終了から次の開始までの空白を検出します。字幕がない場所にも音声がある可能性があるため、「無音未確認」として記録します。"
      : "追加した動画・音声の音量をブラウザ内で解析します。長時間はPCM WAV、その他の対応形式は5分・32 MBまで解析できます。"}</p>
    {mode === "audio" && <div className="panel-actions">
      <span>{mediaFile ? mediaFile.name : "動画・音声が未選択です"}</span>
      <MediaDrop disabled={props.mediaExportBusy} onLoad={props.onLoadMedia} label="音声解析用メディアのドロップ領域"/>
    </div>}
    <div className="detection-fields">
      <label className="form-field"><span className="form-label">最低の長さ（秒）</span><input className="select-input" type="number" min="0.1" max="600" step="0.1" value={props.threshold} onChange={e => props.onThresholdChange(e.target.value)}/></label>
      <label className="form-field"><span className="form-label">両端に残す時間（ms）</span><input className="select-input" type="number" min="0" max="10000" step="20" value={props.padding} onChange={e => props.onPaddingChange(e.target.value)}/></label>
      {mode === "audio" && <label className="form-field"><span className="form-label">無音とみなす音量</span><select className="select-input" value={props.volumeThreshold} onChange={e => props.onVolumeThresholdChange(e.target.value)}>
        <option value="-50">−50 dBFS</option>
        <option value="-40">−40 dBFS</option>
        <option value="-30">−30 dBFS</option>
      </select></label>}
    </div>
    <div className="panel-actions">
      <button className="button primary" disabled={detecting || (mode === "audio" && !mediaFile)} onClick={props.onScan}><AudioLines size={16}/>{detecting ? "解析中…" : "候補を検出"}</button>
      {detecting && <button className="button secondary" onClick={props.onStop}>中断</button>}
      <span>{detecting ? `${Math.round(progress * 100)}%` : analysisNote ? `${candidates.length}件の候補` : ""}</span>
    </div>
    {detecting && <div className="progress-track" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="無音解析の進捗"><div className="progress-fill" style={{ width: `${progress * 100}%` }}/></div>}
    {analysisNote && <div className="inline-notice">{analysisNote}</div>}
    {props.error && <p className="field-error" role="alert">{props.error}</p>}
    <div className="candidate-list">
      {candidates.map((candidate, index) => {
        const cut = isCut(candidate);
        return <div className="candidate-row" key={`${candidate.start}-${candidate.end}`}>
          <div className="candidate-copy">
            <span className="candidate-time">{formatTime(candidate.start, true)}–{formatTime(candidate.end, true)}</span>
            <p>{formatSeconds(candidate.end - candidate.start)} <span className={`precision-badge ${candidate.precision}`}>{PRECISION_LABEL[candidate.precision]}</span></p>
          </div>
          <button className="icon-button" aria-label={`候補${index + 1}を再生`} title="前後を再生" disabled={!mediaFile} onClick={() => props.onSeek(Math.max(0, candidate.start - 400))}><Play size={15}/></button>
          <button className="button secondary small" disabled={cut} onClick={() => props.onCut(candidate)}>{cut ? <Check size={14}/> : <Scissors size={14}/>}{cut ? "追加済み" : "カット"}</button>
        </div>;
      })}
    </div>
  </Modal>;
}

export function CutsDialog({ cuts, rangeCount, removedMs, tailNotice, automaticTail, mediaDuration, hasMedia, onSeek, onUpdate, onRestore, onDownload, onClose }: {
  cuts: readonly CutRecord[];
  rangeCount: number;
  removedMs: number;
  tailNotice: string;
  automaticTail: TimeRange | null;
  mediaDuration: number | undefined;
  hasMedia: boolean;
  onSeek: (ms: number) => void;
  onUpdate: (cut: CutRecord, start: number, end: number) => void;
  onRestore: (cut: CutRecord) => void;
  onDownload: (format: "json" | "csv") => void;
  onClose: () => void;
}) {
  return <Modal title="カット記録を確認" eyebrow="ORIGINAL VIDEO TIMESTAMPS" wide onClose={onClose} footer={<>
    <button className="button secondary" disabled={mediaDuration === undefined} title={mediaDuration === undefined ? "元動画を追加すると、末尾の終了時刻を含めてCSVに保存できます" : undefined} onClick={() => onDownload("csv")}><ArrowDownToLine size={16}/>CSV</button>
    <button className="button primary" onClick={() => onDownload("json")}><ArrowDownToLine size={16}/>カット記録をJSONで保存</button>
  </>}>
    <div className="export-summary">
      <div className="export-stat"><span>編集操作</span><strong>{cuts.length}<small>件</small></strong></div>
      <div className="export-stat"><span>重複を統合した区間</span><strong>{rangeCount}<small>件</small></strong></div>
      <div className="export-stat"><span>削除する長さ</span><strong>{(removedMs / 1000).toFixed(2)}<small>秒</small></strong></div>
    </div>
    <div className="inline-notice">時刻はすべて元動画の先頭が基準です。単語・フィラーの時刻は推定です。動画で確認し、開始・終了を修正できます。時刻の修正はカット範囲に適用し、削除した文字の範囲は保持します。</div>
    <p className="form-help">{tailNotice}{mediaDuration === undefined && " JSONは終端指定を保存できます。CSVには元動画の長さが必要です。"}</p>
    <div className="cut-list">
      {[...cuts].sort((a, b) => a.start - b.start).map(cut => <CutRow key={cut.id} cut={cut} canPlay={hasMedia} onSeek={onSeek} onUpdate={(start, end) => onUpdate(cut, start, end)} onRestore={() => onRestore(cut)}/>)}
      {automaticTail && <article className="cut-item automatic-tail-cut" aria-label="VTT終了後の自動カット">
        <div className="cut-item-heading"><span className="cut-kind">VTT終了後</span><span className="precision-badge cue">自動カット</span><span className="cut-duration">{formatSeconds(automaticTail.end - automaticTail.start)}</span></div>
        <p className="candidate-time">{formatTime(automaticTail.start, true)} → {formatTime(automaticTail.end, true)}</p>
        <p className="form-help">VTTに存在しない末尾を切り捨てます。動画の長さに合わせて自動更新します。</p>
        <button className="button ghost small" disabled={!hasMedia} onClick={() => onSeek(Math.max(0, automaticTail.start - 1000))}><Play size={13}/>カット位置を確認</button>
      </article>}
      {!cuts.length && !automaticTail && <div className="empty-state"><Scissors size={30}/><h3>手動のカットはありません</h3><p>単語・行を削除すると、ここに開始時刻と終了時刻が記録されます。字幕のない末尾も標準では保持します。</p></div>}
    </div>
  </Modal>;
}
