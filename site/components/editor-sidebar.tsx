import { AudioLines, FileText, Pencil, Scissors, Users, X } from "lucide-react";
import { SPEAKER_PALETTE } from "@/components/editor-ui";
import { formatSeconds } from "@/components/editor-dialogs";
import { PlaybackRateInput } from "@/components/playback-rate-input";
import { isAudioOnlyFile } from "@/src/lib/media-file";
import { formatTime } from "@/src/lib/vtt";
import type { TimeRange } from "@/src/lib/timeline-review";

export interface SpeakerCount { id: string; label: string; count: number }

/** Media player, cut overview and speaker filters. Hidden behind a menu button on narrow screens. */
export function EditorSidebar(props: {
  open: boolean;
  onClose: () => void;
  /** True while editing a transcript (not in the comparison view). */
  showTranscriptInfo: boolean;
  fileName: string;
  mediaFile: File | null;
  mediaUrl: string;
  mediaDuration: number | undefined;
  busy: boolean;
  playbackRate: number;
  /** Returns false when the rate was rejected. */
  onPlaybackRate: (rate: number) => boolean;
  onInvalidRate: (message: string) => void;
  onMediaElement: (node: HTMLMediaElement | null) => void;
  onMediaDuration: (ms: number) => void;
  onCloseMedia: () => void;
  automaticTail: TimeRange | null;
  tailNotice: string;
  transcriptDurationMs: number;
  cutRanges: readonly TimeRange[];
  timelineDurationMs: number;
  removedMs: number;
  onSeek: (ms: number) => void;
  speakerCount: number;
  speakers: SpeakerCount[];
  activeGroupCount: number;
  unknownCount: number | null;
  filter: string;
  onFilterAll: () => void;
  onFilterSpeaker: (speaker: string) => void;
  onFilterUnknown: () => void;
  onRename: (speaker: string) => void;
}) {
  const { mediaFile, mediaDuration, showTranscriptInfo, cutRanges, filter } = props;
  const loaded = (element: HTMLMediaElement) => {
    if (Number.isFinite(element.duration)) props.onMediaDuration(Math.round(element.duration * 1000));
  };
  return <aside className={`sidebar resizable-sidebar${props.open ? " mobile-open" : ""}`} aria-label="動画・話者の設定" aria-hidden={!props.open} inert={!props.open}>
    <button className="icon-button sidebar-close" aria-label="サイドバーを閉じる" onClick={props.onClose}><X size={20}/></button>
    <div className="sidebar-section sidebar-file-section">
      {showTranscriptInfo && <span className="sidebar-file-name" title={props.fileName}><FileText size={13}/>{props.fileName}</span>}
      <section className="media-card sidebar-media" aria-label="動画・音声">
        {mediaFile ? <div className="media-meta">
          <AudioLines size={16}/>
          <div><strong title={mediaFile.name}>{mediaFile.name}</strong><p>{mediaDuration !== undefined ? formatTime(mediaDuration) : "読み込み中…"}</p></div>
          <button className="icon-button" disabled={props.busy} aria-label="動画・音声を閉じる" onClick={props.onCloseMedia}><X size={15}/></button>
        </div> : null}
        {props.mediaUrl && (mediaFile && isAudioOnlyFile(mediaFile)
          ? <audio className="media-player" controls src={props.mediaUrl} ref={props.onMediaElement} onLoadedMetadata={e => loaded(e.currentTarget)}/>
          : <video className="media-player" controls preload="metadata" src={props.mediaUrl} ref={props.onMediaElement} onLoadedMetadata={e => loaded(e.currentTarget)}/>)}
        {mediaFile && <PlaybackRateInput value={props.playbackRate} disabled={props.busy} onChange={props.onPlaybackRate} onInvalid={props.onInvalidRate}/>}
        {showTranscriptInfo && mediaFile && props.automaticTail && <p className="form-help transcript-end-notice" title={props.tailNotice}><Scissors size={12}/>末尾 {formatSeconds(props.automaticTail.end - props.automaticTail.start)} を自動カット</p>}
        {showTranscriptInfo && mediaDuration !== undefined && mediaDuration + 1000 < props.transcriptDurationMs && <p className="inline-notice">メディアが字幕より短くなっています。</p>}
        {showTranscriptInfo && cutRanges.length > 0 && mediaFile && <>
          <div className="timeline-strip" aria-label="元動画上のカット区間">
            {cutRanges.map((range, index) => <button key={index} className="timeline-cut" title={`${formatTime(range.start, true)}–${formatTime(range.end, true)}`} aria-label={`カット区間 ${formatTime(range.start, true)}から${formatTime(range.end, true)}`} style={{ left: `${range.start / props.timelineDurationMs * 100}%`, width: `${Math.max(0.2, (range.end - range.start) / props.timelineDurationMs * 100)}%` }} onClick={() => props.onSeek(range.start)}/>)}
          </div>
          <div className="cut-summary-bar"><span>{cutRanges.length}区間をカット</span><span>{formatSeconds(props.removedMs)}</span></div>
        </>}
      </section>
    </div>
    {showTranscriptInfo && <div className="sidebar-section speaker-section">
      <p className="section-label">話者<span>{props.speakerCount}</span></p>
      <div className="speaker-list">
        <button className={`speaker-filter${filter === "all" ? " active" : ""}`} aria-pressed={filter === "all"} onClick={props.onFilterAll}><Users size={16}/><span className="speaker-name">すべての話者</span><span className="speaker-count">{props.activeGroupCount}</span></button>
        {props.speakers.map((speaker, index) => <div className={`speaker-filter-row${filter === speaker.id ? " active" : ""}`} key={speaker.id}>
          <button className={`speaker-filter${filter === speaker.id ? " active" : ""}`} aria-pressed={filter === speaker.id} onClick={() => props.onFilterSpeaker(speaker.id)} onDoubleClick={() => props.onRename(speaker.id)} title="ダブルクリックで名前を一括変更"><span className="speaker-dot" style={{ background: SPEAKER_PALETTE[index % SPEAKER_PALETTE.length].color }}/><span className="speaker-name">{speaker.label}</span><span className="speaker-count">{speaker.count}</span></button>
          <button className="inline-rename-button" aria-label={`${speaker.label}の名前を一括変更`} onClick={() => props.onRename(speaker.id)}><Pencil size={12}/></button>
        </div>)}
        {props.unknownCount !== null && <button className={`speaker-filter${filter === "unknown" ? " active" : ""}`} onClick={props.onFilterUnknown}><span className="speaker-dot" style={{ background: "#98a3a1" }}/><span className="speaker-name">話者不明</span><span className="speaker-count">{props.unknownCount}</span></button>}
      </div>
    </div>}
  </aside>;
}
