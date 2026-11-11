import {
  ALL_FORMATS, AudioSample, AudioSampleSink, AudioSampleSource, BlobSource,
  Input, Mp4OutputFormat, Output, QUALITY_HIGH, StreamTarget,
  VideoSample, VideoSampleSink, VideoSampleSource, WebMOutputFormat,
  canEncodeAudio, canEncodeVideo,
} from "mediabunny";
import type { InputAudioTrack, InputVideoTrack, StreamTargetChunk } from "mediabunny";
import { buildMediaCutPlan } from "./media-plan";
import type { KeepSegment, MediaCutInput } from "./media-plan";

export interface MediaFileInspection {
  durationMs: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  mp4Supported: boolean;
  webmSupported: boolean;
  videoDecodable: boolean;
  audioDecodable: boolean;
  trackCounts: { video: number; audio: number };
  warnings: string[];
  webmVideoCodec: "vp9" | "vp8" | null;
  audioSampleRate: number;
  audioChannels: number;
}

export interface CutMediaProgress { fraction: number; stage: string; outputBytes: number }
export interface RenderCutMediaOptions {
  file: File;
  cuts: readonly MediaCutInput[];
  /** Discard all source media after the input VTT's last cue end. */
  subtitleEndMs: number;
  format: "mp4" | "webm";
  signal?: AbortSignal;
  onProgress?: (progress: CutMediaProgress) => void;
}
export interface CutMediaResult {
  blob: Blob;
  extension: "mp4" | "m4a" | "webm";
  mimeType: string;
  durationMs: number;
  cutDurationMs: number;
  storageMode: "opfs" | "memory";
  /** Revoke any object URL before releasing the temporary output file. */
  release: () => Promise<void>;
}

const inspectionCache = new WeakMap<File, MediaFileInspection>();
const MEMORY_LIMIT = 256 * 1024 * 1024;
const PAGE_SIZE = 1024 * 1024;
const TIMESTAMP_EPSILON = 1e-9;

function aborted(): DOMException { return new DOMException("動画の書き出しを中止しました。", "AbortError"); }
function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw aborted(); }
function safelyDispose(input: Input): void { try { input.dispose(); } catch { /* Already disposed. */ } }
async function supported(probe: Promise<boolean>): Promise<boolean> { try { return await probe; } catch { return false; } }

function openInput(file: File): Input {
  if (!file.size) throw new Error("空のファイルは書き出せません。元の動画・音声ファイルを選択してください。");
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
}

async function analyzeInput(input: Input): Promise<MediaFileInspection> {
  const [videoTracks, audioTracks, video, audio] = await Promise.all([
    input.getVideoTracks(), input.getAudioTracks(), input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack(),
  ]);
  if (!video && !audio) throw new Error("動画・音声トラックが見つかりません。このファイルの形式を確認してください。");
  const [seconds, width, height, videoDecodable, audioDecodable, audioConfig] = await Promise.all([
    input.computeDuration(), video?.getDisplayWidth() ?? 0, video?.getDisplayHeight() ?? 0,
    video ? supported(video.canDecode()) : true, audio ? supported(audio.canDecode()) : true,
    audio?.getDecoderConfig() ?? null,
  ]);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("元ファイルの長さを読み取れませんでした。別の動画ファイルを確認してください。");
  const durationMs = Math.ceil(seconds * 1000);
  const audioSampleRate = audioConfig?.sampleRate ?? 48000;
  const audioChannels = audioConfig?.numberOfChannels ?? 2;
  const videoSettings = { width, height, bitrate: QUALITY_HIGH };
  const audioSettings = { numberOfChannels: audioChannels, sampleRate: audioSampleRate, bitrate: 192000 };
  const [avc, vp9, vp8, aac, opus] = await Promise.all([
    video ? supported(canEncodeVideo("avc", videoSettings)) : true,
    video ? supported(canEncodeVideo("vp9", videoSettings)) : true,
    video ? supported(canEncodeVideo("vp8", videoSettings)) : true,
    audio ? supported(canEncodeAudio("aac", audioSettings)) : true,
    audio ? supported(canEncodeAudio("opus", audioSettings)) : true,
  ]);
  const warnings: string[] = [];
  if (videoTracks.length > 1 || audioTracks.length > 1) warnings.push("複数のトラックがあります。書き出しには主映像と主音声を各 1 トラック使用します。");
  if (!videoDecodable) warnings.push("このブラウザーでは元ファイルの映像をデコードできません。");
  if (!audioDecodable) warnings.push("このブラウザーでは元ファイルの音声をデコードできません。音声を省略した書き出しは行いません。");
  return {
    durationMs, hasVideo: !!video, hasAudio: !!audio, width, height,
    mp4Supported: videoDecodable && audioDecodable && avc && aac,
    webmSupported: videoDecodable && audioDecodable && (vp9 || vp8) && opus,
    videoDecodable, audioDecodable, trackCounts: { video: videoTracks.length, audio: audioTracks.length }, warnings,
    webmVideoCodec: video ? vp9 ? "vp9" : vp8 ? "vp8" : null : null,
    audioSampleRate, audioChannels,
  };
}

