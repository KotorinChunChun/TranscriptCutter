import { Fragment, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Copy, Film, Pause, Pencil, Play, Scissors, Trash2, VolumeX, Volume2 } from "lucide-react";
import { Highlight, PRECISION_LABEL } from "@/components/editor-ui";
import { TranscriptToken, type TranscriptInteractionMode } from "@/components/transcript-token";
import type { ReviewTarget } from "@/components/timeline-review";
import { comparisonDisplayTime } from "@/comparison-layout";
import { formatTime } from "@/src/lib/vtt";
import type { EditorGroup, Line, TextSpan } from "@/src/lib/editor";
import type { PlaybackMode } from "@/src/lib/transcript-playback";

const NO_SPANS: readonly TextSpan[] = [];

type MiddleSeekHandlers = {
  onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onAuxClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

/** Values shared by every utterance row of the transcript. */
export interface TranscriptRowContext {
  groups: EditorGroup[];
  canMergeInView: boolean;
  query: string;
  showTimes: boolean;
  mounted: boolean;
  interactionMode: TranscriptInteractionMode;
  playbackMode: PlaybackMode;
  playbackPlaying: boolean;
  hasMedia: boolean;
  busy: boolean;
  selectedLines: Set<string>;
  deletedTokens: Set<string>;
  deletedSpans: Map<string, readonly TextSpan[]>;
  activeLineIds: Set<string>;
  activeTokenIds: Set<string>;
  shouldIgnoreClick: () => boolean;
  middleSeek: (ms: number) => MiddleSeekHandlers;
  renderLineGap: (line: Line, group: EditorGroup) => ReactNode;
  onSeek: (ms: number) => void;
  onRestoreText: (span: TextSpan) => void;
  onDeleteToken: (id: string) => void;
  onSelectLine: (lineId: string, selected: boolean) => void;
  onDeleteLine: (lineId: string) => void;
  lineMuteState: (line: Line) => "none"|"partial"|"full";
  onToggleLineMute: (line: Line) => void;
  onMerge: (groupId: string, direction: "up" | "down") => void;
  onPlayUtterance: (start: number, end: number, mode: PlaybackMode) => void;
  onReview: (target: ReviewTarget) => void;
  onCorrect: (cueIds: string[]) => void;
  onCopy: (group: EditorGroup) => void;
}

export function TranscriptGroupRow({ ctx, group, groupIndex, palette, playing, transportActive, revealDeleted, ambiguous }: {
  ctx: TranscriptRowContext;
  group: EditorGroup;
  groupIndex: number;
  palette: { color: string; bg: string; bubble: string };
  playing: boolean;
  transportActive: boolean;
  revealDeleted: boolean;
  ambiguous: boolean;
}) {
  const { groups, canMergeInView, showTimes } = ctx;
  const mergeTitle = (direction: "上" | "下", neighbor: EditorGroup | undefined) => !canMergeInView
    ? "検索と話者フィルターを解除すると結合できます"
    : `${direction}の「${neighbor?.speaker ?? "話者不明"}」に合わせて結合`;
  const originalActive = transportActive && ctx.playbackPlaying && ctx.playbackMode === "original";
  const editedActive = transportActive && ctx.playbackPlaying && ctx.playbackMode === "edited";
  return <article className={`message-row${playing ? " is-playing" : ""}`} data-group-id={group.id} style={{ "--speaker-color": palette.color, "--speaker-bg": palette.bg, "--bubble-bg": palette.bubble } as CSSProperties}>
    <div className="message-side">
      <span className="speaker-label"><Highlight text={group.speaker ?? "話者不明"} query={ctx.query}/></span>
      {group.sourceCount > 1 && <span className="merged-count">{group.sourceCount}字幕</span>}
      {ambiguous && groupIndex > 0 && <div className="merge-above">
        <button className="merge-neighbor" disabled={group.deleted || !canMergeInView || groupIndex === 0 || groups[groupIndex - 1]?.deleted} title={mergeTitle("上", groups[groupIndex - 1])} onClick={() => ctx.onMerge(group.id, "up")}><ArrowUp size={13}/>上と結合</button>
      </div>}
    </div>
    <div className="message-content">
      <div className="message-bubble">
        {group.lines.map(line => {
          const lineRemoved = line.tokens.filter(t => t.text.trim()).every(t => ctx.deletedTokens.has(t.id));
          if (lineRemoved && !revealDeleted) return null;
          const selected = ctx.selectedLines.has(line.id),muteState=ctx.lineMuteState(line);
          return <Fragment key={line.id}>
            {ctx.renderLineGap(line, group)}
            <div className={`source-line${selected ? " selected" : ""}${lineRemoved ? " removed" : ""}${ctx.activeLineIds.has(line.id) ? " is-playing" : ""}`} key={line.id} data-line-id={line.id}>
              <label className="line-select" title="この行を選択">
                <input type="checkbox" checked={selected} disabled={lineRemoved} aria-label={`${formatTime(line.start, true)}の行を選択`} onChange={e => ctx.onSelectLine(line.id, e.target.checked)}/>
              </label>
              {showTimes && <button className="line-time" {...ctx.middleSeek(line.start)} onClick={() => ctx.onSeek(line.start)} title={`${formatTime(line.start, true)}–${formatTime(line.end, true)} / ${PRECISION_LABEL[line.precision]}`}>
                {comparisonDisplayTime(line.start)}<span className="line-time-end">{comparisonDisplayTime(line.end)}</span>
              </button>}
              <div className="line-content message-text">
                {!ctx.mounted ? line.text : line.tokens.map(token => <TranscriptToken key={token.id} token={token} spans={ctx.deletedSpans.get(token.cueId) ?? NO_SPANS} showDeleted={revealDeleted} active={ctx.activeTokenIds.has(token.id)} playbackMode={ctx.playbackMode} interactionMode={ctx.interactionMode} canPlay={ctx.hasMedia && !ctx.busy} onSeek={ctx.onSeek} query={ctx.query} shouldIgnoreClick={ctx.shouldIgnoreClick} onRestore={ctx.onRestoreText} onDelete={ctx.onDeleteToken}/>)}
              </div>
              <div className="line-visual-actions">
                <button className="line-thumbnail-button" aria-label={`${formatTime(line.start, true)}の発言のサムネイル`} title="発言のサムネイル" disabled={!ctx.hasMedia || ctx.busy} onClick={() => ctx.onReview({ start: line.start, end: line.end, label: "発言のサムネイル", kind: "speech", thumbnails: true })}><Film size={13}/></button>
                <button className="line-edit-button" aria-label={`${formatTime(line.start, true)}の字幕を修正`} title="この字幕の誤字を修正" onClick={() => ctx.onCorrect([line.cueId])}><Pencil size={13}/></button>
                <button className="line-mute-button" aria-label={`${formatTime(line.start,true)}の行全体${muteState==='full'?'のミュートを解除':'をミュート'}`} aria-pressed={muteState==='full'} title={!ctx.hasMedia?'動画・音声を追加すると使えます':muteState==='full'?'この行のミュートを解除':muteState==='partial'?'一部ミュート中。この行全体をミュート':'この行全体の音声をミュート'} disabled={!ctx.hasMedia||ctx.busy} onClick={()=>ctx.onToggleLineMute(line)}>{muteState==='full'?<Volume2 size={14}/>:<VolumeX size={14}/>}</button>
                <button className="line-delete-button" aria-label={`${formatTime(line.start, true)}の行を削除`} title="この元字幕行を削除" disabled={lineRemoved} onClick={() => ctx.onDeleteLine(line.id)}><Trash2 size={13}/></button>
              </div>
            </div>
          </Fragment>;
        })}
      </div>
      <div className="message-footer"> {ambiguous && groupIndex < groups.length - 1 && <div className="merge-below">
        <button className="merge-neighbor" disabled={group.deleted || !canMergeInView || groupIndex === groups.length - 1 || groups[groupIndex + 1]?.deleted} title={mergeTitle("下", groups[groupIndex + 1])} onClick={() => ctx.onMerge(group.id, "down")}><ArrowDown size={13}/>下と結合</button>
      </div>}
        <details className="message-extra-actions">
          <summary aria-label={`${formatTime(group.start, true)}の発言の操作`}>操作</summary>
          <div className="message-actions">
            {showTimes && <button className="message-time time-seek" {...ctx.middleSeek(group.start)} title={`${formatTime(group.start, true)} → ${formatTime(group.end, true)} / クリックで再生`} onClick={() => ctx.onSeek(group.start)}>{formatTime(group.start)}<span>–</span>{formatTime(group.end)}</button>}
            {ctx.hasMedia && <div className="utterance-playback">
              <button className={originalActive ? "active" : ""} aria-label={`${formatTime(group.start, true)}の発言を削除前で再生`} aria-pressed={originalActive} title="この発言から元メディアを連続再生" disabled={ctx.busy} onClick={() => ctx.onPlayUtterance(group.start, group.end, "original")}>{originalActive ? <Pause size={12}/> : <Play size={12}/>}削除前</button>
              <button className={`edited${editedActive ? " active" : ""}`} aria-label={`${formatTime(group.start, true)}の発言を削除後で再生`} aria-pressed={editedActive} title="この発言からカット区間をスキップして連続再生" disabled={ctx.busy} onClick={() => ctx.onPlayUtterance(group.start, group.end, "edited")}>{editedActive ? <Pause size={12}/> : <Scissors size={12}/>}削除後</button>
            </div>}
            {ambiguous && <span className="ambiguous-badge">{group.canonicalSpeaker ? "複数の話者候補" : "話者不明"}</span>}
            {group.manual && <span className="ambiguous-badge">話者を調整</span>}
            {group.cues.some(cue => "estimatedTiming" in cue && cue.estimatedTiming) && <span className="precision-badge estimated">話者の区切りは推定</span>}
            <button className="button secondary small" aria-label={`${formatTime(group.start, true)}の発言の映像・時間軸`} onClick={() => ctx.onReview({ start: group.start, end: group.end, label: "発話の映像・時間軸", kind: "speech" })}>映像・時間軸</button>
            <button className="message-edit-button" aria-label={`${formatTime(group.start, true)}の発言の誤字を修正`} onClick={() => ctx.onCorrect(group.cueIds)}><Pencil size={12}/>誤字を修正</button>
            <button className="copy-message" aria-label={`${formatTime(group.start)}の発言をコピー`} onClick={() => ctx.onCopy(group)}><Copy size={12}/>コピー</button>
          </div>
        </details>
      </div>
    </div>
  </article>;
}
