/**
 * Local-only quiet-audio detection. Subtitle gaps are separate, unverified
 * candidates: a missing subtitle is not evidence of silence.
 *
 * All public times are milliseconds. Returned candidate ranges are the portion
 * that can be removed after preserving `paddingMs` at both ends of a quiet run.
 */
export interface SubtitleGap {
  start: number;
  end: number;
  kind: "gap";
  precision: "gap";
}

export interface SilenceRange {
  start: number;
  end: number;
  kind: "silence";
  precision: "audio";
}

export interface GapOptions {
  /** Minimum raw gap/quiet-run duration, before padding. Default: 1,200 ms. */
  minDurationMs?: number;
  /** Retain this much audio at each boundary. Default: 120 ms. */
  paddingMs?: number;
  /** Optional end of the timeline. Also permits finding a trailing gap. */
  durationMs?: number;
}

export interface AudioSilenceOptions extends GapOptions {
  /** All-channel RMS threshold in dBFS, from -120 to 0. Default: -40. */
  thresholdDb?: number;
  signal?: AbortSignal;
  /** Progress from 0 to 1. Cancellation is checked during each analysis pass. */
  onProgress?: (progress: number) => void;
}

export interface AudioSilenceResult {
  ranges: SilenceRange[];
  /** Full media duration, even when options.durationMs caps the analysis. */
  durationMs: number;
  method: string;
}

const WINDOW_MS = 20;
const READ_BYTES = 1024 * 1024;
const UI_BUDGET_MS = 12;
const MAX_DECODE_BYTES = 32 * 1024 * 1024;
const MAX_DECODE_DURATION_MS = 5 * 60 * 1000;
const MAX_DECODE_SAMPLES = 32_000_000;
const WAV_GUID_TAIL = [0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113];
const PCM_ADVICE = "長い音声・動画は、16・24・32 bit PCM WAV（推奨：16 kHz・モノラル）に変換して選択してください。";

function checkAbort(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("無音の検出を中止しました。");
  error.name = "AbortError";
  throw error;
}

function clock(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

async function yieldToUi(signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  checkAbort(signal);
}

function optionsWithDefaults(options: GapOptions): Required<Pick<GapOptions, "minDurationMs" | "paddingMs">> & Pick<GapOptions, "durationMs"> {
  const minDurationMs = options.minDurationMs ?? 1200;
  const paddingMs = options.paddingMs ?? 120;
  for (const value of [minDurationMs, paddingMs, options.durationMs]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error("検出時間・前後に残す時間・再生時間には、0以上の数値を指定してください。");
    }
  }
  return { minDurationMs, paddingMs, durationMs: options.durationMs };
}

function paddedRange(start: number, end: number, minDurationMs: number, paddingMs: number, limit: number): { start: number; end: number } | null {
  const rawStart = Math.max(0, Math.min(start, limit));
  const rawEnd = Math.max(rawStart, Math.min(end, limit));
  if (rawEnd - rawStart + 0.000001 < minDurationMs) return null;
  const paddedStart = Math.min(limit, Math.max(0, Math.round(rawStart + paddingMs)));
  const paddedEnd = Math.min(limit, Math.max(0, Math.round(rawEnd - paddingMs)));
  return paddedEnd > paddedStart ? { start: paddedStart, end: paddedEnd } : null;
}

/** Find gaps in the union of subtitle intervals; never label them as audio silence. */
export function detectSubtitleGaps(cues: readonly { start: number; end: number }[], options: GapOptions = {}): SubtitleGap[] {
  const { minDurationMs, paddingMs, durationMs } = optionsWithDefaults(options);
  const valid = cues.filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && cue.end > 0);
  const limit = durationMs ?? valid.reduce((end, cue) => Math.max(end, cue.end), 0);
  if (limit <= 0) return [];
  const intervals = valid
    .map((cue) => ({ start: Math.max(0, Math.min(limit, cue.start)), end: Math.max(0, Math.min(limit, cue.end)) }))
    .filter((cue) => cue.end > cue.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const ranges: SubtitleGap[] = [];
  const add = (start: number, end: number) => {
    const range = paddedRange(start, end, minDurationMs, paddingMs, limit);
    if (range) ranges.push({ ...range, kind: "gap", precision: "gap" });
  };
  let cursor = 0;
  for (const cue of intervals) {
    if (cue.start > cursor) add(cursor, cue.start);
    cursor = Math.max(cursor, cue.end);
  }
  if (cursor < limit) add(cursor, limit);
  return ranges;
}

