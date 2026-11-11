import { buildMediaCutPlan, type MediaCutInput, type MediaCutPlan } from "./media-plan";

export type PlaybackMode = "original" | "edited";
export const MIN_PLAYBACK_RATE = 0.25;
export const MAX_PLAYBACK_RATE = 4;
export type PlaybackTimeline = {
  originalEndMs: number | null;
  editedEndMs: number;
  plan: MediaCutPlan;
};
export type PlaybackPosition = { currentMs: number; done: boolean; skipped: boolean; nextBoundaryMs: number | null };

/** The preview and the rendered download share exactly the same cut union. */
export function buildPlaybackTimeline(cuts: readonly MediaCutInput[], subtitleEndMs: number, mediaDurationMs?: number): PlaybackTimeline {
  if (!Number.isSafeInteger(subtitleEndMs) || subtitleEndMs < 0) throw new Error("字幕の終了時刻が正しくありません。");
  if (mediaDurationMs !== undefined && (!Number.isSafeInteger(mediaDurationMs) || mediaDurationMs <= 0)) throw new Error("メディアの長さが正しくありません。");
  const originalEndMs = mediaDurationMs ?? null;
  const durationMs = mediaDurationMs ?? Math.max(1, subtitleEndMs);
  return { originalEndMs, editedEndMs: Math.min(durationMs, subtitleEndMs), plan: buildMediaCutPlan(cuts, durationMs, subtitleEndMs) };
}

/** Half-open keep intervals prevent a cut's first instant from being replayed. */
export function resolvePlaybackPosition(timeline: PlaybackTimeline, positionMs: number, mode: PlaybackMode): PlaybackPosition {
  if (!Number.isFinite(positionMs)) throw new Error("再生位置が正しくありません。");
  const position = Math.max(0, positionMs);
  if (mode === "original") {
    const end = timeline.originalEndMs;
    return { currentMs: end === null ? position : Math.min(position, end), done: end !== null && position >= end, skipped: false, nextBoundaryMs: end };
  }
  const keep = timeline.plan.keep;
  let left = 0, right = keep.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (keep[middle].end <= position) left = middle + 1;
    else right = middle;
  }
  const next = keep[left];
  if (!next || position >= timeline.editedEndMs) return { currentMs: Math.min(position, timeline.editedEndMs), done: true, skipped: false, nextBoundaryMs: null };
  const currentMs = Math.max(position, next.start);
  return { currentMs, done: false, skipped: currentMs > position, nextBoundaryMs: next.end };
}

export type TimedItem = { start: number; end: number };
export interface TimedItemIndex<T extends TimedItem> {
  readonly items: readonly T[];
  readonly leafCount: number;
  readonly maxEnds: Float64Array;
}

/** A max-end interval tree also handles long overlapping subtitles efficiently. */
export function buildTimedItemIndex<T extends TimedItem>(source: readonly T[]): TimedItemIndex<T> {
  const items = source.filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start).slice().sort((a, b) => a.start - b.start || a.end - b.end);
  let leafCount = 1;
  while (leafCount < items.length) leafCount *= 2;
  const maxEnds = new Float64Array(leafCount * 2);
  maxEnds.fill(-Infinity);
  for (let index = 0; index < items.length; index++) maxEnds[leafCount + index] = items[index].end;
  for (let index = leafCount - 1; index > 0; index--) maxEnds[index] = Math.max(maxEnds[index * 2], maxEnds[index * 2 + 1]);
  return { items, leafCount, maxEnds };
}

export function findActiveTimedItems<T extends TimedItem>(index: TimedItemIndex<T>, currentMs: number): T[] {
  if (!Number.isFinite(currentMs) || !index.items.length) return [];
  let left = 0, right = index.items.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (index.items[middle].start <= currentMs) left = middle + 1;
    else right = middle;
  }
  const upper = left, result: T[] = [];
  const visit = (node: number, from: number, to: number) => {
    if (from >= upper || index.maxEnds[node] <= currentMs) return;
    if (to - from === 1) { if (from < index.items.length) result.push(index.items[from]); return; }
    const middle = (from + to) >>> 1;
    visit(node * 2, from, middle); visit(node * 2 + 1, middle, to);
  };
  visit(1, 0, index.leafCount);
  return result;
}