export async function inspectMediaFile(file: File): Promise<MediaFileInspection> {
  const cached = inspectionCache.get(file);
  if (cached) return cached;
  const input = openInput(file);
  try {
    const result = await analyzeInput(input);
    inspectionCache.set(file, result);
    return result;
  } finally { safelyDispose(input); }
}

interface ExportStorage {
  mode: "opfs" | "memory";
  target: StreamTarget;
  bytes: () => number;
  getBlob: (mimeType: string) => Promise<Blob>;
  abort: () => Promise<void>;
  release: () => Promise<void>;
}

type ReleaseFileLease = () => Promise<void>;
const leasedFilePattern = /^leased-cut-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:mp4|m4a|webm)$/i;
const fileLockName = (name: string) => `vtt-dialogue-exports:${name}`;

/** A pending Web Locks callback holds the file lease until explicit release.
 * The browser releases it automatically if the owning tab/worker disappears. */
function acquireFileLease(locks: LockManager, name: string, signal?: AbortSignal): Promise<ReleaseFileLease> {
  let releaseGate!: () => void;
  const gate = new Promise<void>(resolve => { releaseGate = resolve; });
  return new Promise<ReleaseFileLease>((resolve, reject) => {
    const job = locks.request(fileLockName(name), { mode: "exclusive", ...(signal ? { signal } : {}) }, async () => {
      let released = false;
      resolve(async () => {
        if (!released) { released = true; releaseGate(); }
        await job;
      });
      await gate;
    });
    void job.catch(reject);
  });
}

async function removeOrphanedExports(directory: FileSystemDirectoryHandle, locks: LockManager, signal?: AbortSignal): Promise<void> {
  const iterable = directory as FileSystemDirectoryHandle & {
    entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
  };
  if (!iterable.entries) return;
  for await (const [name, entry] of iterable.entries()) {
    checkAbort(signal);
    // Legacy/unleased files are deliberately excluded: their owning tabs never
    // promised to hold a lock, so absence of a lease proves nothing about them.
    if (entry.kind !== "file" || !leasedFilePattern.test(name)) continue;
    try {
      await locks.request(fileLockName(name), { mode: "exclusive", ifAvailable: true }, async lock => {
        if (!lock) return;
        checkAbort(signal);
        await directory.removeEntry(name).catch(() => {});
      });
    } catch {
      checkAbort(signal);
      // Lock access or enumeration cleanup is optional; never guess by file age.
    }
  }
}

async function createOpfsStorage(extension: string, signal?: AbortSignal): Promise<ExportStorage> {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle("vtt-dialogue-exports", { create: true });
  const id = crypto.randomUUID();
  let name = `cut-${id}.${extension}`;
  let releaseLease: ReleaseFileLease | undefined;
  const locks = typeof navigator.locks?.request === "function" ? navigator.locks : undefined;
  if (locks) {
    const leasedName = `leased-cut-${id}.${extension}`;
    try { releaseLease = await acquireFileLease(locks, leasedName, signal); name = leasedName; }
    catch { checkAbort(signal); /* An unavailable lock manager uses an unpurgeable filename. */ }
  }
  let handle: FileSystemFileHandle | undefined;
  let fileStream: FileSystemWritableFileStream;
  try {
    if (locks && releaseLease) await removeOrphanedExports(directory, locks, signal);
    checkAbort(signal);
    handle = await directory.getFileHandle(name, { create: true });
    fileStream = await handle.createWritable();
    checkAbort(signal);
  } catch (error) {
    if (fileStream!) await fileStream.abort().catch(() => {});
    if (handle) await directory.removeEntry(name).catch(() => {});
    await releaseLease?.();
    throw error;
  }
  let canceled = false, closed = false, released = false, size = 0;
  const abortFile = async () => {
    canceled = true;
    if (!closed) { closed = true; await fileStream.abort().catch(() => {}); }
  };
  const writable = new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      checkAbort(signal);
      if (canceled) throw aborted();
      // Own the exact byte view: this also avoids Safari writes accidentally
      // including bytes outside a TypedArray view's offset and length.
      const data = new Uint8Array(chunk.data);
      await fileStream.write({ type: "write", position: chunk.position, data });
      size = Math.max(size, chunk.position + data.byteLength);
    },
    async close() {
      if (closed) return;
      if (canceled || signal?.aborted) return abortFile();
      await fileStream.close(); closed = true;
    },
    async abort() { await abortFile(); },
  });
  const release = async () => {
    if (released) return;
    released = true;
    try {
      if (!closed) await abortFile();
      await directory.removeEntry(name).catch(() => {});
    } finally { await releaseLease?.(); }
  };
  return {
    mode: "opfs", target: new StreamTarget(writable, { chunked: true, chunkSize: PAGE_SIZE }), bytes: () => size,
    getBlob: async mimeType => { const file = await handle!.getFile(); return file.slice(0, file.size, mimeType); },
    abort: abortFile, release,
  };
}

