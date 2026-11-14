/**
 * A small browser-safe WebVTT reader, speaker-run merger, and text exporter.
 * Times are integer milliseconds. Reading never executes cue HTML.
 */
export interface Cue {
  wordTiming?: import('./word-timing').WordTiming;
  id: string;
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  settings?: string;
  sourceIds: string[];
  sourceCount: number;
  /** A multi-voice cue stays separate, with its voice labels in the text. */
  isMultiVoice?: boolean;
  /** Retained only for a multi-voice cue so export preserves voice boundaries. */
  voicePayload?: string;
}

export interface ParsedVtt {
  cues: Cue[];
  warnings: string[];
}

export interface MergeOptions {
  /** null or undefined means no gap limit; zero means touching/overlapping only. */
  maxGapMs?: number | null;
}

export interface SerializeOptions {
  speakerFormat?: "voice" | "prefix";
}

const TIMESTAMP = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;
const TIMING_LINE = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+(.*))?$/;
const INLINE_TIMESTAMP = /<(?:(?:\d{2,}):)?[0-5]\d:[0-5]\d\.\d{3}>/g;

export function parseTimestamp(value: string): number | null {
  const match = TIMESTAMP.exec(value);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const result = ((hours * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]);
  return Number.isSafeInteger(result) ? result : null;
}

export function formatTime(milliseconds: number, includeMilliseconds = false): string {
  const value = Number.isFinite(milliseconds) ? Math.max(0, Math.round(milliseconds)) : 0;
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor(value / 60_000) % 60;
  const seconds = Math.floor(value / 1000) % 60;
  const base = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return includeMilliseconds ? `${base}.${String(value % 1000).padStart(3, "0")}` : base;
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", lrm: "\u200e", rlm: "\u200f",
  };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|lrm|rlm);/gi, (raw, entity: string) => {
    if (entity.startsWith("#")) {
      const codepoint = entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      if (!Number.isFinite(codepoint) || codepoint <= 0 || codepoint > 0x10ffff || (codepoint >= 0xd800 && codepoint <= 0xdfff)) return "\ufffd";
      return String.fromCodePoint(codepoint);
    }
    return named[entity.toLowerCase()] ?? raw;
  });
}

function plainCueText(text: string): string {
  return decodeEntities(text
    .replace(INLINE_TIMESTAMP, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:b|i|u|ruby|rt|c|v|lang)(?=[.\s>])[^>]*>/gi, ""))
    .replace(/\u0000/g, "\ufffd")
    .trim();
}

function prefixSpeaker(text: string): { speaker: string | null; text: string } {
  // Support the common Japanese diarization format and short named-speaker labels.
  // The restricted prefix avoids treating URLs and clock times as speakers.
  const match = /^([^\n\r：:<>]{1,80})[：:][ \t]*([\s\S]*)$/.exec(text);
  if (!match) return { speaker: null, text };
  const label = match[1].trim();
  if (!label || /^\d+$/.test(label) || /^(?:https?|ftp|mailto|data|file)$/i.test(label) || /[。！？!?]/.test(label)) {
    return { speaker: null, text };
  }
  return { speaker: label, text: match[2].trim() };
}

function readPayload(payload: string): { speaker: string | null; text: string; isMultiVoice?: boolean; voicePayload?: string } {
  const voices = [...payload.matchAll(/<v(?:\.[^\s>]+)*[ \t]+([^>]+)>/g)];
  if (!voices.length) return prefixSpeaker(plainCueText(payload));

  const names = voices.map((match) => decodeEntities(match[1]).trim());
  const distinct = [...new Set(names.filter(Boolean))];
  if (distinct.length === 1) return { speaker: distinct[0], text: plainCueText(payload) };
  if (!distinct.length) return { speaker: null, text: plainCueText(payload) };

  // A cue can contain several voices but has only one outer time range. Do not
  // invent per-speaker timing: preserve the names inline and keep it unmerged.
  const labeled = payload.replace(/<v(?:\.[^\s>]+)*[ \t]+([^>]+)>/g, (_, name: string) => `\n${name.trim()}：`);
  return { speaker: null, text: plainCueText(labeled).replace(/\n[ \t]*\n+/g, "\n"), isMultiVoice: true, voicePayload: payload };
}