export interface PlaybackSnapshot {
  currentMs: number;
  playing: boolean;
  waiting: boolean;
  mode: PlaybackMode;
  playbackRate: number;
}
export interface TranscriptPlaybackOptions {
  cuts: readonly MediaCutInput[];
  subtitleEndMs: number;
  mediaDurationMs?: number;
}
export interface PlaybackScheduler {
  now: () => number;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  setTimer: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer: (id: ReturnType<typeof setTimeout>) => void;
}
export interface TranscriptPlaybackController {
  playFrom: (milliseconds: number, mode?: PlaybackMode) => void;
  setPlaybackRate: (rate: number) => boolean;
  pause: () => void;
  reset: () => void;
  updateOptions: (options: TranscriptPlaybackOptions) => void;
  getSnapshot: () => PlaybackSnapshot;
  destroy: () => void;
}

/**
 * Browser-media seek preview. No file is uploaded or encoded. A boundary timer,
 * animation frames, and native media events cooperate to skip deleted ranges.
 * Timing is a preview: final encoding still uses the sample-level media plan.
 */
export function createTranscriptPlaybackController(
  media: HTMLMediaElement,
  initialOptions: TranscriptPlaybackOptions,
  callbacks: { onChange: (snapshot: PlaybackSnapshot) => void; onError?: (message: string) => void },
  suppliedScheduler?: PlaybackScheduler,
): TranscriptPlaybackController {
  const scheduler: PlaybackScheduler = suppliedScheduler ?? {
    now: () => performance.now(),
    requestFrame: callback => requestAnimationFrame(callback),
    cancelFrame: id => cancelAnimationFrame(id),
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: id => clearTimeout(id),
  };
  let options = initialOptions;
  let mode: PlaybackMode = "original";
  let waiting = false, destroyed = false, requestedPlaying = false;
  let requestId = 0, frame: number | null = null, timer: ReturnType<typeof setTimeout> | null = null;
  let timerBoundary: number | null = null, timerRate = 1, lastEmittedAt = -Infinity;
  let pending: { request: number; time: number } | null = null;
  let applyingSeek = false;
  const currentPlaybackRate = () => Number.isFinite(media.playbackRate) && media.playbackRate > 0 ? media.playbackRate : 1;
  let lastSnapshot: PlaybackSnapshot = { currentMs: 0, playing: false, waiting: false, mode, playbackRate: currentPlaybackRate() };
  const sourceMilliseconds = () => Number.isFinite(media.currentTime) ? Math.max(0, media.currentTime * 1000) : 0;
  const durationMilliseconds = () => Number.isFinite(media.duration) && media.duration > 0 ? Math.max(1, Math.round(media.duration * 1000)) : options.mediaDurationMs;
  let timeline = buildPlaybackTimeline(options.cuts, options.subtitleEndMs, durationMilliseconds());

  const clearBoundaryTimer = () => {
    if (timer !== null) scheduler.clearTimer(timer);
    timer = null; timerBoundary = null;
  };
  const cancelTicks = () => {
    if (frame !== null) scheduler.cancelFrame(frame);
    frame = null; clearBoundaryTimer();
  };
  const emit = (force = false) => {
    if (destroyed) return;
    const now = scheduler.now();
    const next: PlaybackSnapshot = { currentMs: Math.round(sourceMilliseconds()), playing: !media.paused && !media.ended && requestedPlaying, waiting, mode, playbackRate: currentPlaybackRate() };
    const statusChanged = next.playing !== lastSnapshot.playing || next.waiting !== lastSnapshot.waiting || next.mode !== lastSnapshot.mode || next.playbackRate !== lastSnapshot.playbackRate;
    if (!force && !statusChanged && now - lastEmittedAt < 50) return;
    if (next.currentMs === lastSnapshot.currentMs && !statusChanged && !force) return;
    lastSnapshot = next; lastEmittedAt = now; callbacks.onChange(next);
  };
  const fail = (message: string) => {
    pending = null; requestedPlaying = false; waiting = false; cancelTicks();
    media.pause(); emit(true); callbacks.onError?.(message);
  };
  const seek = (milliseconds: number): boolean => {
    if (Math.abs(sourceMilliseconds() - milliseconds) < .01) return true;
    try {
      applyingSeek = true; media.currentTime = milliseconds / 1000; applyingSeek = false;
      return true;
    } catch {
      applyingSeek = false;
      fail("このメディアの再生位置を変更できません。読み込み完了後に再試行してください。");
      return false;
    }
  };
  const stopAtEnd = (position: PlaybackPosition) => {
    pending = null; requestedPlaying = false; waiting = false; cancelTicks();
    media.pause(); seek(position.currentMs); emit(true);
  };
  const enforcePosition = (): PlaybackPosition | null => {
    if (destroyed || media.readyState < 1 || pending) return null;
    const position = resolvePlaybackPosition(timeline, sourceMilliseconds(), mode);
    if (position.done) { stopAtEnd(position); return position; }
    if (position.skipped && !seek(position.currentMs)) return null;
    return position;
  };
  const tick = () => {
    frame = null;
    if (destroyed || media.paused || media.ended || !requestedPlaying) return;
    const position = enforcePosition();
    emit();
    if (!media.paused && !media.ended && requestedPlaying) {
      scheduleBoundary(position);
      frame = scheduler.requestFrame(tick);
    }
  };
  const scheduleBoundary = (position: PlaybackPosition | null) => {
    if (mode !== "edited" || !position || position.done || position.nextBoundaryMs === null || media.paused || !requestedPlaying || waiting) { clearBoundaryTimer(); return; }
    const rate = currentPlaybackRate();
    if (timer !== null && timerBoundary === position.nextBoundaryMs && timerRate === rate) return;
    clearBoundaryTimer(); timerBoundary = position.nextBoundaryMs; timerRate = rate;
    const delay = Math.max(1, (position.nextBoundaryMs - sourceMilliseconds()) / rate);
    timer = scheduler.setTimer(() => {
      timer = null; timerBoundary = null;
      if (destroyed || media.paused || !requestedPlaying) return;
      const next = enforcePosition(); emit(true); scheduleBoundary(next);
    }, Math.min(delay, 2_147_483_647));
  };
  const ensureTicks = () => {
    if (!destroyed && requestedPlaying && !media.paused && !media.ended && frame === null) frame = scheduler.requestFrame(tick);
  };
  const begin = (request: { request: number; time: number }) => {
    if (destroyed || request.request !== requestId) return;
    timeline = buildPlaybackTimeline(options.cuts, options.subtitleEndMs, durationMilliseconds());
    const target = resolvePlaybackPosition(timeline, request.time, mode);
    pending = null;
    if (target.done) {
      stopAtEnd(target);
      callbacks.onError?.(mode === "edited" ? "この位置より後に再生できる削除後の区間がありません。" : "この位置はメディアの終了時刻以降です。");
      return;
    }
    if (!seek(target.currentMs)) return;
    requestedPlaying = true; waiting = media.readyState < 3;
    const version = requestId;
    try {
      const promise = media.play();
      Promise.resolve(promise).then(() => {
        if (destroyed || requestId !== version) return;
        waiting = false; requestedPlaying = !media.paused; emit(true); ensureTicks(); scheduleBoundary(enforcePosition());
      }, error => {
        if (destroyed || requestId !== version) return;
        if (error?.name === "AbortError") {
          waiting = false; requestedPlaying = !media.paused;
          if (media.paused) cancelTicks();
          emit(true); return;
        }
        fail(error?.name === "NotAllowedError" ? "ブラウザが再生を停止しました。再生ボタンをもう一度押してください。" : "この動画・音声を再生できません。ブラウザで対応している形式か確認してください。");
      });
      emit(true); ensureTicks(); scheduleBoundary(target);
    } catch {
      if (!destroyed && requestId === version) fail("この動画・音声を再生できませんでした。");
    }
  };
  const refreshTimeline = () => {
    timeline = buildPlaybackTimeline(options.cuts, options.subtitleEndMs, durationMilliseconds());
    if (pending && media.readyState >= 1) begin(pending);
    else { const position = enforcePosition(); emit(true); scheduleBoundary(position); }
  };
  const onPlay = () => {
    if (destroyed) return;
    if (media.paused || media.ended) { emit(true); return; }
    requestedPlaying = true;
    const position = enforcePosition(); emit(true); ensureTicks(); scheduleBoundary(position);
  };
  const onPlaying = () => { waiting = false; onPlay(); };
  const onPause = () => {
    if (destroyed) return;
    // An old queued pause event must not cancel a newer play request.
    if (!media.paused) return;
    if (!pending) { requestId++; requestedPlaying = false; waiting = false; }
    cancelTicks(); emit(true);
  };
  const onEnded = () => { requestId++; pending = null; requestedPlaying = false; waiting = false; cancelTicks(); emit(true); };
  const onWaiting = () => { waiting = requestedPlaying && !media.paused; clearBoundaryTimer(); emit(true); };
  const onSeeking = () => {
    if (destroyed || applyingSeek || pending) return;
    clearBoundaryTimer();
    const position = enforcePosition(); emit(true); scheduleBoundary(position);
  };
  const onTimeUpdate = () => { if (!destroyed) { const position = enforcePosition(); emit(); scheduleBoundary(position); ensureTicks(); } };
  const onRateChange = () => {
    if (destroyed) return;
    clearBoundaryTimer();
    const position = enforcePosition();
    emit(true); scheduleBoundary(position); ensureTicks();
  };
  const onCanPlay = () => { if (requestedPlaying) { waiting = false; onTimeUpdate(); emit(true); } };
  const onError = () => { if (!destroyed) fail("動画・音声を読み込めませんでした。ファイルの形式を確認してください。"); };
  const listeners: [string, () => void][] = [
    ["play", onPlay], ["playing", onPlaying], ["pause", onPause], ["ended", onEnded],
    ["waiting", onWaiting], ["stalled", onWaiting], ["canplay", onCanPlay],
    ["seeking", onSeeking], ["seeked", onTimeUpdate], ["timeupdate", onTimeUpdate],
    ["loadedmetadata", refreshTimeline], ["durationchange", refreshTimeline],
    ["ratechange", onRateChange], ["error", onError],
  ];
  for (const [event, handler] of listeners) media.addEventListener(event, handler);
  emit(true);

  return {
    playFrom(milliseconds, nextMode = mode) {
      if (destroyed) return;
      if (!Number.isFinite(milliseconds)) { callbacks.onError?.("再生位置が正しくありません。"); return; }
      requestId++; mode = nextMode; pending = { request: requestId, time: Math.max(0, milliseconds) };
      clearBoundaryTimer(); requestedPlaying = true; waiting = media.readyState < 1;
      if (media.readyState >= 1) begin(pending);
      else { media.pause(); emit(true); }
    },
    setPlaybackRate(rate) {
      if (destroyed) return false;
      if (!Number.isFinite(rate) || rate < MIN_PLAYBACK_RATE || rate > MAX_PLAYBACK_RATE) {
        callbacks.onError?.(`再生速度は${MIN_PLAYBACK_RATE}〜${MAX_PLAYBACK_RATE}倍で入力してください。`);
        return false;
      }
      const previousRate = currentPlaybackRate(), previousDefaultRate = media.defaultPlaybackRate;
      try {
        media.playbackRate = rate;
        if (Math.abs(media.playbackRate - rate) > 0.000001) throw new Error("Playback rate rejected");
        // Loading another source on the same element must not revert its speed.
        media.defaultPlaybackRate = rate;
      } catch {
        try { media.playbackRate = previousRate; media.defaultPlaybackRate = previousDefaultRate; } catch { /* Keep the actual browser rate in the snapshot. */ }
        onRateChange();
        callbacks.onError?.("このブラウザでは指定した再生速度を設定できません。");
        return false;
      }
      // This is a preview preference; do not change the media or export timeline.
      try { if ("preservesPitch" in media) media.preservesPitch = true; } catch { /* Older browsers may not expose a writable pitch setting. */ }
      onRateChange();
      return true;
    },
    pause() {
      if (destroyed) return;
      requestId++; pending = null; requestedPlaying = false; waiting = false; cancelTicks(); media.pause(); emit(true);
    },
    reset() {
      if (destroyed) return;
      requestId++; pending = null; requestedPlaying = false; waiting = false; mode = "original"; cancelTicks(); media.pause(); emit(true);
    },
    updateOptions(next) { if (!destroyed) { options = next; clearBoundaryTimer(); refreshTimeline(); } },
    getSnapshot() { return { ...lastSnapshot }; },
    destroy() {
      if (destroyed) return;
      destroyed = true; requestId++; pending = null; requestedPlaying = false; cancelTicks();
      for (const [event, handler] of listeners) media.removeEventListener(event, handler);
      media.pause();
    },
  };
}