class QuietRunCollector {
  readonly ranges: SilenceRange[] = [];
  private quietStart: number | null = null;
  private readonly thresholdPower: number;
  private readonly minDurationMs: number;
  private readonly paddingMs: number;
  private readonly limit: number;

  constructor(thresholdDb: number, minDurationMs: number, paddingMs: number, limit: number) {
    this.thresholdPower = 10 ** (thresholdDb / 10);
    this.minDurationMs = minDurationMs;
    this.paddingMs = paddingMs;
    this.limit = limit;
  }

  window(start: number, end: number, meanSquare: number): void {
    if (meanSquare <= this.thresholdPower) {
      if (this.quietStart === null) this.quietStart = start;
    } else {
      this.finish(start);
    }
    if (end >= this.limit) this.finish(this.limit);
  }

  finish(end: number): void {
    if (this.quietStart === null) return;
    const range = paddedRange(this.quietStart, end, this.minDurationMs, this.paddingMs, this.limit);
    if (range) this.ranges.push({ ...range, kind: "silence", precision: "audio" });
    this.quietStart = null;
  }
}

type DataChunk = { offset: number; size: number };
type WavFormat = {
  format: 1 | 3;
  channels: number;
  sampleRate: number;
  bits: number;
  blockAlign: number;
  data: DataChunk[];
  totalFrames: number;
};