export function parseVtt(input: string): ParsedVtt {
  if (typeof input !== "string") throw new Error("VTT ファイルを読み込めませんでした。");
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0] || "") || lines[0].includes("-->")) {
    throw new Error("WEBVTT ヘッダーが見つかりません。.vtt 形式のファイルを選択してください。");
  }

  const cues: Cue[] = [];
  const warnings: string[] = [];
  let extraWarnings = 0;
  const warn = (message: string) => {
    if (warnings.length < 30) warnings.push(message);
    else extraWarnings += 1;
  };

  let offset = 1;
  // Skip valid header metadata, while accepting a missing header separator.
  while (offset < lines.length && lines[offset].trim() !== "") {
    if (TIMING_LINE.test(lines[offset].trim()) || TIMING_LINE.test((lines[offset + 1] || "").trim())) {
      warn("WEBVTT ヘッダーの後に空行がありません。読み込み時に補完しました。");
      break;
    }
    offset += 1;
  }

  let blockNumber = 0;
  let multiVoiceCount = 0;
  let previousStart = -1;
  while (offset < lines.length) {
    while (offset < lines.length && lines[offset].trim() === "") offset += 1;
    if (offset >= lines.length) break;
    const blockStartLine = offset + 1;
    const block: string[] = [];
    while (offset < lines.length && lines[offset].trim() !== "") block.push(lines[offset++]);
    blockNumber += 1;
    if (/^(?:NOTE(?:[ \t]|$)|STYLE(?:[ \t]|$)|REGION(?:[ \t]|$))/.test(block[0])) continue;

    const timelineIndex = TIMING_LINE.test(block[0].trim()) ? 0 : 1;
    const timeline = block[timelineIndex]?.trim();
    const match = timeline ? TIMING_LINE.exec(timeline) : null;
    if (!match) {
      warn(`${blockStartLine} 行目付近の字幕をスキップしました。時刻行の形式が正しくありません。`);
      continue;
    }
    const start = parseTimestamp(match[1]);
    const end = parseTimestamp(match[2]);
    if (start === null || end === null || end <= start) {
      warn(`${blockStartLine} 行目付近の字幕をスキップしました。開始・終了時刻を確認してください。`);
      continue;
    }
    const payloadLines = block.slice(timelineIndex + 1);
    if (payloadLines.some((line) => TIMING_LINE.test(line.trim()))) {
      // Do not silently include a second cue's timing as dialogue.
      warn(`${blockStartLine} 行目付近に字幕間の空行がありません。このブロックはスキップしました。`);
      continue;
    }
    const { speaker, text, isMultiVoice, voicePayload } = readPayload(payloadLines.join("\n"));
    if (!text) {
      warn(`${blockStartLine} 行目付近の空の字幕をスキップしました。`);
      continue;
    }
    if (start < previousStart) warn(`${blockStartLine} 行目付近の開始時刻が前の字幕より前です。元の並び順を保持しました。`);
    previousStart = start;
    if (isMultiVoice) multiVoiceCount += 1;
    const originalId = timelineIndex === 1 ? block[0].trim() : String(blockNumber);
    cues.push({
      id: `cue-${cues.length + 1}`,
      start, end, text, speaker,
      settings: match[3]?.trim() || undefined,
      sourceIds: [originalId],
      sourceCount: 1,
      ...(isMultiVoice ? { isMultiVoice: true, voicePayload } : {}),
    });
  }
  if (multiVoiceCount) warn(`${multiVoiceCount} 件の字幕に複数の voice タグがあります。話者名を本文に残し、個別の発言として表示します。`);
  if (extraWarnings) warnings.push(`ほか ${extraWarnings} 件の形式上の問題があります。`);
  if (!cues.length) throw new Error(warnings.length ? `有効な字幕が見つかりません。${warnings[0]}` : "字幕がありません。時刻と本文を含む VTT ファイルを選択してください。");
  return { cues, warnings };
}

export function mergeCues(cues: readonly Cue[], options: MergeOptions = {}): Cue[] {
  const result: Cue[] = [];
  const maxGap = options.maxGapMs == null ? Number.POSITIVE_INFINITY : Math.max(0, options.maxGapMs);
  let previousInputStart = -1;
  for (const cue of cues) {
    const previous = result[result.length - 1];
    const sameKnownSpeaker = previous && previous.speaker !== null && cue.speaker !== null && previous.speaker === cue.speaker;
    if (sameKnownSpeaker && !previous.isMultiVoice && !cue.isMultiVoice && cue.start >= previousInputStart && cue.start - previous.end <= maxGap) {
      previous.text += `\n${cue.text}`;
      previous.end = Math.max(previous.end, cue.end);
      previous.sourceIds.push(...cue.sourceIds);
      previous.sourceCount += cue.sourceCount;
      // Conflicting layout instructions have no useful meaning for one combined
      // conversation turn; export that turn with neutral subtitle positioning.
      if (previous.settings !== cue.settings) previous.settings = undefined;
    } else {
      result.push({ ...cue, sourceIds: [...cue.sourceIds] });
    }
    previousInputStart = cue.start;
  }
  return result;
}

function escapeVtt(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function serializeVtt(cues: readonly Cue[], options: SerializeOptions = {}): string {
  const usePrefix = options.speakerFormat === "prefix";
  const blocks = cues.map((cue, index) => {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start) {
      throw new Error(`${index + 1} 件目の字幕の時刻が正しくありません。`);
    }
    // The parser never emits blank payload lines. Collapse any supplied blank
    // line to a single newline so it cannot accidentally begin another cue.
    const body = escapeVtt(cue.text.replace(/\r\n?/g, "\n").replace(/\n[ \t]*\n+/g, "\n"));
    const speaker = cue.speaker ? escapeVtt(cue.speaker.replace(/[\r\n]+/g, " ").trim()) : null;
    const payload = cue.isMultiVoice && cue.voicePayload
      ? cue.voicePayload
      : speaker ? (usePrefix ? `${speaker}：${body}` : `<v ${speaker}>${body}</v>`) : body;
    const settings = cue.settings?.replace(/[\r\n]/g, " ").trim();
    return `${index + 1}\n${formatTime(cue.start, true)} --> ${formatTime(cue.end, true)}${settings ? ` ${settings}` : ""}\n${payload}`;
  });
  return `WEBVTT\n\n${blocks.join("\n\n")}${blocks.length ? "\n" : ""}`;
}
