"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  createTranscriptPlaybackController,
  MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE,
  type PlaybackMode, type PlaybackSnapshot, type TranscriptPlaybackController, type TranscriptPlaybackOptions,
} from "@/src/lib/transcript-playback";

type Options = TranscriptPlaybackOptions & { sourceKey: string; onError?: (message: string) => void };
const initialSnapshot: PlaybackSnapshot = { currentMs: 0, playing: false, waiting: false, mode: "original", playbackRate: 1 };

export function useTranscriptPlayback(mediaRef: RefObject<HTMLMediaElement | null>, options: Options) {
  const [snapshot, setSnapshot] = useState<PlaybackSnapshot>(initialSnapshot);
  const controller = useRef<TranscriptPlaybackController | null>(null);
  const preferredPlaybackRate = useRef(1);
  const currentOptions = useRef(options);
  currentOptions.current = options;

  useEffect(() => {
    const playbackRate = preferredPlaybackRate.current;
    setSnapshot({ ...initialSnapshot, playbackRate });
    const media = mediaRef.current;
    if (!options.sourceKey || !media) return;
    const active = createTranscriptPlaybackController(media, currentOptions.current, {
      onChange: next => { preferredPlaybackRate.current = next.playbackRate; setSnapshot(next); },
      onError: message => currentOptions.current.onError?.(message),
    });
    controller.current = active;
    active.setPlaybackRate(playbackRate);
    return () => { if (controller.current === active) controller.current = null; active.destroy(); };
  }, [mediaRef, options.sourceKey]);

  useEffect(() => {
    controller.current?.updateOptions({ cuts: options.cuts, mutes:options.mutes, subtitleEndMs: options.subtitleEndMs, mediaDurationMs: options.mediaDurationMs });
  }, [options.cuts, options.mutes, options.subtitleEndMs, options.mediaDurationMs]);

  const playFrom = useCallback((milliseconds: number, mode?: PlaybackMode) => {
    if (!controller.current) { currentOptions.current.onError?.("動画・音声を追加すると、この時刻から確認できます。"); return; }
    controller.current.playFrom(milliseconds, mode);
  }, []);
  const pause = useCallback(() => controller.current?.pause(), []);
  const reset = useCallback(() => controller.current?.reset(), []);
  const setPlaybackRate = useCallback((rate: number): boolean => {
    if (controller.current) return controller.current.setPlaybackRate(rate);
    if (!Number.isFinite(rate) || rate < MIN_PLAYBACK_RATE || rate > MAX_PLAYBACK_RATE) {
      currentOptions.current.onError?.(`再生速度は${MIN_PLAYBACK_RATE}〜${MAX_PLAYBACK_RATE}倍で入力してください。`);
      return false;
    }
    preferredPlaybackRate.current = rate;
    setSnapshot(current => ({ ...current, playbackRate: rate }));
    return true;
  }, []);
  return { ...snapshot, playFrom, pause, reset, setPlaybackRate };
}