function fourcc(view: DataView, offset: number): string {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

async function readBytes(file: File, start: number, end: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  checkAbort(signal);
  const bytes = await file.slice(start, end).arrayBuffer();
  checkAbort(signal);
  if (bytes.byteLength !== end - start) throw new Error("音声ファイルの一部を読み込めませんでした。ファイルが破損していないか確認してください。");
  return bytes;
}

async function readWav(file: File, signal?: AbortSignal): Promise<WavFormat> {
  const header = new DataView(await readBytes(file, 0, 12, signal));
  const riffEnd = 8 + header.getUint32(4, true);
  if (riffEnd < 12 || riffEnd > file.size) throw new Error("WAVのファイルサイズ情報が不正、または音声データが途中で切れています。PCM WAVとして保存し直してください。");
  let format: Omit<WavFormat, "data" | "totalFrames"> | null = null;
  const data: DataChunk[] = [];
  let offset = 12;
  let chunkCount = 0;
  while (offset + 8 <= riffEnd) {
    if (++chunkCount > 16384) throw new Error("WAVのヘッダーに多数の不明な項目があります。PCM WAVとして保存し直してください。");
    const chunkHeader = new DataView(await readBytes(file, offset, offset + 8, signal));
    const name = fourcc(chunkHeader, 0);
    const size = chunkHeader.getUint32(4, true);
    const payloadOffset = offset + 8;
    const next = payloadOffset + size + (size % 2);
    if (payloadOffset + size > riffEnd) throw new Error("WAVの音声データ長がファイルの範囲を超えています。ファイルが最後まで保存されているか確認してください。");
    if (name === "fmt ") {
      if (format) throw new Error("複数の音声形式を持つWAVには対応していません。1つのPCM音声として保存し直してください。");
      if (size < 16) throw new Error("WAVの音声形式情報が不足しています。");
      const info = new DataView(await readBytes(file, payloadOffset, payloadOffset + Math.min(size, 64), signal));
      let codec = info.getUint16(0, true);
      const channels = info.getUint16(2, true);
      const sampleRate = info.getUint32(4, true);
      const blockAlign = info.getUint16(12, true);
      const bits = info.getUint16(14, true);
      if (codec === 0xfffe) {
        if (size < 40 || info.getUint16(16, true) < 22 || !WAV_GUID_TAIL.every((value, index) => info.getUint8(28 + index) === value)) {
          throw new Error(`この拡張WAV形式を読み込めません。${PCM_ADVICE}`);
        }
        codec = info.getUint32(24, true);
        const validBits = info.getUint16(18, true);
        if (validBits > bits) throw new Error("WAVの有効ビット数が正しくありません。");
      }
      if (codec !== 1 && codec !== 3) throw new Error(`このWAVは圧縮された形式です。${PCM_ADVICE}`);
      if ((codec === 1 && ![8, 16, 24, 32].includes(bits)) || (codec === 3 && bits !== 32)) {
        throw new Error(`このWAVのビット深度には対応していません。${PCM_ADVICE}`);
      }
      if (channels < 1 || channels > 32 || sampleRate < 1 || sampleRate > 768000 || blockAlign !== channels * (bits / 8)) {
        throw new Error("WAVのチャンネル数・サンプルレート・フレーム幅が正しくありません。PCM WAVとして保存し直してください。");
      }
      format = { format: codec, channels, sampleRate, bits, blockAlign };
    } else if (name === "data" && size > 0) {
      data.push({ offset: payloadOffset, size });
    }
    offset = next;
    if (chunkCount % 64 === 0) await yieldToUi(signal);
  }
  if (!format || !data.length) throw new Error("WAVに音声形式情報または音声データがありません。");
  if (data.some((chunk) => chunk.size % format.blockAlign !== 0)) throw new Error("WAVの最後の音声フレームが不完全です。PCM WAVとして保存し直してください。");
  const totalFrames = data.reduce((sum, chunk) => sum + chunk.size / format.blockAlign, 0);
  return { ...format, data, totalFrames };
}

function sampleReader(view: DataView, wav: WavFormat): (offset: number) => number {
  if (wav.format === 3) return (offset) => {
    const sample = view.getFloat32(offset, true);
    if (!Number.isFinite(sample)) throw new Error("WAVに無効な音声値が含まれています。PCM WAVとして保存し直してください。");
    return sample;
  };
  if (wav.bits === 8) return (offset) => (view.getUint8(offset) - 128) / 128;
  if (wav.bits === 16) return (offset) => view.getInt16(offset, true) / 32768;
  if (wav.bits === 24) return (offset) => {
    const value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
    return (value & 0x800000 ? value - 0x1000000 : value) / 8388608;
  };
  return (offset) => view.getInt32(offset, true) / 2147483648;
}

async function analyzeWav(file: File, options: AudioSilenceOptions, thresholdDb: number): Promise<AudioSilenceResult> {
  const settings = optionsWithDefaults(options);
  const wav = await readWav(file, options.signal);
  const durationMs = wav.totalFrames / wav.sampleRate * 1000;
  const framesToAnalyze = settings.durationMs === undefined ? wav.totalFrames : Math.min(wav.totalFrames, Math.floor(settings.durationMs * wav.sampleRate / 1000));
  const analyzedDuration = framesToAnalyze / wav.sampleRate * 1000;
  const collector = new QuietRunCollector(thresholdDb, settings.minDurationMs, settings.paddingMs, analyzedDuration);
  const windowFrames = Math.max(1, Math.round(wav.sampleRate * WINDOW_MS / 1000));
  const bytesPerSample = wav.bits / 8;
  const readFrames = Math.max(1, Math.floor(READ_BYTES / wav.blockAlign));
  let processed = 0;
  let windowStart = 0;
  let inWindow = 0;
  let squareSum = 0;
  let lastYield = clock();
  options.onProgress?.(0.02);
  for (const chunk of wav.data) {
    for (let offset = chunk.offset; offset < chunk.offset + chunk.size && processed < framesToAnalyze;) {
      checkAbort(options.signal);
      const count = Math.min(readFrames, (chunk.offset + chunk.size - offset) / wav.blockAlign, framesToAnalyze - processed);
      const bytes = await readBytes(file, offset, offset + count * wav.blockAlign, options.signal);
      const view = new DataView(bytes);
      const readSample = sampleReader(view, wav);
      for (let frame = 0; frame < count; frame++) {
        const frameOffset = frame * wav.blockAlign;
        for (let channel = 0; channel < wav.channels; channel++) {
          const sample = readSample(frameOffset + channel * bytesPerSample);
          // Sum powers, not signed channel samples: opposite-polarity stereo
          // must never cancel into a false silent interval.
          squareSum += sample * sample;
        }
        processed += 1;
        inWindow += 1;
        if (inWindow === windowFrames) {
          collector.window(windowStart / wav.sampleRate * 1000, processed / wav.sampleRate * 1000, squareSum / (inWindow * wav.channels));
          windowStart = processed;
          inWindow = 0;
          squareSum = 0;
        }
        if ((frame & 4095) === 0) {
          checkAbort(options.signal);
          if (clock() - lastYield >= UI_BUDGET_MS) {
            options.onProgress?.(0.02 + 0.98 * processed / Math.max(1, framesToAnalyze));
            await yieldToUi(options.signal);
            lastYield = clock();
          }
        }
      }
      offset += count * wav.blockAlign;
      options.onProgress?.(0.02 + 0.98 * processed / Math.max(1, framesToAnalyze));
      if (clock() - lastYield >= UI_BUDGET_MS) { await yieldToUi(options.signal); lastYield = clock(); }
    }
    if (processed >= framesToAnalyze) break;
  }
  if (inWindow > 0) collector.window(windowStart / wav.sampleRate * 1000, analyzedDuration, squareSum / (inWindow * wav.channels));
  collector.finish(analyzedDuration);
  checkAbort(options.signal);
  options.onProgress?.(1);
  return { ranges: collector.ranges, durationMs, method: `WAV分割読込・${WINDOW_MS} ms RMS・全${wav.channels}チャンネル・${thresholdDb} dBFS` };
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      try { checkAbort(signal); } catch (error) { reject(error); }
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Obtain media duration before decoding, so a small but long MP3 is guarded too. */
async function readMediaDuration(file: File, signal?: AbortSignal): Promise<number> {
  if (typeof document === "undefined") throw new Error(`この環境ではWAV以外の音声を解析できません。${PCM_ADVICE}`);
  checkAbort(signal);
  const media = document.createElement("audio");
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      let settled = false;
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      const fail = (error: Error = new Error(`この音声・動画の形式、または再生時間をブラウザで読み取れません。${PCM_ADVICE}`)) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const abort = () => { try { checkAbort(signal); } catch (error) { fail(error as Error); } };
      const timer = setTimeout(() => fail(), 12000);
      media.onloadedmetadata = () => {
        if (settled) return;
        if (Number.isFinite(media.duration) && media.duration > 0) {
          settled = true;
          cleanup();
          resolve(media.duration * 1000);
        }
        else fail();
      };
      media.onerror = () => fail();
      signal?.addEventListener("abort", abort, { once: true });
      media.preload = "metadata";
      media.src = url;
    });
  } finally {
    media.onloadedmetadata = null;
    media.onerror = null;
    media.removeAttribute("src");
    media.load();
    URL.revokeObjectURL(url);
  }
}