function createMemoryStorage(signal?: AbortSignal): ExportStorage {
  let size = 0, canceled = false;
  const pages = new Map<number, Uint8Array>();
  const writable = new WritableStream<StreamTargetChunk>({
    write(chunk) {
      checkAbort(signal);
      if (canceled) throw aborted();
      const end = chunk.position + chunk.data.byteLength;
      if (end > MEMORY_LIMIT) throw new Error("一時保存領域を使用できず、メモリ内の出力が 256 MiB を超えました。ブラウザーの保存領域を空けるか、Chrome / Edge の通常ウィンドウで開いてください。");
      let offset = 0;
      while (offset < chunk.data.byteLength) {
        const position = chunk.position + offset, pageIndex = Math.floor(position / PAGE_SIZE), inPage = position % PAGE_SIZE;
        let page = pages.get(pageIndex);
        if (!page) { page = new Uint8Array(PAGE_SIZE); pages.set(pageIndex, page); }
        const length = Math.min(chunk.data.byteLength - offset, PAGE_SIZE - inPage);
        page.set(chunk.data.subarray(offset, offset + length), inPage); offset += length;
      }
      size = Math.max(size, end);
    },
    abort() { canceled = true; pages.clear(); },
  });
  const release = async () => { pages.clear(); };
  return {
    mode: "memory", target: new StreamTarget(writable, { chunked: true, chunkSize: PAGE_SIZE }), bytes: () => size,
    getBlob: async mimeType => {
      const parts: BlobPart[] = [];
      for (let start = 0; start < size; start += PAGE_SIZE) {
        const page = pages.get(Math.floor(start / PAGE_SIZE)) ?? new Uint8Array(PAGE_SIZE);
        parts.push(size - start >= PAGE_SIZE ? page.buffer as ArrayBuffer : page.slice(0, size - start).buffer);
      }
      const blob = new Blob(parts, { type: mimeType }); pages.clear(); return blob;
    },
    abort: async () => { canceled = true; pages.clear(); }, release,
  };
}

async function createStorage(extension: string, signal?: AbortSignal): Promise<ExportStorage> {
  checkAbort(signal);
  if (typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function") {
    try { return await createOpfsStorage(extension, signal); }
    catch (error) { if (signal?.aborted || error instanceof DOMException && error.name === "AbortError") throw aborted(); }
  }
  checkAbort(signal);
  return createMemoryStorage(signal);
}

/** One decoded video sample is held ahead to recover a zero/missing duration. */
async function* videoSamplesForRange(track: InputVideoTrack, range: KeepSegment, signal?: AbortSignal): AsyncGenerator<VideoSample> {
  const sink = new VideoSampleSink(track);
  const start = range.start / 1000, end = range.end / 1000, outputStart = range.outputStart / 1000;
  const iterator = sink.samples(start);
  let current: VideoSample | null = null, next: VideoSample | null = null;
  const nextUnique = async (after: number): Promise<VideoSample | null> => {
    while (true) {
      checkAbort(signal);
      const item = await iterator.next();
      if (item.done || !item.value) return null;
      if (item.value.timestamp > after + TIMESTAMP_EPSILON) return item.value;
      item.value.close();
    }
  };
  try {
    current = await sink.getSample(start);
    if (!current) current = await nextUnique(-Infinity);
    while (current && current.timestamp < end - TIMESTAMP_EPSILON) {
      checkAbort(signal);
      next = await nextUnique(current.timestamp);
      const originalEnd = current.duration > 0 ? current.timestamp + current.duration : next?.timestamp ?? end;
      const lo = Math.max(start, current.timestamp), hi = Math.min(end, originalEnd);
      if (hi > lo + TIMESTAMP_EPSILON) {
        const sample = current.clone();
        sample.setTimestamp(outputStart + lo - start); sample.setDuration(hi - lo);
        let presented = sample;
        try {
          // Bake only necessary display transforms; ordinary recordings retain
          // their original dimensions and take the direct decoded-frame path.
          if (sample.rotation !== 0 || sample.flip || sample.displayWidth !== sample.codedWidth || sample.displayHeight !== sample.codedHeight) presented = await sample.transform({});
          yield presented;
        } finally { if (presented !== sample) presented.close(); sample.close(); }
      }
      current.close(); current = next; next = null;
    }
  } finally {
    current?.close(); next?.close(); await iterator.return().catch(() => {});
  }
}

