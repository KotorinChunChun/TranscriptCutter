"use client";

import { memo, useMemo, type KeyboardEvent } from "react";
import { Highlight } from "@/components/editor-ui";
import { formatTime } from "@/src/lib/vtt";
import type { TextSpan, Token } from "@/src/lib/editor";

export type TranscriptInteractionMode = "delete" | "play";

export type TranscriptTokenProps = {
  token: Token;
  spans: readonly TextSpan[];
  showDeleted: boolean;
  interactionMode: TranscriptInteractionMode;
  canPlay: boolean;
  query: string;
  /** A visual state only: source offsets and text nodes stay unchanged. */
  active?: boolean;
  playbackMode?: "original" | "edited";
  onDelete: (tokenId: string) => void;
  onRestore: (span: TextSpan) => void;
  onSeek: (milliseconds: number) => void;
  shouldIgnoreClick: () => boolean;
};

type SourceChunk = TextSpan & { deleted: boolean; text: string };

/** Each returned chunk still maps one-to-one to the original UTF-16 text. */
function sourceChunks(token: Token, spans: readonly TextSpan[]): SourceChunk[] {
  const end = Math.min(token.to, token.from + token.text.length);
  if (end <= token.from) return [];
  const deleted = spans
    .filter(span => span.cueId === token.cueId && span.to > token.from && span.from < end)
    .map(span => ({ from: Math.max(token.from, span.from), to: Math.min(end, span.to) }))
    .filter(span => span.to > span.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: { from: number; to: number }[] = [];
  for (const span of deleted) {
    const previous = merged[merged.length - 1];
    if (previous && span.from <= previous.to) previous.to = Math.max(previous.to, span.to);
    else merged.push({ ...span });
  }

  const chunks: SourceChunk[] = [];
  const append = (from: number, to: number, isDeleted: boolean) => {
    if (to <= from) return;
    const text = token.text.slice(from - token.from, to - token.from);
    // Source rows already supply the visual line break. Newline-only leaves
    // are omitted; the DOM selection mapper bridges their original offsets.
    // Split before omitting so a space adjacent to a newline stays mapped.
    let cursor = 0;
    for (const newline of text.matchAll(/[\r\n]+/g)) {
      if (newline.index! > cursor) {
        chunks.push({ cueId: token.cueId, from: from + cursor, to: from + newline.index!, deleted: isDeleted, text: text.slice(cursor, newline.index!) });
      }
      cursor = newline.index! + newline[0].length;
    }
    if (cursor < text.length) chunks.push({ cueId: token.cueId, from: from + cursor, to, deleted: isDeleted, text: text.slice(cursor) });
  };
  let cursor = token.from;
  for (const span of merged) {
    append(cursor, span.from, false);
    append(span.from, span.to, true);
    cursor = span.to;
  }
  append(cursor, end, false);
  return chunks;
}

function activateWithKeyboard(event: KeyboardEvent<HTMLSpanElement>, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  // Holding a key must not restore a piece and then delete its replacement.
  if (!event.repeat) action();
}

export const TranscriptToken = memo(function TranscriptToken({ token, spans, showDeleted, interactionMode, canPlay, query, active = false, playbackMode = "original", onDelete, onRestore, onSeek, shouldIgnoreClick }: TranscriptTokenProps) {
  const chunks = useMemo(() => sourceChunks(token, spans), [token, spans]);
  const hasDeletedChunk = chunks.some(chunk => chunk.deleted);
  const wordTitle = `クリックでこの単語「${token.text.replace(/[\r\n]+/g, "")}」${hasDeletedChunk ? "の残り" : ""}を削除 · カット時刻は単語時刻を優先し、未対応部分は推定`;

  return <>{chunks.map(chunk => {
    if (chunk.deleted && !showDeleted) return null;
    const restoreSpan: TextSpan = { cueId: chunk.cueId, from: chunk.from, to: chunk.to };
    const deleting = interactionMode === "delete";
    const canDelete = !chunk.deleted && deleting && !!chunk.text.trim();
    const canRestore = chunk.deleted && deleting;
    const canSeekWithLeftClick = !deleting && canPlay;
    const interactive = canRestore || canDelete || canSeekWithLeftClick;
    const chunkStart = Math.round(token.start + Math.max(0, token.end - token.start) * Math.min(1, Math.max(0, chunk.from - token.from) / Math.max(1, token.to - token.from)));
    const seekTitle = `推定 ${formatTime(chunkStart, true)} から再生`;
    const title = canSeekWithLeftClick
      ? `クリックで${seekTitle}${chunk.deleted ? " · 右クリックで操作" : ""}`
      : canRestore
        ? `クリックで「${chunk.text}」を復元 · 右クリックで操作`
        : canDelete
          ? wordTitle
          : !deleting
            ? `動画・音声を追加すると再生できます${chunk.deleted ? " · 右クリックで操作" : ""}`
            : "";
    const activate = () => {
      if (shouldIgnoreClick()) return;
      if (canSeekWithLeftClick) onSeek(chunkStart);
      else if (canRestore) onRestore(restoreSpan);
      else if (canDelete) onDelete(token.id);
    };
    const chunkActive = active && (!chunk.deleted || playbackMode !== "edited");
    return <span
      key={`${token.id}:${chunk.from}:${chunk.to}:${chunk.deleted ? "deleted" : "live"}`}
      className={`${chunk.deleted ? "deleted-token restorable-token" : canDelete ? "word-token" : "transcript-text"}${canSeekWithLeftClick ? " playable-token" : ""}${chunkActive ? " playback-word" : ""}`}
      data-token-id={token.id}
      data-transcript-span=""
      data-cue-id={chunk.cueId}
      data-text-from={chunk.from}
      data-text-to={chunk.to}
      data-text-deleted={chunk.deleted ? "true" : "false"}
      data-playback-start-ms={chunkStart}
      data-interaction-mode={interactionMode}
      data-playback-active={chunkActive ? "true" : undefined}
      data-playback-mode={chunkActive ? playbackMode : undefined}
      aria-current={chunkActive ? "true" : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={[title, canPlay ? `中クリックで${seekTitle}` : ""].filter(Boolean).join(" · ") || undefined}
      aria-label={canSeekWithLeftClick ? `「${chunk.text}」から再生` : canRestore ? `「${chunk.text}」を復元` : canDelete ? `この単語「${token.text.replace(/[\r\n]+/g, "")}」${hasDeletedChunk ? "の残り" : ""}を削除` : undefined}
      onPointerDown={canPlay ? event => {
        if (event.button !== 1) return;
        // Suppress native autoscroll/paste without affecting left-button ranges.
        event.preventDefault();
        event.stopPropagation();
      } : undefined}
      onMouseDown={canPlay ? event => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
      } : undefined}
      onAuxClick={canPlay ? event => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
        // Middle click is an explicit seek, even when a text range is selected.
        // It never invokes deletion or restoration, including on deleted text.
        onSeek(chunkStart);
      } : undefined}
      onClick={interactive ? event => {
        if (event.button !== 0) return;
        event.stopPropagation();
        activate();
      } : undefined}
      onContextMenu={chunk.deleted ? event => {
        event.preventDefault();
        event.stopPropagation();
        onRestore(restoreSpan);
      } : undefined}
      onKeyDown={interactive ? event => activateWithKeyboard(event, activate) : undefined}
    ><Highlight text={chunk.text} query={query}/></span>;
  })}</>;
});
