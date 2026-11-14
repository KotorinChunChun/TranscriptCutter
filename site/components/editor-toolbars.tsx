import type { RefObject } from "react";
import { AudioLines, FileCode2, Menu, MessagesSquare, Pause, Play, Redo2, Scissors, Search, Settings2, Undo2, WandSparkles, X } from "lucide-react";
import { AddMenu } from "@/components/add-menu";
import type { TranscriptInteractionMode } from "@/components/transcript-token";
import { comparisonDisplayTime } from "@/comparison-layout";
import { SaveMenu } from "@/save-menu";
import { formatTime } from "@/src/lib/vtt";
import type { PlaybackMode } from "@/src/lib/transcript-playback";

/** Adding subtitles, cleanup tools, undo/redo and the cut/mute counters. */
export function EditorToolbar(props: {
  active: boolean;
  hasTranscript: boolean;
  showMenuButton: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  addDisabled: boolean;
  onPasteVtt: () => void;
  onWordTiming: () => void;
  onFillers: () => void;
  onSilence: () => void;
  cleanupDisabled: boolean;
  onCleanup: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  cutCount: number;
  muteCount: number;
  onCuts: () => void;
  onMutes: () => void;
}) {
  const { hasTranscript } = props;
  return <div className="editor-toolbar" role="toolbar" aria-label="編集操作">
    <div className="action-group">
      {props.showMenuButton && <button className="button secondary mobile-menu-button" aria-label="動画・話者の設定" aria-expanded={props.sidebarOpen} onClick={props.onToggleSidebar}><Menu size={20}/>動画・話者</button>}
      <AddMenu disabled={props.addDisabled} label="字幕を追加" items={[
        { label: "VTTを貼り付け", run: props.onPasteVtt },
        { label: "単語時刻JSONを追加", disabled: !hasTranscript, run: props.onWordTiming },
      ]}/>
      {hasTranscript && <>
        <button className="button secondary small" onClick={props.onFillers}><WandSparkles size={16}/>フィラーを削除</button>
        <button className="button secondary small" onClick={props.onSilence}><AudioLines size={16}/>無音・空白を探す</button>
        <button className="button secondary" disabled={props.cleanupDisabled} onClick={props.onCleanup}>字幕を整える</button>
      </>}
    </div>
    <div className="undo-group">
      {hasTranscript && <>
        <button className="icon-button" aria-label="元に戻す" title="元に戻す（Ctrl Z）" disabled={!props.canUndo} onClick={props.onUndo}><Undo2 size={17}/></button>
        <button className="icon-button" aria-label="やり直す" title="やり直す（Ctrl Shift Z）" disabled={!props.canRedo} onClick={props.onRedo}><Redo2 size={17}/></button>
        <button className="button ghost small" onClick={props.onCuts}><Scissors size={14}/>カット記録 {props.cutCount}</button>
        <button className="button ghost small" onClick={props.onMutes}>ミュート {props.muteCount}</button>
      </>}
      <SaveMenu stage={3} active={props.active} className="button primary"/>
    </div>
  </div>;
}

/** Continuous playback controls linked to the transcript. */
export function PlaybackStrip(props: {
  playing: boolean;
  waiting: boolean;
  mode: PlaybackMode;
  currentMs: number;
  totalMs: number;
  busy: boolean;
  muted: boolean;
  activeGroup: { speaker: string | null } | undefined;
  playheadVisible: boolean;
  followPlayback: boolean;
  onFollowPlayback: (follow: boolean) => void;
  onToggle: () => void;
  onScrub: (ms: number) => void;
}) {
  const { playing, mode, currentMs, totalMs, activeGroup } = props;
  return <div className="playback-strip" role="region" aria-label="字幕と連動した再生">
    <div className="playback-status">
      <button className="icon-button" aria-label={playing ? "連続再生を一時停止" : "現在位置から連続再生"} disabled={props.busy} onClick={props.onToggle}>{playing ? <Pause size={16}/> : <Play size={16}/>}</button>
      <span className={`playback-source-badge${mode === "edited" ? " edited" : ""}`}>{mode === "edited" ? "削除後" : "削除前"}</span>
      <time className="playback-time" title={formatTime(currentMs, true)}>{comparisonDisplayTime(currentMs)}</time>
      <input type="range" aria-label="編集のシークバー" min={0} max={Math.max(1, totalMs)} step={1} value={Math.min(currentMs, totalMs)} disabled={props.busy} onChange={event => props.onScrub(Number(event.target.value))}/>
      <time title={formatTime(totalMs, true)}>{comparisonDisplayTime(totalMs)}</time>
      <span>
        {props.muted && <b className="mute-status">ミュート中 </b>}
        {props.waiting ? "読み込み中…" : activeGroup ? `${activeGroup.speaker ?? "話者不明"}${props.playheadVisible ? "" : "（表示対象外）"}` : playing ? "字幕のない区間" : "停止中"}
      </span>
    </div>
    <label className="playback-follow"><input type="checkbox" checked={props.followPlayback} onChange={e => props.onFollowPlayback(e.target.checked)}/>再生箇所を追う</label>
  </div>;
}