async function* audioSamplesForRange(track: InputAudioTrack, range: KeepSegment, signal?: AbortSignal): AsyncGenerator<AudioSample> {
  const sink = new AudioSampleSink(track);
  const start = range.start / 1000, end = range.end / 1000, outputStart = range.outputStart / 1000;
  const iterator = sink.samples(start, end);
  let seed: AudioSample | null = null;
  let lastTimestamp = -Infinity;
  const trim = (sample: AudioSample): AudioSample | null => {
    const first = Math.max(0, Math.ceil((start - sample.timestamp) * sample.sampleRate - 1e-5));
    const last = Math.min(sample.numberOfFrames, Math.floor((end - sample.timestamp) * sample.sampleRate + 1e-5));
    if (last <= first) return null;
    const trimmed = sample.trim(first, last);
    trimmed.setTimestamp(Math.max(outputStart, outputStart + trimmed.timestamp - start));
    return trimmed;
  };
  try {
    seed = await sink.getSample(start);
    if (seed) {
      lastTimestamp = seed.timestamp;
      const sample = trim(seed);
      if (sample) { try { yield sample; } finally { sample.close(); } }
      seed.close(); seed = null;
    }
    for await (const original of iterator) {
      try {
        checkAbort(signal);
        if (original.timestamp <= lastTimestamp + TIMESTAMP_EPSILON) continue;
        lastTimestamp = original.timestamp;
        const sample = trim(original);
        if (sample) { try { yield sample; } finally { sample.close(); } }
      } finally { original.close(); }
    }
  } finally { seed?.close(); await iterator.return().catch(() => {}); }
}