async function analyzeDecoded(file: File, options: AudioSilenceOptions, thresholdDb: number): Promise<AudioSilenceResult> {
  const settings = optionsWithDefaults(options);
  if (file.size > MAX_DECODE_BYTES) throw new Error(`WAV以外の無音検出は32 MB・5分以内のファイルに対応しています。${PCM_ADVICE}`);
  const metadataDuration = await readMediaDuration(file, options.signal);
  if (metadataDuration > MAX_DECODE_DURATION_MS) throw new Error(`このファイルは5分を超えるため、ブラウザでの一括デコードを行いません。${PCM_ADVICE}`);
  checkAbort(options.signal);
  const AudioContextClass = typeof window !== "undefined" ? window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;
  if (!AudioContextClass) throw new Error(`このブラウザには音声解析機能がありません。${PCM_ADVICE}`);
  options.onProgress?.(0.05);
  // Resampling is sufficient for quiet detection and caps decoded memory for
  // normal mono/stereo clips. It does not alter the user's file or playback.
  let context: AudioContext;
  try { context = new AudioContextClass({ sampleRate: 16000 }); }
  catch { throw new Error(`ブラウザの音声解析を開始できませんでした。${PCM_ADVICE}`); }
  let audio: AudioBuffer;
  try {
    const bytes = await withAbort(file.arrayBuffer(), options.signal);
    options.onProgress?.(0.1);
    audio = await withAbort(context.decodeAudioData(bytes), options.signal);
  } catch (cause) {
    checkAbort(options.signal);
    throw new Error(`この音声・動画をブラウザでデコードできません。${PCM_ADVICE}${cause instanceof Error && cause.name === "NotSupportedError" ? "" : " 別の音声形式で保存し直すと読み込める場合があります。"}`);
  } finally {
    await context.close().catch(() => {});
  }
  checkAbort(options.signal);
  if (audio.duration * 1000 > MAX_DECODE_DURATION_MS || audio.length * audio.numberOfChannels > MAX_DECODE_SAMPLES || audio.numberOfChannels < 1) {
    throw new Error(`デコードした音声が大きいため解析を中止しました。${PCM_ADVICE}`);
  }
  const durationMs = audio.duration * 1000;
  const frames = settings.durationMs === undefined ? audio.length : Math.min(audio.length, Math.floor(settings.durationMs * audio.sampleRate / 1000));
  const analyzedDuration = frames / audio.sampleRate * 1000;
  const collector = new QuietRunCollector(thresholdDb, settings.minDurationMs, settings.paddingMs, analyzedDuration);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
  const windowFrames = Math.max(1, Math.round(audio.sampleRate * WINDOW_MS / 1000));
  let lastYield = clock();
  options.onProgress?.(0.35);
  for (let start = 0; start < frames; start += windowFrames) {
    const end = Math.min(frames, start + windowFrames);
    let power = 0;
    for (const channel of channels) {
      for (let frame = start; frame < end; frame++) {
        const sample = channel[frame];
        if (!Number.isFinite(sample)) throw new Error("音声に無効な値が含まれているため解析できません。PCM WAVとして保存し直してください。");
        power += sample * sample;
      }
    }
    collector.window(start / audio.sampleRate * 1000, end / audio.sampleRate * 1000, power / ((end - start) * channels.length));
    checkAbort(options.signal);
    if (clock() - lastYield >= UI_BUDGET_MS) {
      options.onProgress?.(0.35 + 0.65 * end / Math.max(1, frames));
      await yieldToUi(options.signal);
      lastYield = clock();
    }
  }
  collector.finish(analyzedDuration);
  options.onProgress?.(1);
  return { ranges: collector.ranges, durationMs, method: `ブラウザ音声解析・${WINDOW_MS} ms RMS・全${channels.length}チャンネル・${thresholdDb} dBFS` };
}