/** Click mode, view tabs, reading toggles, speaker filter chip and search. */
export function WorkspaceToolbar(props: {
  hasMedia: boolean;
  busy: boolean;
  interactionMode: TranscriptInteractionMode;
  onInteractionMode: (mode: TranscriptInteractionMode) => void;
  view: string;
  onView: (view: "chat" | "vtt") => void;
  showDeleted: boolean;
  onShowDeleted: (value: boolean) => void;
  largeText: boolean;
  onLargeText: (value: boolean) => void;
  merging: boolean;
  onMerge: () => void;
  filterLabel: string | null;
  onClearFilter: () => void;
  searchInput: RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (query: string) => void;
  onClearQuery: () => void;
  onSettings: () => void;
}) {
  const { interactionMode, view, showDeleted, largeText, query } = props;
  return <div className="workspace-toolbar">
    <div className="editor-view-controls">
      <div className="interaction-mode-switch" role="group" aria-label="本文のクリック操作">
        <button className={`mode-button${interactionMode === "play" ? " active" : ""}`} aria-pressed={interactionMode === "play"} disabled={!props.hasMedia || props.busy} title={props.hasMedia ? "左クリックでその位置から再生。ドラッグで範囲選択" : "動画・音声を追加すると使えます"} onClick={() => props.onInteractionMode("play")}><Play size={15}/>再生モード</button>
        <button className={`mode-button${interactionMode === "delete" ? " active" : ""}`} aria-pressed={interactionMode === "delete"} title="左クリックで単語を削除。中クリックでその位置から再生" onClick={() => props.onInteractionMode("delete")}><Scissors size={15}/>削除モード</button>
      </div>
      <div className="view-tabs" role="tablist" aria-label="表示形式">
        <button className={`view-tab${view === "chat" ? " active" : ""}`} role="tab" aria-selected={view === "chat"} onClick={() => props.onView("chat")}><MessagesSquare size={17}/>会話</button>
        <button className={`view-tab${view === "vtt" ? " active" : ""}`} role="tab" aria-selected={view === "vtt"} onClick={() => props.onView("vtt")}><FileCode2 size={17}/>VTT</button>
      </div>
      <div className="reading-controls">
        <button type="button" className={"reading-toggle" + (showDeleted ? " active" : "")} role="switch" aria-label="削除箇所を表示" aria-checked={showDeleted} onClick={() => props.onShowDeleted(!showDeleted)}>削除箇所<span className={"toggle" + (showDeleted ? " checked" : "")} aria-hidden="true"><span className="toggle-knob"/></span></button>
        <button type="button" className={"reading-toggle text-size-button" + (largeText ? " active" : "")} aria-label="文字を大きくする" role="switch" aria-checked={largeText} onClick={() => props.onLargeText(!largeText)}>Aa<span className={"toggle" + (largeText ? " checked" : "")} aria-hidden="true"><span className="toggle-knob"/></span></button>
      </div>
      {!props.merging && <button className="button secondary small" onClick={props.onMerge}>連続発言を結合</button>}
    </div>
    <div className="toolbar-right">
      {props.filterLabel !== null && <button className="filter-chip" onClick={props.onClearFilter}>{props.filterLabel}<X size={12}/></button>}
      <label className="search-field">
        <Search size={16}/>
        <input ref={props.searchInput} aria-label="会話を検索" placeholder="会話を検索…" value={query} onChange={e => props.onQuery(e.target.value)}/>
        {query ? <button className="icon-button" aria-label="検索をクリア" onClick={props.onClearQuery}><X size={14}/></button> : <span className="key-hint">Ctrl K</span>}
      </label>
      <button className="icon-button" aria-label="表示と結合の設定" onClick={props.onSettings}><Settings2 size={18}/></button>
    </div>
  </div>;
}