export async function renderCutMedia(options: RenderCutMediaOptions): Promise<CutMediaResult> {
  const { file, cuts, subtitleEndMs, format, signal, onProgress } = options;
  checkAbort(signal);
  if (!Number.isSafeInteger(subtitleEndMs) || subtitleEndMs < 0) {
    throw new Error("VTTの終了時刻を、0以上の整数ミリ秒で指定してください。");
  }
  const input = openInput(file);
  let output: Output | undefined, storage: ExportStorage | undefined;
  let cancelTask: Promise<void> | undefined, successful = false;
  let lastProgressAt = 0;
  const progress = (fraction: number, stage: string, force = false) => {
    const now = performance.now();
    if (force || now - lastProgressAt >= 100) {
      lastProgressAt = now;
      onProgress?.({ fraction: Math.max(0, Math.min(1, fraction)), stage, outputBytes: storage?.bytes() ?? 0 });
    }
  };
  const cancel = () => {
    if (!cancelTask) {
      safelyDispose(input);
      cancelTask = (async () => {
        // Abort the file before Output.cancel closes its target, so cancellation
        // cannot commit a truncated file as though it were a finished export.
        await storage?.abort();
        if (output && output.state !== "finalized" && output.state !== "canceled") await output.cancel().catch(() => {});
      })();
    }
    return cancelTask;
  };
  const onAbort = () => { void cancel(); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    progress(0, "動画を確認中", true);
    const info = inspectionCache.get(file) ?? await analyzeInput(input);
    inspectionCache.set(file, info); checkAbort(signal);
    if (!info.videoDecodable) throw new Error("このブラウザーでは元ファイルの映像をデコードできません。対応する Chrome / Edge で開くか、元動画の形式を確認してください。");
    if (!info.audioDecodable) throw new Error("このブラウザーでは元ファイルの音声をデコードできません。音声を省略せず処理を中止しました。");
    if (format === "mp4" && !info.mp4Supported) throw new Error("このブラウザーでは、この映像・音声構成の MP4 を作成できません。WebM を選択してください。");
    if (format === "webm" && !info.webmSupported) throw new Error("このブラウザーでは、この映像・音声構成の WebM を作成できません。対応する Chrome / Edge で開いてください。");
    const plan = buildMediaCutPlan(cuts, info.durationMs, subtitleEndMs);
    if (!plan.keep.length) throw new Error("すべての区間がカット対象です。残す区間を作ってから書き出してください。");
    const extension = format === "mp4" ? info.hasVideo ? "mp4" : "m4a" : "webm";
    const mimeType = `${info.hasVideo ? "video" : "audio"}/${format === "mp4" ? "mp4" : "webm"}`;
    const [videoTrack, audioTrack] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    progress(0, "保存先を準備中", true);
    storage = await createStorage(extension, signal); checkAbort(signal);
    output = new Output({
      format: format === "mp4" ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
      target: storage.target,
    });
    const videoSource = videoTrack ? new VideoSampleSource({ codec: format === "mp4" ? "avc" : info.webmVideoCodec!, bitrate: QUALITY_HIGH, latencyMode: "quality" }) : null;
    const audioSource = audioTrack ? new AudioSampleSource({ codec: format === "mp4" ? "aac" : "opus", bitrate: 192000 }) : null;
    // Do not specify frameRate: that metadata would quantize source/VFR timing
    // and the shortened frame exposures on either side of a cut.
    if (videoSource) output.addVideoTrack(videoSource);
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();
    let videoCount = 0, audioCount = 0, processedSeconds = 0;
    const totalSeconds = plan.outputDurationMs / 1000;
    for (const range of plan.keep) {
      checkAbort(signal);
      const videoIterator = videoTrack ? videoSamplesForRange(videoTrack, range, signal) : null;
      const audioIterator = audioTrack ? audioSamplesForRange(audioTrack, range, signal) : null;
      let firstVideoInRange = true;
      try {
        let nextVideo = videoIterator ? await videoIterator.next() : null;
        let nextAudio = audioIterator ? await audioIterator.next() : null;
        while (nextVideo && !nextVideo.done || nextAudio && !nextAudio.done) {
          checkAbort(signal);
          const video = nextVideo && !nextVideo.done ? nextVideo.value : null;
          const audio = nextAudio && !nextAudio.done ? nextAudio.value : null;
          // Merge two bounded iterators by output presentation time so neither
          // encoded track gets far ahead and forces large muxer buffering.
          if (video && (!audio || video.timestamp <= audio.timestamp)) {
            await videoSource!.add(video, { keyFrame: firstVideoInRange });
            firstVideoInRange = false; videoCount += 1;
            processedSeconds = Math.max(processedSeconds, video.timestamp + video.duration);
            nextVideo = await videoIterator!.next();
          } else if (audio) {
            await audioSource!.add(audio); audioCount += 1;
            processedSeconds = Math.max(processedSeconds, audio.timestamp + audio.duration);
            nextAudio = await audioIterator!.next();
          }
          progress(Math.min(0.98, processedSeconds / totalSeconds * 0.98), "映像・音声を書き出し中");
        }
      } finally {
        await videoIterator?.return(undefined).catch(() => {});
        await audioIterator?.return(undefined).catch(() => {});
      }
    }
    if (videoSource && !videoCount) throw new Error("残す区間に映像フレームがありません。カット区間を確認してください。");
    if (audioSource && !audioCount) throw new Error("残す区間に音声サンプルがありません。音声を省略せず処理を中止しました。");
    videoSource?.close(); audioSource?.close();
    checkAbort(signal); progress(0.99, "ファイルを仕上げています", true);
    await output.finalize(); checkAbort(signal);
    const blob = await storage.getBlob(mimeType); checkAbort(signal);
    successful = true; progress(1, "完了", true);
    return { blob, extension, mimeType, durationMs: plan.outputDurationMs, cutDurationMs: plan.cutDurationMs, storageMode: storage.mode, release: storage.release };
  } catch (error) {
    await cancel();
    if (signal?.aborted || error instanceof DOMException && error.name === "AbortError") throw aborted();
    if (error instanceof Error && /[\u3040-\u30ff\u3400-\u9fff]/.test(error.message)) throw error;
    throw new Error(`動画を書き出せませんでした。${error instanceof Error ? error.message : "ブラウザーの対応形式と保存領域を確認してください。"}`);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    safelyDispose(input);
    if (!successful) await storage?.release();
  }
}