/**
 * Detect low-volume runs from a local file. PCM/float WAV is streamed in bounded
 * slices, including long recordings. Other formats use guarded browser decoding.
 * The result indicates threshold-based quiet audio, not speech recognition.
 */
export async function analyzeAudioSilence(file: File, options: AudioSilenceOptions = {}): Promise<AudioSilenceResult> {
  checkAbort(options.signal);
  optionsWithDefaults(options);
  const thresholdDb = options.thresholdDb ?? -40;
  if (!Number.isFinite(thresholdDb) || thresholdDb < -120 || thresholdDb > 0) throw new Error("音量しきい値は-120〜0 dBFSの範囲で指定してください。");
  if (!file || file.size < 12) throw new Error("音声ファイルが空、または短すぎます。別のファイルを選択してください。");
  options.onProgress?.(0);
  const header = new DataView(await readBytes(file, 0, 12, options.signal));
  const container = fourcc(header, 0);
  const type = fourcc(header, 8);
  if (container === "RIFF" && type === "WAVE") return analyzeWav(file, options, thresholdDb);
  if (type === "WAVE" && ["RF64", "BW64", "RIFX"].includes(container)) {
    throw new Error(`RF64・BW64・ビッグエンディアンWAVには対応していません。通常のRIFF PCM WAVに変換してください。${PCM_ADVICE}`);
  }
  if (/\.wave?$/i.test(file.name)) throw new Error("WAVヘッダーが見つかりません。通常のRIFF PCM WAVとして保存し直してください。");
  return analyzeDecoded(file, options, thresholdDb);
}
