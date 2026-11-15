import {readReviewMarks,type ReviewMarks} from "./review-marks";
import type { Cue } from "./vtt";
import {normalizeMutes,type MuteRange} from './audio-mute';
import {validatedWordTiming,wordCutCandidate} from './word-timing';

export const DEFAULT_FILLERS = ["えっと", "えーと", "えーっと", "まあ"];
export type CutKind = "word" | "line" | "filler" | "selection" | "silence" | "gap" | "manual" | "tail";
export type CutPrecision = "cue" | "estimated" | "audio" | "manual" | "gap" | "word";
export interface TextSpan { cueId: string; from: number; to: number }
export interface Token extends TextSpan { id: string; lineId: string; text: string; start: number; end: number; word: boolean }
export interface Line extends TextSpan { id: string; text: string; tokens: Token[]; start: number; end: number; precision: "cue" | "estimated" }
/** Source-text ranges retain voice identity; label ranges are display headings, not speech. */
export interface VoiceTextSpan { from: number; to: number; speaker: string | null; label?: true }
export type RevisedCue = Cue & { estimatedTiming?: boolean; voiceSpans?: VoiceTextSpan[] };
export interface EditorDocument {
  cues: RevisedCue[]; lines: Line[]; tokens: Token[]; durationMs: number; fillerTerms: string[];
  cueById: Map<string, RevisedCue>; tokenById: Map<string, Token>; lineById: Map<string, Line>; linesByCue: Map<string, Line[]>;
}
export interface CutRecord {
  id: string; start: number; end: number; kind: CutKind; precision: CutPrecision;
  text?: string; sourceCueIds: string[]; tokenIds?: string[]; lineIds?: string[]; spans?: TextSpan[];
}
export interface EditorState extends ReviewMarks {
  mutes?: MuteRange[];
  keepTail?: boolean;
  cuts: CutRecord[]; aliases: Record<string, string>; speakerOverrides: Record<string, string | null>; forcedJoins: string[];
  /** Immutable document revisions travel with the same undo/redo snapshot as cuts. */
  cueRevisions?: RevisedCue[];
}
export interface GroupOptions { merge?: boolean; maxGapMs?: number | null; /** Display only; does not establish speaker identity. */ mergeUnknown?: boolean; preserveOverlap?: boolean }
export interface EditorGroup {
  displayUnknownCueIds?:string[];
  id: string; cueIds: string[]; cues: Cue[]; lines: Line[]; speaker: string | null; canonicalSpeaker: string | null;
  start: number; end: number; text: string; sourceCount: number; isMultiVoice: boolean; manual: boolean; deleted: boolean;
}
export interface FillerCandidate extends TextSpan {
  id: string; term: string; text: string; start: number; end: number; tokenIds: string[]; spans: TextSpan[];
}
export interface CutRange {
  start: number; end: number; durationMs: number; editIds: string[]; kinds: CutKind[];
  precisions: CutPrecision[]; precision: CutPrecision; estimated: boolean; sourceCueIds: string[];
}
export interface ExportOptions { sourceFile: string; mediaDurationMs?: number }
export interface EditedCue extends Cue { originalStart: number; originalEnd: number; precision: "cue" | "estimated"; sourceCueIds: string[] }

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const kinds = new Set<CutKind>(["word", "line", "filler", "selection", "silence", "gap", "manual"]);
const precisions = new Set<CutPrecision>(["cue", "estimated", "audio", "manual", "gap", "word"]);
let sequence = 0;
const uniqueId = () => `cut-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${++sequence}`}`;
const cloneCut = (cut: CutRecord): CutRecord => ({ ...cut, sourceCueIds: [...cut.sourceCueIds], tokenIds: cut.tokenIds && [...cut.tokenIds], lineIds: cut.lineIds && [...cut.lineIds], spans: cut.spans?.map(s => ({ ...s })) });
const timingWeights = new WeakMap<Cue, Uint32Array>();
const deletedSpanCache = new WeakMap<EditorDocument, WeakMap<EditorState, TextSpan[]>>();
const deletedSpanIndexCache = new WeakMap<EditorDocument, WeakMap<EditorState, Map<string, TextSpan[]>>>();
const revisionDocuments = new WeakMap<readonly RevisedCue[], EditorDocument>();
const sourceVoiceSpans = new WeakMap<RevisedCue, VoiceTextSpan[]>();

export function createEditorState(): EditorState {
  return { cuts: [], aliases: {}, speakerOverrides: {}, forcedJoins: [], keepTail: true };
}

/** UTF-16 offsets are stable IDs; timing weights Unicode code points equally. */
function timeAt(cue: Cue, offset: number, rounded = true): number {
  if (offset <= 0) return cue.start;
  if (offset >= cue.text.length) return cue.end;
  let weights = timingWeights.get(cue);
  if (!weights) {
    weights = new Uint32Array(cue.text.length + 1);
    let units = 0;
    for (let i = 0; i < cue.text.length;) {
      const width = cue.text.codePointAt(i)! > 0xffff ? 2 : 1;
      for (let j = 0; j < width; j += 1) weights[i + j] = units;
      i += width; units += 1; weights[i] = units;
    }
    timingWeights.set(cue, weights);
  }
  const elapsed = (cue.end - cue.start) * weights[offset] / (weights[cue.text.length] || 1);
  return cue.start + (rounded ? Math.round(elapsed) : elapsed);
}

export function textCutCandidate(cue:Cue,from:number,to:number){
  const candidate=wordCutCandidate(cue,from,to);
  return candidate?{...candidate,precision:(candidate.interpolated?'estimated':'word') as CutPrecision,method:candidate.interpolated?'単語内を推定':'単語時刻の候補'}:{...positiveBounds(cue,from,to),precision:(from===0&&to===cue.text.length&&!('estimatedTiming' in cue&&cue.estimatedTiming)?'cue':'estimated') as CutPrecision,method:'文字数から推定',interpolated:true};
}

function wordSegments(text: string): { from: number; to: number; word: boolean }[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
    return [...segmenter.segment(text)].map(part => ({ from: part.index, to: part.index + part.segment.length, word: !!part.isWordLike }));
  }
  return [...text.matchAll(/[A-Za-z0-9_]+|\s+|[^\s]/gu)].map(match => ({ from: match.index!, to: match.index! + match[0].length, word: /[\p{L}\p{N}]/u.test(match[0]) }));
}

function cleanTerms(terms: readonly string[]): string[] {
  return [...new Set(terms.filter(t => typeof t === "string").map(t => t.trim()).filter(t => t && t.length <= 100 && !/[\r\n]/.test(t)))].sort((a, b) => b.length - a.length);
}

export function buildDocument(sourceCues: readonly RevisedCue[], options: { fillerTerms?: string[] } = {}): EditorDocument {
  const cues = sourceCues.map(c => ({ ...c, wordTiming:validatedWordTiming(c,c.wordTiming), sourceIds: [...c.sourceIds], ...(c.voiceSpans ? { voiceSpans: c.voiceSpans.map(span => ({ ...span })) } : {}) }));
  const cueById = new Map<string, RevisedCue>();
  const lines: Line[] = [], tokens: Token[] = [];
  const lineById = new Map<string, Line>(), tokenById = new Map<string, Token>(), linesByCue = new Map<string, Line[]>();
  const fillerTerms = cleanTerms(options.fillerTerms ?? DEFAULT_FILLERS);
  for (const cue of cues) {
    if (cueById.has(cue.id) || !cue.id || forbidden.has(cue.id)) throw new Error("字幕 ID が重複しているか、正しくありません。");
    if (!Number.isSafeInteger(cue.start) || !Number.isSafeInteger(cue.end) || cue.start < 0 || cue.end <= cue.start || typeof cue.text !== "string") throw new Error("字幕の時刻または本文が正しくありません。");
    cueById.set(cue.id, cue);
    const cueLines: Line[] = [];
    const lineMatches = [...cue.text.matchAll(/[^\n]*(?:\n|$)/g)].filter(m => m[0].length > 0);
    for (const lineMatch of lineMatches) {
      const from = lineMatch.index!, to = from + lineMatch[0].length;
      const lineId = `${cue.id}:line:${from}:${to}`;
      const breaks = new Set<number>([0, lineMatch[0].length]);
      for (const term of fillerTerms) {
        let index = lineMatch[0].indexOf(term);
        while (index >= 0) { breaks.add(index); breaks.add(index + term.length); index = lineMatch[0].indexOf(term, index + term.length); }
      }
      const lineTokens: Token[] = [];
      for (const segment of wordSegments(lineMatch[0])) {
        const points = [segment.from, ...[...breaks].filter(b => b > segment.from && b < segment.to).sort((a, b) => a - b), segment.to];
        for (let i = 0; i < points.length - 1; i += 1) {
          const tokenFrom = from + points[i], tokenTo = from + points[i + 1];
          const token: Token = { id: `${cue.id}:token:${tokenFrom}:${tokenTo}`, cueId: cue.id, lineId, from: tokenFrom, to: tokenTo, text: cue.text.slice(tokenFrom, tokenTo), start: timeAt(cue, tokenFrom), end: timeAt(cue, tokenTo), word: segment.word };
          lineTokens.push(token); tokens.push(token); tokenById.set(token.id, token);
        }
      }
      const line: Line = { id: lineId, cueId: cue.id, text: lineMatch[0].replace(/\n$/, ""), from, to, start: timeAt(cue, from), end: timeAt(cue, to), tokens: lineTokens, precision: lineMatches.length === 1 && !cue.estimatedTiming ? "cue" : "estimated" };
      lines.push(line); cueLines.push(line); lineById.set(line.id, line);
    }
    linesByCue.set(cue.id, cueLines);
  }
  return { cues, lines, tokens, durationMs: cues.reduce((end, cue) => Math.max(end, cue.end), 0), fillerTerms, cueById, tokenById, lineById, linesByCue };
}

/** Resolve once per immutable cue revision; merely changing playback/cuts is cheap. */
export function resolveEditorDocument(baseDoc: EditorDocument, state: EditorState): EditorDocument {
  if (!state.cueRevisions) return baseDoc;
  const cached = revisionDocuments.get(state.cueRevisions);
  if (cached && cached.fillerTerms.join("\u0000") === baseDoc.fillerTerms.join("\u0000")) return cached;
  const doc = buildDocument(state.cueRevisions, { fillerTerms: baseDoc.fillerTerms });
  revisionDocuments.set(state.cueRevisions, doc);
  return doc;
}

function mergeSpans(spans: TextSpan[]): TextSpan[] {
  const sorted = spans.map(s => ({ ...s })).sort((a, b) => a.cueId.localeCompare(b.cueId) || a.from - b.from || a.to - b.to);
  const result: TextSpan[] = [];
  for (const span of sorted) {
    const previous = result[result.length - 1];
    if (previous && previous.cueId === span.cueId && span.from <= previous.to) previous.to = Math.max(previous.to, span.to);
    else result.push(span);
  }
  return result;
}

/** Selection offsets must never divide a UTF-16 surrogate pair. */
function isTextBoundary(text: string, offset: number): boolean {
  return offset <= 0 || offset >= text.length || !(text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);
}

function validatedTextSpans(doc: EditorDocument, spans: readonly TextSpan[]): TextSpan[] {
  const result: TextSpan[] = [];
  for (const span of spans) {
    const cue = span && doc.cueById.get(span.cueId);
    if (!cue || !Number.isSafeInteger(span.from) || !Number.isSafeInteger(span.to) || span.from < 0 || span.to < span.from || span.to > cue.text.length) throw new Error("文字区間が元字幕の範囲外です。");
    if (!isTextBoundary(cue.text, span.from) || !isTextBoundary(cue.text, span.to)) throw new Error("文字区間の境界が文字の途中にあります。文字全体を選択してください。");
    if (span.to > span.from) result.push({ cueId: cue.id, from: span.from, to: span.to });
  }
  return mergeSpans(result);
}

function cutTextSpans(doc: EditorDocument, cut: CutRecord): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const span of cut.spans ?? []) if (doc.cueById.has(span.cueId)) spans.push(span);
  for (const id of cut.tokenIds ?? []) { const token = doc.tokenById.get(id); if (token) spans.push({ cueId: token.cueId, from: token.from, to: token.to }); }
  for (const id of cut.lineIds ?? []) { const line = doc.lineById.get(id); if (line) spans.push({ cueId: line.cueId, from: line.from, to: line.to }); }
  return mergeSpans(spans);
}

export function getDeletedSpans(doc: EditorDocument, state: EditorState): TextSpan[] {
  let cache = deletedSpanCache.get(doc);
  if (!cache) { cache = new WeakMap(); deletedSpanCache.set(doc, cache); }
  const cached = cache.get(state);
  if (cached) return cached;
  const spans: TextSpan[] = [];
  for (const cut of state.cuts) for (const span of cutTextSpans(doc, cut)) spans.push(span);
  const result = mergeSpans(spans);
  cache.set(state, result);
  return result;
}

export function getDeletedSpansByCue(doc: EditorDocument, state: EditorState): Map<string, TextSpan[]> {
  let cache = deletedSpanIndexCache.get(doc);
  if (!cache) { cache = new WeakMap(); deletedSpanIndexCache.set(doc, cache); }
  const cached = cache.get(state);
  if (cached) return cached;
  const result = new Map<string, TextSpan[]>();
  for (const span of getDeletedSpans(doc, state)) { const spans = result.get(span.cueId) ?? []; spans.push(span); result.set(span.cueId, spans); }
  cache.set(state, result);
  return result;
}

function retainedParts(cue: Cue, from: number, to: number, spans: TextSpan[]): TextSpan[] {
  const result: TextSpan[] = [];
  let cursor = from;
  for (const span of spans) {
    if (span.cueId !== cue.id || span.to <= cursor || span.from >= to) continue;
    if (span.from > cursor) result.push({ cueId: cue.id, from: cursor, to: Math.min(span.from, to) });
    cursor = Math.max(cursor, Math.min(span.to, to));
  }
  if (cursor < to) result.push({ cueId: cue.id, from: cursor, to });
  return result;
}

export function getEditedTokenText(doc: EditorDocument, state: EditorState, token: Token): string {
  const cue = doc.cueById.get(token.cueId);
  return cue ? retainedParts(cue, token.from, token.to, getDeletedSpansByCue(doc, state).get(cue.id) ?? []).map(s => cue.text.slice(s.from, s.to)).join("") : "";
}

export function getEditedLineText(doc: EditorDocument, state: EditorState, line: Line): string {
  const cue = doc.cueById.get(line.cueId);
  return cue ? retainedParts(cue, line.from, line.to, getDeletedSpansByCue(doc, state).get(cue.id) ?? []).map(s => cue.text.slice(s.from, s.to)).join("").replace(/\n$/, "") : "";
}

export function getDeletedTokenIds(doc: EditorDocument, state: EditorState): Set<string> {
  const index = getDeletedSpansByCue(doc, state);
  return new Set(doc.tokens.filter(token => (index.get(token.cueId) ?? []).some(s => s.from <= token.from && s.to >= token.to)).map(t => t.id));
}

type CutInput = Omit<CutRecord, "id" | "sourceCueIds"> & { id?: string; sourceCueIds?: string[] };
export function addCut(state: EditorState, input: CutInput): EditorState {
  const start = Math.round(input.start), end = Math.round(input.end);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || !kinds.has(input.kind) || !precisions.has(input.precision)) throw new Error("カット区間は、開始時刻以上・終了時刻未満の有効な範囲にしてください。");
  const id = input.id ?? uniqueId();
  if (!id || state.cuts.some(c => c.id === id)) throw new Error("カット ID が重複しています。");
  const cut = cloneCut({ ...input, id, start, end, sourceCueIds: [...new Set(input.sourceCueIds ?? [])] });
  return { ...state, cuts: [...state.cuts, cut] };
}

export function updateCut(state: EditorState, id: string, patch: Partial<Omit<CutRecord, "id">>): EditorState {
  const current = state.cuts.find(c => c.id === id);
  if (!current) return state;
  const next = addCut({ ...state, cuts: state.cuts.filter(c => c.id !== id) }, { ...current, ...patch, id }).cuts.at(-1)!;
  return { ...state, cuts: state.cuts.map(c => c.id === id ? next : c) };
}

export function removeCut(state: EditorState, id: string): EditorState {
  if (!state.cuts.some(c => c.id === id)) return state;
  return { ...state, cuts: state.cuts.filter(c => c.id !== id) };
}

function positiveBounds(cue: Cue, from: number, to: number): { start: number; end: number } {
  let start = timeAt(cue, from), end = timeAt(cue, to);
  if (end <= start) { start = Math.min(start, cue.end - 1); end = Math.min(cue.end, start + 1); }
  return { start, end };
}

/** Use the same Unicode timing map in both text selection and the media timeline. */
export function timeRangesForText(doc: EditorDocument, spans: readonly TextSpan[]): {start:number;end:number}[] {
  return validatedTextSpans(doc, spans).map(span => textCutCandidate(doc.cueById.get(span.cueId)!, span.from, span.to)).map(({start,end})=>({start,end}));
}
export function textSpansForTime(doc: EditorDocument, start:number, end:number): TextSpan[] {
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start)throw new Error("選択時刻を確認してください。");
  const spans:TextSpan[]=[];
  for(const cue of doc.cues){
    if(cue.end<=start||cue.start>=end)continue;
    const boundary=(value:number,upper:boolean)=>{let lo=0,hi=cue.text.length;while(lo<hi){const mid=Math.floor((lo+hi)/2),time=timeAt(cue,mid);if(upper?time<=value:time<value)lo=mid+1;else hi=mid;}return lo;};
    let from=start<=cue.start?0:Math.max(0,boundary(start,true)-1),to=end>=cue.end?cue.text.length:boundary(end,false);
    while(from>0&&!isTextBoundary(cue.text,from))from--;
    while(to<cue.text.length&&!isTextBoundary(cue.text,to))to++;
    if(to>from)spans.push({cueId:cue.id,from,to});
  }
  return spans;
}
export function deleteTimeRange(doc:EditorDocument,state:EditorState,start:number,end:number):EditorState {
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start)throw new Error("選択時刻を確認してください。");
  const cues=doc.cues.filter(cue=>cue.start<end&&cue.end>start);
  // Time selection describes media only. Source characters are linked explicitly by
  // deleteTextSpans; inferred word timing must never choose extra text to remove.
  return addCut(state,{start,end,kind:cues.length?"manual":"gap",precision:cues.length?"manual":"gap",text:cues.length?"メディアのみカット":"字幕なし区間",sourceCueIds:cues.map(cue=>cue.id),spans:[]});
}

/** Delete only newly selected source characters, including partial tokens. */
export function deleteTextSpans(doc: EditorDocument, state: EditorState, spans: readonly TextSpan[], adjusted?:{start:number;end:number}): EditorState {
  const requested = validatedTextSpans(doc, spans);
  if (!requested.length) return state;
  if(adjusted)return addCut(state,{...adjusted,kind:'selection',precision:'manual',text:requested.map(s=>doc.cueById.get(s.cueId)!.text.slice(s.from,s.to)).join(''),sourceCueIds:[...new Set(requested.map(s=>s.cueId))],spans:requested});
  const already = getDeletedSpansByCue(doc, state);
  let next = state;
  for (const span of requested) {
    const cue = doc.cueById.get(span.cueId)!;
    for (const part of retainedParts(cue, span.from, span.to, already.get(cue.id) ?? [])) {
      const candidate=textCutCandidate(cue,part.from,part.to);
      next = addCut(next, { start:candidate.start,end:candidate.end, kind: "selection", precision:candidate.precision, text: cue.text.slice(part.from, part.to), sourceCueIds: [cue.id], spans: [part] });
    }
  }
  return next;
}

/**
 * Restore source characters from every textual edit, never from media-only cuts.
 * Current media bounds may have been adjusted manually. Remaining text maps
 * proportionally from the edit's original text-time envelope to those bounds;
 * surviving outer edges stay fixed and newly split edges are estimates.
 */
export function restoreTextSpans(doc: EditorDocument, state: EditorState, spans: readonly TextSpan[]): EditorState {
  const requested = validatedTextSpans(doc, spans);
  if (!requested.length) return state;
  const requestedByCue = new Map<string, TextSpan[]>();
  for (const span of requested) { const list = requestedByCue.get(span.cueId) ?? []; list.push(span); requestedByCue.set(span.cueId, list); }
  let changed = false;
  const cuts: CutRecord[] = [];
  for (const cut of state.cuts) {
    const original = cutTextSpans(doc, cut);
    if (!original.some(span => (requestedByCue.get(span.cueId) ?? []).some(target => target.from < span.to && target.to > span.from))) { cuts.push(cut); continue; }
    changed = true;
    const remaining = original.flatMap(span => retainedParts(doc.cueById.get(span.cueId)!, span.from, span.to, requestedByCue.get(span.cueId) ?? []));
    if (!remaining.length) continue;
    let sourceStart = Infinity, sourceEnd = -Infinity;
    for (const span of original) {
      const cue = doc.cueById.get(span.cueId)!;
      // Unrounded character times retain relative positions even in very short cues.
      sourceStart = Math.min(sourceStart, timeAt(cue, span.from, false));
      sourceEnd = Math.max(sourceEnd, timeAt(cue, span.to, false));
    }
    const mapTime = (time: number) => time <= sourceStart ? cut.start : time >= sourceEnd ? cut.end : cut.start + Math.round((time - sourceStart) / (sourceEnd - sourceStart) * (cut.end - cut.start));
    for (let index = 0; index < remaining.length; index += 1) {
      const span = remaining[index], cue = doc.cueById.get(span.cueId)!;
      let start = mapTime(timeAt(cue, span.from, false)), end = mapTime(timeAt(cue, span.to, false));
      // The media log uses integer milliseconds; a remaining fragment needs at
      // least one millisecond, always within its parent's current bounds.
      if (end <= start) { start = Math.max(cut.start, Math.min(start, cut.end - 1)); end = Math.min(cut.end, start + 1); }
      cuts.push({ ...cut, id: index === 0 ? cut.id : uniqueId(), start, end, precision: "estimated", text: cue.text.slice(span.from, span.to), sourceCueIds: [cue.id], tokenIds: undefined, lineIds: undefined, spans: [{ ...span }] });
    }
  }
  return changed ? { ...state, cuts } : state;
}

export function deleteTokens(doc: EditorDocument, state: EditorState, ids: readonly string[], kind: CutKind = "word"): EditorState {
  const already = getDeletedSpans(doc, state);
  const selected = [...new Set(ids)].map(id => doc.tokenById.get(id)).filter((t): t is Token => !!t).filter(t => !already.some(s => s.cueId === t.cueId && s.from <= t.from && s.to >= t.to));
  let next = state;
  for (const span of mergeSpans(selected.map(t => ({ cueId: t.cueId, from: t.from, to: t.to })))) {
    const cue = doc.cueById.get(span.cueId)!;
    const candidate=textCutCandidate(cue,span.from,span.to);
    next = addCut(next, { start:candidate.start,end:candidate.end, kind, precision:candidate.precision, text: cue.text.slice(span.from, span.to), sourceCueIds: [cue.id], spans: [span], tokenIds: selected.filter(t => t.cueId === span.cueId && t.from >= span.from && t.to <= span.to).map(t => t.id) });
  }
  return next;
}

export function deleteLines(doc: EditorDocument, state: EditorState, ids: readonly string[]): EditorState {
  let next = state;
  for (const id of new Set(ids)) {
    const line = doc.lineById.get(id);
    if (!line || !getEditedLineText(doc, next, line).trim()) continue;
    const cue = doc.cueById.get(line.cueId)!;
    next = addCut(next, { ...positiveBounds(cue, line.from, line.to), kind: "line", precision: line.precision, text: line.text, sourceCueIds: [cue.id], lineIds: [line.id], tokenIds: line.tokens.map(t => t.id), spans: [{ cueId: cue.id, from: line.from, to: line.to }] });
  }
  return next;
}

function canonicalSpeaker(cue: Cue, state: EditorState): string | null {
  return own(state.speakerOverrides, cue.id) ? state.speakerOverrides[cue.id] : cue.speaker;
}

/** Split display components without rewriting the original canonical label. */
export function getSpeakerParts(label: string | null): string[] {
  return label === null ? [] : label.split(/[\/／]/).map(part => part.trim()).filter(Boolean);
}

function displayLabel(label: string | null, aliases: Record<string, string>): string | null {
  if (label === null) return null;
  if (own(aliases, label)) return aliases[label];
  return getSpeakerParts(label).map(part => own(aliases, part) ? aliases[part] : part).join(" / ");
}

export function getDisplaySpeaker(cue: Cue, state: EditorState): string | null {
  return displayLabel(canonicalSpeaker(cue, state), state.aliases);
}

export function renameSpeaker(state: EditorState, oldName: string, newName: string): EditorState {
  const name = newName.trim();
  if (!oldName || forbidden.has(oldName) || !name || name.length > 120 || /[\r\n\u0000-\u001f]/.test(name)) throw new Error("話者名は 1〜120 文字で入力してください。");
  const aliases = { ...state.aliases };
  if (oldName === name) delete aliases[oldName]; else aliases[oldName] = name;
  return { ...state, aliases };
}

export function buildGroups(doc: EditorDocument, state: EditorState, options: GroupOptions = {}): EditorGroup[] {
  const groups: EditorGroup[] = [], spansByCue = getDeletedSpansByCue(doc, state);
  const maxGap = options.maxGapMs == null ? Infinity : Math.max(0, options.maxGapMs);
  let previousCue: Cue | undefined;
  for (const cue of doc.cues) {
    const canonical = canonicalSpeaker(cue, state), speaker = getDisplaySpeaker(cue, state);
    const multi = !!cue.isMultiVoice && !own(state.speakerOverrides, cue.id);
    const text = retainedParts(cue, 0, cue.text.length, spansByCue.get(cue.id) ?? []).map(s => cue.text.slice(s.from, s.to)).join("");
    const previous = groups.at(-1);
    const forced = !!previousCue && state.forcedJoins.includes(previousCue.id);
    const auto = options.merge !== false && previous && (canonical !== null || options.mergeUnknown === true) && previous.canonicalSpeaker === canonical && !multi && !previous.isMultiVoice && (!options.preserveOverlap || cue.start >= previous.end) && cue.start >= (previousCue?.start ?? 0) && cue.start - previous.end <= maxGap;
    if (previous && (forced || auto)) {
      previous.cueIds.push(cue.id); previous.cues.push(cue); previous.lines.push(...(doc.linesByCue.get(cue.id) ?? []));
      previous.end = Math.max(previous.end, cue.end); previous.text += `${previous.text && text ? "\n" : ""}${text}`;
      previous.sourceCount += cue.sourceCount; previous.manual ||= forced || own(state.speakerOverrides, cue.id); previous.deleted &&= !text.trim();
    } else {
      groups.push({ id: `group-${cue.id}`, cueIds: [cue.id], cues: [cue], lines: [...(doc.linesByCue.get(cue.id) ?? [])], speaker, canonicalSpeaker: canonical, start: cue.start, end: cue.end, text, sourceCount: cue.sourceCount, isMultiVoice: multi, manual: own(state.speakerOverrides, cue.id), deleted: !text.trim() });
    }
    previousCue = cue;
  }
  return groups;
}

export function mergeWithNeighbor(doc: EditorDocument, state: EditorState, groupId: string, direction: "up" | "down", options: GroupOptions = {}): EditorState {
  const groups = buildGroups(doc, state, options);
  const index = groups.findIndex(group => group.id === groupId);
  const source = groups[index], target = groups[index + (direction === "up" ? -1 : 1)];
  if (!source || !target) throw new Error("結合できる隣の発言がありません。");
  if (source.deleted || target.deleted) throw new Error("削除済みの発言を飛び越えて結合できません。先に発言を復元してください。");
  const speakerOverrides = { ...state.speakerOverrides };
  for (const id of source.cueIds) speakerOverrides[id] = target.canonicalSpeaker;
  const left = direction === "up" ? target : source;
  return { ...state, speakerOverrides, forcedJoins: [...new Set([...state.forcedJoins, left.cueIds.at(-1)!])] };
}

type TextChange = { oldFrom: number; oldTo: number; newFrom: number; newTo: number; equal: boolean };

function codePointOffsets(text: string): number[] {
  const offsets = [0];
  for (const character of text) offsets.push(offsets[offsets.length - 1] + character.length);
  return offsets;
}

/** A bounded Unicode diff keeps unchanged deleted words attached to their text. */
function textChanges(before: string, after: string): TextChange[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  if (!isTextBoundary(before, prefix) || !isTextBoundary(after, prefix)) prefix--;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > prefix && newEnd > prefix && before.charCodeAt(oldEnd - 1) === after.charCodeAt(newEnd - 1)) { oldEnd--; newEnd--; }
  if (!isTextBoundary(before, oldEnd) || !isTextBoundary(after, newEnd)) { oldEnd++; newEnd++; }
  const changes: TextChange[] = [];
  const append = (oldFrom: number, oldTo: number, newFrom: number, newTo: number, equal: boolean) => {
    if (oldFrom === oldTo && newFrom === newTo) return;
    const previous = changes.at(-1);
    if (previous && previous.equal === equal && previous.oldTo === oldFrom && previous.newTo === newFrom) {
      previous.oldTo = oldTo; previous.newTo = newTo;
    } else changes.push({ oldFrom, oldTo, newFrom, newTo, equal });
  };
  append(0, prefix, 0, prefix, true);
  const tooLarge = () => new Error("一度に修正する範囲が大きすぎます。誤字を数か所ずつ修正してください。カット記録は変更していません。");
  if (oldEnd === prefix || newEnd === prefix) append(prefix, oldEnd, prefix, newEnd, false);
  else {
    // Trim unchanged edges before allocating a diff matrix. Even a very long
    // cue with one corrected character therefore needs only a tiny matrix.
    if ((oldEnd - prefix + 1) * (newEnd - prefix + 1) > 4_000_000) throw tooLarge();
    const oldChars = [...before.slice(prefix, oldEnd)], newChars = [...after.slice(prefix, newEnd)];
    const oldOffsets = codePointOffsets(before.slice(prefix, oldEnd)), newOffsets = codePointOffsets(after.slice(prefix, newEnd));
    const oldLength = oldChars.length, newLength = newChars.length;
    if ((oldLength + 1) * (newLength + 1) > 1_000_000) throw tooLarge();
    const width = newLength + 1;
    const lengths = new Uint32Array((oldLength + 1) * width);
    for (let oldIndex = oldLength - 1; oldIndex >= 0; oldIndex--) {
      for (let newIndex = newLength - 1; newIndex >= 0; newIndex--) {
        lengths[oldIndex * width + newIndex] = oldChars[oldIndex] === newChars[newIndex]
          ? lengths[(oldIndex + 1) * width + newIndex + 1] + 1
          : Math.max(lengths[(oldIndex + 1) * width + newIndex], lengths[oldIndex * width + newIndex + 1]);
      }
    }
    const part = (oldFrom: number, oldTo: number, newFrom: number, newTo: number, equal: boolean) => append(prefix + oldOffsets[oldFrom], prefix + oldOffsets[oldTo], prefix + newOffsets[newFrom], prefix + newOffsets[newTo], equal);
    let oldIndex = 0, newIndex = 0;
    while (oldIndex < oldLength || newIndex < newLength) {
      if (oldIndex < oldLength && newIndex < newLength && oldChars[oldIndex] === newChars[newIndex]) {
        part(oldIndex, oldIndex + 1, newIndex, newIndex + 1, true); oldIndex++; newIndex++;
      } else if (oldIndex < oldLength && (newIndex === newLength || lengths[(oldIndex + 1) * width + newIndex] >= lengths[oldIndex * width + newIndex + 1])) {
        part(oldIndex, oldIndex + 1, newIndex, newIndex, false); oldIndex++;
      } else {
        part(oldIndex, oldIndex, newIndex, newIndex + 1, false); newIndex++;
      }
    }
  }
  append(oldEnd, before.length, newEnd, after.length, true);
  return changes;
}

function remapChangedText(span: TextSpan, before: string, after: string, changes: readonly TextChange[]): TextSpan[] {
  const result: TextSpan[] = [];
  const append = (from: number, to: number) => { if (to > from) result.push({ cueId: span.cueId, from, to }); };
  for (const change of changes) {
    if (change.oldFrom === change.oldTo) {
      // New text inside an existing deletion inherits that deletion. Inserting
      // immediately outside it remains visible; a whole-cue deletion stays whole.
      if ((span.from < change.oldFrom && change.oldFrom < span.to) || (span.from === 0 && span.to === before.length)) append(change.newFrom, change.newTo);
      continue;
    }
    const from = Math.max(span.from, change.oldFrom), to = Math.min(span.to, change.oldTo);
    if (to <= from) continue;
    if (change.equal) append(change.newFrom + from - change.oldFrom, change.newFrom + to - change.oldFrom);
    else if (change.newTo > change.newFrom) {
      const oldOffsets = codePointOffsets(before.slice(change.oldFrom, change.oldTo));
      const newOffsets = codePointOffsets(after.slice(change.newFrom, change.newTo));
      const oldFrom = oldOffsets.indexOf(from - change.oldFrom), oldTo = oldOffsets.indexOf(to - change.oldFrom);
      const newFrom = Math.floor(oldFrom / (oldOffsets.length - 1) * (newOffsets.length - 1));
      const newTo = Math.ceil(oldTo / (oldOffsets.length - 1) * (newOffsets.length - 1));
      append(change.newFrom + newOffsets[newFrom], change.newFrom + newOffsets[newTo]);
    }
  }
  return mergeSpans(result);
}

const voiceMappingError = () => new Error("複数話者の本文と話者タグが一致しないため、安全に編集できません。話者タグ外の本文や、重なったタグを確認してください。");

function decodeVoiceEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", lrm: "\u200e", rlm: "\u200f" };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|lrm|rlm);/gi, (raw, entity: string) => {
    if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? raw;
    const point = entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return !Number.isFinite(point) || point <= 0 || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff ? "\ufffd" : String.fromCodePoint(point);
  }).replace(/\u0000/g, "\ufffd");
}

function compactVoiceSpans(spans: VoiceTextSpan[]): VoiceTextSpan[] {
  const result: VoiceTextSpan[] = [];
  for (const span of spans.sort((a, b) => a.from - b.from || a.to - b.to)) {
    if (span.to <= span.from) continue;
    const previous = result.at(-1);
    if (previous && !previous.label && !span.label && previous.speaker === span.speaker && previous.to === span.from) previous.to = span.to;
    else result.push({ ...span });
  }
  return result;
}

/** Validate persisted offsets before they can suppress a heading during export. */
function validatedVoiceSpans(text: string, value: unknown): VoiceTextSpan[] {
  if (!Array.isArray(value) || !value.length || value.length > 200000) throw voiceMappingError();
  const result: VoiceTextSpan[] = [];
  let cursor = 0;
  for (const item of value) {
    if (!record(item) || !Number.isSafeInteger(item.from) || !Number.isSafeInteger(item.to) || Number(item.from) < cursor || Number(item.to) <= Number(item.from) || Number(item.to) > text.length || !(item.speaker === null || typeof item.speaker === "string" && item.speaker.trim() && item.speaker.length <= 200 && !/[\u0000-\u001f]/.test(item.speaker)) || item.label !== undefined && item.label !== true) throw voiceMappingError();
    const from = Number(item.from), to = Number(item.to);
    if (!isTextBoundary(text, from) || !isTextBoundary(text, to) || text.slice(cursor, from).trim()) throw voiceMappingError();
    result.push({ from, to, speaker: item.speaker as string | null, ...(item.label ? { label: true as const } : {}) }); cursor = to;
  }
  if (text.slice(cursor).trim()) throw voiceMappingError();
  return compactVoiceSpans(result);
}

/**
 * Reproduce the parser's displayed labels while tracking each source character.
 * This is linear in payload size; exact text equality rejects ambiguous markup.
 */
function getVoiceSpans(cue: RevisedCue): VoiceTextSpan[] | undefined {
  if (cue.voiceSpans) return cue.voiceSpans;
  if (!cue.isMultiVoice) return undefined;
  const cached = sourceVoiceSpans.get(cue); if (cached) return cached;
  if (!cue.voicePayload || cue.voicePayload.length > 4_000_000) throw voiceMappingError();
  const rawSpans: VoiceTextSpan[] = [], strings: string[] = [];
  let length = 0, current: string | null = null, lastSpeaker: string | null = null, cursor = 0;
  const append = (text: string, speaker: string | null, label = false) => {
    if (!text) return;
    strings.push(text); rawSpans.push({ from: length, to: length + text.length, speaker, ...(label ? { label: true as const } : {}) }); length += text.length;
  };
  const body = (raw: string) => {
    const text = decodeVoiceEntities(raw);
    if (current === null && text.trim()) throw voiceMappingError();
    append(text, current ?? lastSpeaker);
  };
  const tags = /<(?:(?:\d{2,}):)?[0-5]\d:[0-5]\d\.\d{3}>|<br\s*\/?>|<\/?(?:b|i|u|ruby|rt|c|v|lang)(?=[.\s>])[^>]*>/gi;
  for (const match of cue.voicePayload.matchAll(tags)) {
    body(cue.voicePayload.slice(cursor, match.index));
    const tag = match[0], voice = /^<v(?:\.[^\s>]+)*[ \t]+([^>]+)>$/.exec(tag);
    if (voice) {
      const name = decodeVoiceEntities(voice[1]).trim();
      if (!name || name.length > 200 || /[\u0000-\u001f]/.test(name)) throw voiceMappingError();
      current = name; lastSpeaker = name;
      append(`\n${decodeVoiceEntities(voice[1].trim())}：`, name, true);
    } else if (/^<\/v(?=[.\s>])/i.test(tag)) current = null;
    else if (/^<br\s*\/?>$/i.test(tag)) append("\n", current ?? lastSpeaker);
    cursor = match.index! + tag.length;
  }
  body(cue.voicePayload.slice(cursor));
  if (rawSpans.length > 200000) throw voiceMappingError();
  const rawText = strings.join("");
  const removed = mergeSpans([
    { cueId: cue.id, from: 0, to: rawText.length - rawText.trimStart().length },
    { cueId: cue.id, from: rawText.trimEnd().length, to: rawText.length },
    ...[...rawText.matchAll(/\n[ \t]*\n+/g)].map(match => ({ cueId: cue.id, from: match.index! + 1, to: match.index! + match[0].length })),
  ].filter(span => span.to > span.from));
  const kept = retainedParts({ ...cue, text: rawText }, 0, rawText.length, removed);
  const normalized = kept.map(part => rawText.slice(part.from, part.to)).join("");
  if (normalized !== cue.text) throw voiceMappingError();
  const mapped: VoiceTextSpan[] = [];
  let partIndex = 0, outputOffset = 0;
  for (const span of rawSpans) {
    while (partIndex < kept.length && kept[partIndex].to <= span.from) { outputOffset += kept[partIndex].to - kept[partIndex].from; partIndex++; }
    let offset = outputOffset;
    for (let index = partIndex; index < kept.length && kept[index].from < span.to; index++) {
      const part = kept[index], from = Math.max(part.from, span.from), to = Math.min(part.to, span.to);
      if (to > from) mapped.push({ ...span, from: offset + from - part.from, to: offset + to - part.from });
      offset += part.to - part.from;
    }
  }
  const result = validatedVoiceSpans(cue.text, compactVoiceSpans(mapped));
  sourceVoiceSpans.set(cue, result); return result;
}

/** Heading edits change structure; ordinary speech corrections inherit its voice. */
function remapVoiceSpans(text: string, changes: readonly TextChange[], voices: VoiceTextSpan[]): VoiceTextSpan[] {
  const result: VoiceTextSpan[] = [];
  for (const change of changes) {
    if (change.equal) {
      for (const voice of voices) {
        const from = Math.max(voice.from, change.oldFrom), to = Math.min(voice.to, change.oldTo);
        if (to > from) result.push({ ...voice, from: change.newFrom + from - change.oldFrom, to: change.newFrom + to - change.oldFrom });
      }
      continue;
    }
    if (voices.some(voice => voice.label && (change.oldFrom < voice.to && change.oldTo > voice.from || change.oldFrom === change.oldTo && change.oldFrom > voice.from && change.oldFrom < voice.to))) throw new Error("複数話者の名前の見出しは残して、本文を修正してください。話者の変更には文字を選択して話者を変更する機能を使ってください。");
    if (change.newFrom === change.newTo) continue;
    const overlaps = voices.filter(voice => !voice.label && voice.from < change.oldTo && voice.to > change.oldFrom);
    let voice: VoiceTextSpan | undefined;
    if (overlaps.length) {
      if (new Set(overlaps.map(item => item.speaker)).size > 1) throw voiceMappingError();
      voice = overlaps[0];
    } else {
      const endingLabel = voices.find(item => item.label && item.to === change.oldFrom);
      const startingLabel = voices.find(item => item.label && item.from === change.oldFrom);
      voice = voices.find(item => !item.label && item.from <= change.oldFrom && item.to > change.oldFrom)
        ?? endingLabel
        ?? voices.findLast(item => !item.label && item.to <= change.oldFrom)
        ?? startingLabel
        ?? voices.find(item => !item.label && item.from >= change.oldFrom);
    }
    if (!voice && text.slice(change.newFrom, change.newTo).trim()) throw voiceMappingError();
    if (voice) result.push({ from: change.newFrom, to: change.newTo, speaker: voice.speaker });
  }
  return validatedVoiceSpans(text, compactVoiceSpans(result));
}

type VoiceRun = { speaker: string | null; text: string };
function voiceRuns(cue: RevisedCue, voices: VoiceTextSpan[], parts: readonly { from: number; to: number }[]): VoiceRun[] {
  const runs: VoiceRun[] = [];
  let partIndex = 0, separate = false;
  for (const voice of voices) {
    if (voice.label) { separate = true; continue; }
    while (partIndex < parts.length && parts[partIndex].to <= voice.from) partIndex++;
    for (let index = partIndex; index < parts.length && parts[index].from < voice.to; index++) {
      const from = Math.max(voice.from, parts[index].from), to = Math.min(voice.to, parts[index].to);
      if (to <= from) continue;
      const text = cue.text.slice(from, to), previous = runs.at(-1);
      if (previous && previous.speaker === voice.speaker && !separate) previous.text += text;
      else runs.push({ speaker: voice.speaker, text });
      separate = false;
    }
  }
  return runs.filter(run => run.text.trim());
}

function voicedOutput(runs: VoiceRun[]): Pick<Cue, "text" | "speaker" | "isMultiVoice" | "voicePayload"> {
  const distinct = new Set(runs.map(run => run.speaker));
  if (distinct.size <= 1) return { text: runs.map(run => run.text.trim()).join("\n"), speaker: runs[0]?.speaker ?? null, isMultiVoice: false, voicePayload: undefined };
  if (distinct.has(null)) throw voiceMappingError();
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n[ \t]*\n+/g, "\n");
  return { text: runs.map(run => `${run.speaker}：${run.text.trim()}`).join("\n"), speaker: null, isMultiVoice: true,
    voicePayload: runs.map(run => `<v ${escape(run.speaker!)}>${escape(run.text.trim())}</v>`).join("\n") };
}

function remapRevisionCuts(doc: EditorDocument, state: EditorState, cues: readonly Cue[], replacements: ReadonlyMap<string, readonly string[]>, mapSpan: (span: TextSpan) => TextSpan[]): CutRecord[] {
  const nextById = new Map(cues.map(cue => [cue.id, cue]));
  return state.cuts.map(cut => {
    const originalSpans = cutTextSpans(doc, cut);
    if (!cut.sourceCueIds.some(id => replacements.has(id)) && !originalSpans.some(span => replacements.has(span.cueId))) return cut;
    const spans = mergeSpans(originalSpans.flatMap(mapSpan));
    const sourceCueIds = [...new Set([...cut.sourceCueIds.flatMap(id => replacements.get(id) ?? [id]), ...spans.map(span => span.cueId)])];
    return { ...cut, sourceCueIds, spans, tokenIds: undefined, lineIds: undefined,
      text: spans.length ? spans.map(span => nextById.get(span.cueId)!.text.slice(span.from, span.to)).join(" / ") : cut.text };
  });
}

/** Correct subtitle text without making or moving an audio/video cut. */
export function replaceCueText(doc: EditorDocument, state: EditorState, cueId: string, replacement: string): EditorState {
  const cue = doc.cueById.get(cueId);
  if (!cue) throw new Error("修正する字幕が見つかりません。");
  if (typeof replacement !== "string") throw new Error("修正後の字幕を入力してください。");
  const text = replacement.replace(/\r\n?/g, "\n");
  if (!text.trim() || text.length > 2_000_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error("字幕は空欄にできません。全文を消す場合は行の削除を使ってください。");
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)) throw new Error("字幕に不完全な文字が含まれています。");
  if (text === cue.text) return state;
  const changes = textChanges(cue.text, text);
  const voices = getVoiceSpans(cue);
  const voiceSpans = voices ? remapVoiceSpans(text, changes, voices) : undefined;
  const voiceOutput = voiceSpans ? voicedOutput(voiceRuns({ ...cue, text }, voiceSpans, [{ from: 0, to: text.length }])) : undefined;
  const revised: RevisedCue = { ...cue, text, isMultiVoice: voiceOutput?.isMultiVoice ?? false, voicePayload: voiceOutput?.voicePayload,
    ...(voiceSpans ? { voiceSpans, speaker: voiceOutput!.speaker } : {}) };
  const cueRevisions = doc.cues.map(item => item.id === cueId ? revised : item);
  const replacements = new Map([[cueId, [cueId]]]);
  const cuts = remapRevisionCuts(doc, state, cueRevisions, replacements, span => span.cueId === cueId ? remapChangedText(span, cue.text, text, changes) : [{ ...span }]);
  return { ...state, cueRevisions, cuts };
}

export type SpeakerSelectionScope = "selection" | "fromSelection";

/** Split selected source text into independently editable speaker cues. */
export function changeSelectionSpeaker(doc: EditorDocument, state: EditorState, spans: readonly TextSpan[], speaker: string | null, options: { scope?: SpeakerSelectionScope } = {}): EditorState {
  const name = speaker === null ? null : typeof speaker === "string" ? speaker.trim() : "";
  if (name !== null && (!name || name.length > 120 || /[\u0000-\u001f]/.test(name))) throw new Error("話者名は1〜120文字で入力してください。");
  let selected = validatedTextSpans(doc, spans);
  if (!selected.length) return state;
  if (options.scope !== undefined && options.scope !== "selection" && options.scope !== "fromSelection") throw new Error("話者を変更する範囲が正しくありません。");
  if (options.scope === "fromSelection") {
    if (new Set(selected.map(span => span.cueId)).size !== 1) throw new Error("字幕の途中から末尾までを変更する場合は、1つの字幕内を選択してください。");
    const first = selected[0];
    selected = [{ cueId: first.cueId, from: Math.min(...selected.map(span => span.from)), to: doc.cueById.get(first.cueId)!.text.length }];
  }
  const byCue = new Map<string, TextSpan[]>();
  for (const span of selected) { const list = byCue.get(span.cueId) ?? []; list.push(span); byCue.set(span.cueId, list); }
  const fragments = new Map<string, { from: number; to: number; cue: RevisedCue }[]>();
  const cueRevisions: RevisedCue[] = [];
  const speakerOverrides = { ...state.speakerOverrides };
  for (const cue of doc.cues) {
    const ranges = byCue.get(cue.id);
    const originalSpeaker = canonicalSpeaker(cue, state);
    if (!ranges) { cueRevisions.push(cue); continue; }
    const sourceVoices = getVoiceSpans(cue);
    const voices = sourceVoices?.map(voice => !voice.label && own(state.speakerOverrides, cue.id) ? { ...voice, speaker: originalSpeaker } : voice);
    const selectedVoices = voices?.filter(voice => !voice.label && ranges.some(range => range.from < voice.to && range.to > voice.from));
    if (!voices && originalSpeaker === name || selectedVoices?.length && selectedVoices.every(voice => voice.speaker === name)) { cueRevisions.push(cue); continue; }
    if (voices && !selectedVoices?.length) throw new Error("話者名の見出しではなく、発言の本文を選択してください。");
    if (voices?.some(voice => voice.label && ranges.some(range => range.from < voice.to && range.to > voice.from && !(range.from <= voice.from && range.to >= voice.to)))) throw new Error("話者名の見出しの途中では分割できません。発言の本文を選択してください。");
    const voiceBoundaries: number[] = [];
    let priorVoice: string | null | undefined, labelStart: number | undefined;
    for (const voice of voices ?? []) {
      if (voice.label) { labelStart = voice.from; continue; }
      if (!cue.text.slice(voice.from, voice.to).trim()) continue;
      const boundary = labelStart ?? voice.from;
      if (priorVoice !== undefined && priorVoice !== voice.speaker && !ranges.some(range => range.from < boundary && range.to > boundary)) voiceBoundaries.push(boundary);
      priorVoice = voice.speaker; labelStart = undefined;
    }
    const boundaries = [...new Set([0, cue.text.length, ...ranges.flatMap(span => [span.from, span.to]), ...voiceBoundaries])].sort((a, b) => a - b);
    const count = boundaries.length - 1;
    if (cue.end - cue.start < count) throw new Error("この字幕は短すぎるため、選択位置で分割できません。より大きい範囲を選択してください。");
    const times = [cue.start];
    for (let index = 1; index < count; index++) times.push(Math.max(times[index - 1] + 1, Math.min(cue.end - (count - index), timeAt(cue, boundaries[index]))));
    times.push(cue.end);
    const pieces = boundaries.slice(0, -1).map((from, index) => {
      const to = boundaries[index + 1];
      const isSelected = ranges.some(span => span.from <= from && span.to >= to);
      const fragmentVoices = voices?.flatMap(voice => {
        const left = Math.max(from, voice.from), right = Math.min(to, voice.to);
        return right > left ? [{ ...voice, from: left - from, to: right - from, ...(!voice.label && isSelected ? { speaker: name } : {}) }] : [];
      });
      const remainingVoices = fragmentVoices?.filter(voice => !voice.label && cue.text.slice(from + voice.from, from + voice.to).trim());
      if (!isSelected && remainingVoices && new Set(remainingVoices.map(voice => voice.speaker)).size > 1) throw voiceMappingError();
      const nextSpeaker = isSelected ? name : remainingVoices?.[0]?.speaker ?? originalSpeaker;
      const next: RevisedCue = { ...cue, id: count === 1 ? cue.id : `cue-edit-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${++sequence}`}`,
        text: cue.text.slice(from, to), start: times[index], end: times[index + 1], speaker: nextSpeaker,
        sourceIds: [...cue.sourceIds], isMultiVoice: false, voicePayload: undefined,
        ...(fragmentVoices ? { voiceSpans: compactVoiceSpans(fragmentVoices) } : {}),
        ...(count > 1 || cue.estimatedTiming ? { estimatedTiming: true } : {}) };
      return { from, to, cue: next };
    });
    fragments.set(cue.id, pieces); cueRevisions.push(...pieces.map(piece => piece.cue)); delete speakerOverrides[cue.id];
  }
  if (!fragments.size) return state;
  if (cueRevisions.length > 200000) throw new Error("分割後の字幕数が200,000件を超えます。ファイルを分けて編集してください。");
  const replacements = new Map([...fragments].map(([id, pieces]) => [id, pieces.map(piece => piece.cue.id)]));
  const cuts = remapRevisionCuts(doc, state, cueRevisions, replacements, span => {
    const pieces = fragments.get(span.cueId);
    if (!pieces) return [{ ...span }];
    return pieces.flatMap(piece => {
      const from = Math.max(span.from, piece.from), to = Math.min(span.to, piece.to);
      return to > from ? [{ cueId: piece.cue.id, from: from - piece.from, to: to - piece.from }] : [];
    });
  });
  const nextById = new Map(cueRevisions.map(cue => [cue.id, cue]));
  const positions = new Map(doc.cues.map((cue, index) => [cue.id, index]));
  const forcedJoins = state.forcedJoins.flatMap(id => {
    const index = positions.get(id);
    if (index === undefined || index >= doc.cues.length - 1) return [];
    const nextId = doc.cues[index + 1].id;
    if (!fragments.has(id) && !fragments.has(nextId)) return [id];
    const leftId = replacements.get(id)?.at(-1) ?? id, rightId = replacements.get(nextId)?.[0] ?? nextId;
    const left = nextById.get(leftId)!, right = nextById.get(rightId)!;
    const leftSpeaker = own(speakerOverrides, leftId) ? speakerOverrides[leftId] : left.speaker;
    const rightSpeaker = own(speakerOverrides, rightId) ? speakerOverrides[rightId] : right.speaker;
    return leftSpeaker === rightSpeaker && !left.isMultiVoice && !right.isMultiVoice ? [leftId] : [];
  });
  return { ...state, cueRevisions, cuts, speakerOverrides, forcedJoins: [...new Set(forcedJoins)] };
}

export function findFillers(doc: EditorDocument, terms: readonly string[] = DEFAULT_FILLERS): FillerCandidate[] {
  const candidates: FillerCandidate[] = [];
  for (const cue of doc.cues) {
    const found: FillerCandidate[] = [];
    for (const term of cleanTerms(terms)) {
      let from = cue.text.indexOf(term);
      while (from >= 0) {
        const termEnd = from + term.length;
        // A filler and its following comma form one removable phrase. Keep
        // sentence stops and newlines; never consume the following dialogue.
        const delimiter = /^[\t \u3000]*[、，,][\t \u3000]*/.exec(cue.text.slice(termEnd));
        const to = termEnd + (delimiter?.[0].length ?? 0);
        const repeated = cue.text.slice(Math.max(0, from - term.length), from) === term || cue.text.slice(termEnd, termEnd + term.length) === term;
        const latinInsideWord = /[A-Za-z0-9]/.test(term[0]) && /[A-Za-z0-9]/.test(cue.text[from - 1] || "") || /[A-Za-z0-9]/.test(term.at(-1)!) && /[A-Za-z0-9]/.test(cue.text[termEnd] || "");
        if (!repeated && !latinInsideWord && !found.some(c => c.from < to && c.to > from)) {
          const tokenIds = (doc.linesByCue.get(cue.id) ?? []).flatMap(l => l.tokens).filter(t => t.from >= from && t.to <= to).map(t => t.id);
          found.push({ id: `filler-${cue.id}-${from}-${to}`, term, text: cue.text.slice(from, to), cueId: cue.id, from, to, ...positiveBounds(cue, from, to), tokenIds, spans: [{ cueId: cue.id, from, to }] });
        }
        from = cue.text.indexOf(term, from + Math.max(1, term.length));
      }
    }
    candidates.push(...found.sort((a, b) => a.from - b.from));
  }
  return candidates;
}

export function deleteFillers(doc: EditorDocument, state: EditorState, candidates: readonly FillerCandidate[]): EditorState {
  let next = state;
  for (const candidate of candidates) {
    const cue = doc.cueById.get(candidate.cueId);
    if (!cue || cue.text.slice(candidate.from, candidate.to) !== candidate.text || getDeletedSpans(doc, next).some(s => s.cueId === cue.id && s.from <= candidate.from && s.to >= candidate.to)) continue;
    next = addCut(next, { start: candidate.start, end: candidate.end, kind: "filler", precision: "estimated", text: candidate.text, sourceCueIds: [cue.id], tokenIds: candidate.tokenIds, spans: candidate.spans });
  }
  return next;
}

export function normalizeCuts(cuts: readonly CutRecord[], durationMs = Infinity): CutRange[] {
  const limit = Number.isFinite(durationMs) ? Math.max(0, durationMs) : Infinity;
  const sorted = cuts.filter(c => Number.isFinite(c.start) && Number.isFinite(c.end)).map(c => ({ ...c, start: Math.max(0, Math.round(c.start)), end: Math.min(limit, Math.round(c.end)) })).filter(c => c.end > c.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const ranges: CutRange[] = [];
  for (const cut of sorted) {
    const previous = ranges.at(-1);
    if (previous && cut.start <= previous.end) {
      previous.end = Math.max(previous.end, cut.end); previous.durationMs = previous.end - previous.start;
      previous.editIds = [...new Set([...previous.editIds, cut.id])]; previous.kinds = [...new Set([...previous.kinds, cut.kind])];
      previous.precisions = [...new Set([...previous.precisions, cut.precision])]; previous.estimated ||= cut.precision === "estimated";
      previous.precision = previous.estimated ? "estimated" : previous.precisions.length === 1 ? previous.precisions[0] : "manual";
      previous.sourceCueIds = [...new Set([...previous.sourceCueIds, ...cut.sourceCueIds])];
    } else ranges.push({ start: cut.start, end: cut.end, durationMs: cut.end - cut.start, editIds: [cut.id], kinds: [cut.kind], precisions: [cut.precision], precision: cut.precision, estimated: cut.precision === "estimated", sourceCueIds: [...cut.sourceCueIds] });
  }
  return ranges;
}

export function getKeepRanges(cuts: readonly CutRecord[], durationMs: number): { start: number; end: number; durationMs: number }[] {
  const ranges = normalizeCuts(cuts, durationMs), keep: { start: number; end: number; durationMs: number }[] = [];
  let cursor = 0;
  for (const range of ranges) { if (range.start > cursor) keep.push({ start: cursor, end: range.start, durationMs: range.start - cursor }); cursor = range.end; }
  if (cursor < durationMs) keep.push({ start: cursor, end: durationMs, durationMs: durationMs - cursor });
  return keep;
}

/** Derived from the input VTT, rather than stored as an undoable text edit. */
export function getTranscriptTailCut(doc: EditorDocument, mediaDurationMs?: number): CutRecord | null {
  if (mediaDurationMs === undefined) return null;
  if (!Number.isSafeInteger(mediaDurationMs) || mediaDurationMs < 0) throw new Error("メディアの長さは0以上の整数ミリ秒で指定してください。");
  if (mediaDurationMs <= doc.durationMs) return null;
  return { id: "automatic-transcript-tail", start: doc.durationMs, end: mediaDurationMs, kind: "tail", precision: "cue", text: "VTTの終了時刻より後を自動カット", sourceCueIds: [] };
}

/** Effective media cuts include the automatic tail without mutating history. */
export function getEffectiveCuts(doc: EditorDocument, state: EditorState, mediaDurationMs?: number): CutRecord[] {
  const tail = state.keepTail ? null : getTranscriptTailCut(doc, mediaDurationMs);
  return tail ? [...state.cuts, tail] : state.cuts;
}

/** A point is shifted by the union of removed media before it, exactly once. */
export function toEditedTime(originalMs: number, cuts: readonly CutRange[]): number {
  let removed = 0;
  for (const cut of cuts) { if (cut.start >= originalMs) break; removed += Math.max(0, Math.min(originalMs, cut.end) - cut.start); }
  return Math.max(0, originalMs - removed);
}

function survivingIntervals(start: number, end: number, cuts: CutRange[]): { start: number; end: number }[] {
  const result: { start: number; end: number }[] = [];
  let cursor = start;
  for (const cut of cuts) {
    if (cut.end <= cursor || cut.start >= end) continue;
    if (cut.start > cursor) result.push({ start: cursor, end: Math.min(end, cut.start) });
    cursor = Math.max(cursor, Math.min(end, cut.end));
  }
  if (cursor < end) result.push({ start: cursor, end });
  return result;
}

export function buildEditedCues(doc: EditorDocument, state: EditorState, options: GroupOptions & { timeline?: "original" | "edited" } = {}): EditedCue[] {
  const cuts = normalizeCuts(state.cuts, doc.durationMs), spansByCue = getDeletedSpansByCue(doc, state);
  const groupOfCue = new Map(buildGroups(doc, state, options).flatMap(group => group.cueIds.map(id => [id, group.id] as const)));
  const pieces: (EditedCue & { groupId: string })[] = [];
  for (const cue of doc.cues) {
    const spans = spansByCue.get(cue.id) ?? [];
    const keptParts = retainedParts(cue, 0, cue.text.length, spans);
    const keptText = keptParts.map(s => cue.text.slice(s.from, s.to)).join("");
    if (!keptText.trim()) continue;
    const override = own(state.speakerOverrides, cue.id);
    const needsVoices = cue.voiceSpans || cue.isMultiVoice && (spans.length > 0 || override || Object.keys(state.aliases).length > 0 || cuts.some(cut => cut.start < cue.end && cut.end > cue.start));
    const voices = needsVoices ? getVoiceSpans(cue) : undefined;
    if (voices && !voiceRuns(cue, voices, keptParts).length) continue;
    const intervals = survivingIntervals(cue.start, cue.end, cuts);
    if (!intervals.length) throw new Error(`字幕「${cue.text.slice(0, 24)}」の表示時間がすべてカットされています。本文は残しています。このカットを取り消すか、カット時刻を調整してください。字幕も削除する場合は文字を明示選択してください。`);
    const texts = intervals.map(() => "");
    const textParts: TextSpan[][] = intervals.map(() => []);
    // Media-only cuts never delete dialogue. Each retained token fragment is
    // assigned once to the closest surviving interval using estimated timing.
    for (const line of doc.linesByCue.get(cue.id) ?? []) for (const token of line.tokens) {
      for (const part of retainedParts(cue, token.from, token.to, spans)) {
        const midpoint = (timeAt(cue, part.from) + timeAt(cue, part.to)) / 2;
        let best = 0, bestDistance = Infinity;
        for (let index = 0; index < intervals.length; index += 1) {
          const interval = intervals[index];
          const distance = midpoint < interval.start ? interval.start - midpoint : midpoint > interval.end ? midpoint - interval.end : 0;
          if (distance < bestDistance) { best = index; bestDistance = distance; }
        }
        texts[best] += cue.text.slice(part.from, part.to);
        textParts[best].push(part);
      }
    }
    const changed = keptText !== cue.text || intervals.length !== 1 || intervals[0].start !== cue.start || intervals[0].end !== cue.end;
    for (let index = 0; index < intervals.length; index += 1) {
      let text = texts[index].trim();
      if (!text) continue;
      const range = intervals[index];
      const multiUnchanged = cue.isMultiVoice && !changed && !override && Object.keys(state.aliases).length === 0;
      let voiceOutput: Pick<Cue, "speaker" | "isMultiVoice" | "voicePayload"> = { speaker: getDisplaySpeaker(cue, state), isMultiVoice: !!multiUnchanged, voicePayload: multiUnchanged ? cue.voicePayload : undefined };
      if (voices && !multiUnchanged) {
        const output = voicedOutput(voiceRuns(cue, voices, textParts[index]).map(run => ({ ...run, speaker: displayLabel(override ? state.speakerOverrides[cue.id] : run.speaker, state.aliases) })));
        text = output.text; voiceOutput = output;
        if (!text.trim()) continue;
      }
      // Voice offsets describe the editable source text, not this filtered output.
      const { voiceSpans: _voiceSpans, ...source } = cue;
      pieces.push({ ...source, ...voiceOutput, id: `${cue.id}:part:${index}`, text, start: range.start, end: range.end, sourceIds: [...cue.sourceIds], originalStart: range.start, originalEnd: range.end, precision: changed || cue.estimatedTiming ? "estimated" : "cue", sourceCueIds: [cue.id], groupId: groupOfCue.get(cue.id)! });
    }
  }
  const result: (EditedCue & { groupId: string })[] = [];
  for (const piece of pieces) {
    const previous = result.at(-1);
    const hasCutBetween = previous && cuts.some(c => c.start < Math.max(previous.originalEnd, piece.originalEnd) && c.end > Math.min(previous.originalStart, piece.originalStart));
    if (previous && previous.groupId === piece.groupId && !hasCutBetween && piece.originalStart >= previous.originalStart && previous.speaker === piece.speaker && !previous.isMultiVoice && !piece.isMultiVoice) {
      previous.text += `\n${piece.text}`; previous.end = Math.max(previous.end, piece.end); previous.originalEnd = Math.max(previous.originalEnd, piece.originalEnd);
      previous.sourceCueIds.push(...piece.sourceCueIds); previous.sourceIds.push(...piece.sourceIds); previous.sourceCount += piece.sourceCount;
      if (piece.precision === "estimated") previous.precision = "estimated";
      if (previous.settings !== piece.settings) previous.settings = undefined;
    } else result.push({ ...piece, sourceCueIds: [...piece.sourceCueIds], sourceIds: [...piece.sourceIds] });
  }
  return result.map(({ groupId: _groupId, ...cue }) => ({ ...cue, start: options.timeline === "edited" ? toEditedTime(cue.originalStart, cuts) : cue.originalStart, end: options.timeline === "edited" ? toEditedTime(cue.originalEnd, cuts) : cue.originalEnd }));
}

function knownMediaDuration(options: Partial<ExportOptions>): number | undefined {
  return typeof options.mediaDurationMs === "number" && Number.isSafeInteger(Math.round(options.mediaDurationMs)) && options.mediaDurationMs >= 0 ? Math.round(options.mediaDurationMs) : undefined;
}

function exportDuration(doc: EditorDocument, options: Partial<ExportOptions>): number {
  return knownMediaDuration(options) ?? doc.durationMs;
}

export function exportCutJson(doc: EditorDocument, state: EditorState, options: ExportOptions): string {
  const mediaDuration = knownMediaDuration(options), mediaDurationKnown = mediaDuration !== undefined;
  const durationMs = exportDuration(doc, options);
  const keepUntilMs = state.keepTail ? durationMs : Math.min(doc.durationMs, durationMs);
  const effectiveCuts = getEffectiveCuts(doc, state, mediaDuration);
  const tail = state.keepTail ? null : getTranscriptTailCut(doc, mediaDuration);
  const cutRanges = normalizeCuts(effectiveCuts, durationMs);
  return JSON.stringify({ schemaVersion: 1, kind: "vtt-dialogue-cut-list", timebase: "milliseconds", timeline: "original", sourceFile: options.sourceFile, durationMs, mediaDurationMs: mediaDuration ?? null, subtitleEndMs: doc.durationMs, truncateAfterMs: state.keepTail ? null : doc.durationMs, trailingMediaPolicy: state.keepTail ? "preserve" : "discard", coveredUntilMs: durationMs, keepRangesComplete: !state.keepTail || mediaDurationKnown, cutRangesComplete: mediaDurationKnown, totalCutDurationMsKnown: mediaDurationKnown, subtitleExtendsPastMediaEnd: mediaDurationKnown && doc.durationMs > durationMs, outOfBoundsEditIds: state.cuts.filter(c => c.end > durationMs).map(c => c.id),
    timingNotes: ["すべての start/end は元メディアの先頭を 0 とするミリ秒です。", "単語・フィラー・複数行字幕内の行の時刻は、文字数による推定です。音声との強制アラインメントは行っていません。", "cue は元 VTT の字幕区間、audio は音声解析、gap は字幕のない区間を示します。字幕のない区間が無音とは限りません。", state.keepTail ? "末尾保持が選択されています。字幕の終了後も、明示的に削除した範囲以外の映像・音声を残します。" : "truncateAfterMs（入力VTTの最も遅い終了時刻）以降のメディアはカット済みとして切り捨てます。途中の字幕の空白や先頭部分には、この末尾ルールを適用しません。", "keepRanges は残す区間の完全な指定です。元メディアがこれより短い場合は実際の長さで切り詰め、映像・音声を付け足さないでください。", "cutRanges は重複を統合したカット区間です。editIds は edits（個々の編集）または automaticCuts（自動末尾カット）を参照します。自動カットは取り消し履歴には入りません。", state.keepTail ? "メディア全長が未確認の場合、末尾を含む残す範囲を確定できません。実メディアの全長に合わせて保持範囲を補ってください。" : "mediaDurationMs が null の場合も truncateAfterMs 以降を必ず切り捨ててください。末尾の実際の終了時刻が未確認のため、cutRangesComplete と totalCutDurationMsKnown は false となり、cutRanges と totalCutDurationMs は coveredUntilMs までの値です。実メディアの長さを確認後に末尾区間を補ってください。"],
    totalCutDurationMs: cutRanges.reduce((sum, r) => sum + r.durationMs, 0), cutRanges, keepRanges: getKeepRanges(state.cuts, keepUntilMs), edits: state.cuts.map(cloneCut), automaticCuts: tail ? [cloneCut(tail)] : [], speakerAliases: { ...state.aliases }, speakerOverrides: { ...state.speakerOverrides }, forcedJoins: [...state.forcedJoins] }, null, 2);
}

function csvCell(value: unknown): string { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
export function exportCutCsv(doc: EditorDocument, state: EditorState, options: Partial<ExportOptions> = {}): string {
  const mediaDuration = knownMediaDuration(options);
  if (mediaDuration === undefined) throw new Error("CSVに末尾のカット終了時刻を記録するには、元の動画・音声を追加して長さを確認してください。JSONでは動画の全長が未確認でもVTT終了後を切り捨てる指定を保存できます。");
  const ranges = normalizeCuts(getEffectiveCuts(doc, state, mediaDuration), mediaDuration);
  const header = ["range", "start_ms", "end_ms", "duration_ms", "precision", "estimated", "kinds", "edit_ids", "source_cue_ids"];
  return "\uFEFF" + [header.join(","), ...ranges.map((r, i) => [i + 1, r.start, r.end, r.durationMs, r.precision, r.estimated, r.kinds.join("|"), r.editIds.join("|"), r.sourceCueIds.join("|")].map(csvCell).join(","))].join("\r\n") + "\r\n";
}

export function exportProjectJson(doc: EditorDocument, state: EditorState, options: ExportOptions): string {
  const resolved = resolveEditorDocument(doc, state);
  const { cueRevisions: _cueRevisions, ...persistedState } = state;
  return JSON.stringify({ schemaVersion: 1, kind: "vtt-dialogue-project", sourceFile: options.sourceFile, mediaDurationMs: knownMediaDuration(options), truncateAfterMs: state.keepTail ? null : resolved.durationMs, trailingMediaPolicy: state.keepTail ? "preserve" : "discard", fillerTerms: resolved.fillerTerms, cues: resolved.cues, state: persistedState }, null, 2);
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(s => typeof s === "string"); }
function safeDictionary(value: unknown, nullable = false): Record<string, string | null> {
  if (!record(value)) throw new Error("話者設定の形式が正しくありません。");
  const result: Record<string, string | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.has(key) || key.length > 200 || !(typeof item === "string" && item.length <= 200 && !/[\r\n\u0000-\u001f]/.test(item) || nullable && item === null)) throw new Error("話者設定に無効な値があります。");
    result[key] = item as string | null;
  }
  return result;
}

export function importProjectJson(raw: string): { doc: EditorDocument; state: EditorState; sourceFile: string; mediaDurationMs?: number } {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("プロジェクト JSON を読み込めません。"); }
  if (!record(value) || value.schemaVersion !== 1 || value.kind !== "vtt-dialogue-project" || !Array.isArray(value.cues) || value.cues.length > 200000 || !record(value.state)) throw new Error("対応する VTT Dialogue プロジェクトではありません。");
  const cues: RevisedCue[] = value.cues.map((rawCue: unknown) => {
    if (!record(rawCue) || typeof rawCue.id !== "string" || typeof rawCue.start !== "number" || typeof rawCue.end !== "number" || typeof rawCue.text !== "string" || rawCue.text.length > 2000000 || !(typeof rawCue.speaker === "string" || rawCue.speaker === null) || !strings(rawCue.sourceIds) || !Number.isInteger(rawCue.sourceCount) || Number(rawCue.sourceCount) < 1) throw new Error("元字幕の形式が正しくありません。");
    if (rawCue.estimatedTiming !== undefined && typeof rawCue.estimatedTiming !== "boolean") throw new Error("字幕時刻の精度が正しくありません。");
    const voiceSpans = rawCue.voiceSpans !== undefined ? validatedVoiceSpans(rawCue.text, rawCue.voiceSpans) : undefined;
    return { id: rawCue.id, text: rawCue.text, start: Number(rawCue.start), end: Number(rawCue.end), speaker: rawCue.speaker as string | null, sourceIds: [...rawCue.sourceIds], sourceCount: Number(rawCue.sourceCount), wordTiming:validatedWordTiming({text:rawCue.text,start:Number(rawCue.start),end:Number(rawCue.end)},rawCue.wordTiming), ...(typeof rawCue.settings === "string" ? { settings: rawCue.settings } : {}), ...(rawCue.estimatedTiming ? { estimatedTiming: true } : {}), ...(voiceSpans ? { voiceSpans } : {}), ...(rawCue.isMultiVoice === true ? { isMultiVoice: true, voicePayload: typeof rawCue.voicePayload === "string" ? rawCue.voicePayload : undefined } : {}) };
  });
  const doc = buildDocument(cues, { fillerTerms: strings(value.fillerTerms) ? value.fillerTerms : DEFAULT_FILLERS });
  const rawState = value.state;
  if (!Array.isArray(rawState.cuts) || rawState.cuts.length > 200000 || !strings(rawState.forcedJoins)) throw new Error("編集履歴の形式が正しくありません。");
  let state = {...createEditorState(),...readReviewMarks(rawState as ReviewMarks)};
  if(rawState.mutes!==undefined){if(!Array.isArray(rawState.mutes))throw Error('ミュート区間の形式が正しくありません。');state.mutes=normalizeMutes(rawState.mutes as MuteRange[]);}
  if(rawState.keepTail!==undefined){if(typeof rawState.keepTail!=="boolean")throw new Error("末尾設定が正しくありません。");state.keepTail=rawState.keepTail;}
  state.aliases = safeDictionary(rawState.aliases) as Record<string, string>;
  state.speakerOverrides = safeDictionary(rawState.speakerOverrides, true);
  if (Object.keys(state.speakerOverrides).some(id => !doc.cueById.has(id))) throw new Error("存在しない字幕への話者設定があります。");
  state.forcedJoins = [...new Set(rawState.forcedJoins)];
  if (state.forcedJoins.some(id => !doc.cueById.has(id) || id === doc.cues.at(-1)?.id)) throw new Error("結合境界の参照が正しくありません。");
  if (value.mediaDurationMs !== undefined && typeof value.mediaDurationMs !== "number") throw new Error("メディアの長さが正しくありません。");
  const mediaDurationMs = value.mediaDurationMs as number | undefined;
  if (mediaDurationMs !== undefined && (!Number.isSafeInteger(mediaDurationMs) || mediaDurationMs < 0)) throw new Error("メディアの長さが正しくありません。");
  const limit = Math.max(doc.durationMs, mediaDurationMs ?? 0);
  if(state.mutes?.some(r=>r.end>limit))throw Error("ミュート区間が元メディアの範囲外です。");
  for (const rawCut of rawState.cuts) {
    if (!record(rawCut) || typeof rawCut.id !== "string" || !strings(rawCut.sourceCueIds) || rawCut.sourceCueIds.some(id => !doc.cueById.has(id)) || !kinds.has(rawCut.kind as CutKind) || !precisions.has(rawCut.precision as CutPrecision)) throw new Error("カット履歴の形式または字幕参照が正しくありません。");
    if (rawCut.tokenIds !== undefined && (!strings(rawCut.tokenIds) || rawCut.tokenIds.some(id => !doc.tokenById.has(id))) || rawCut.lineIds !== undefined && (!strings(rawCut.lineIds) || rawCut.lineIds.some(id => !doc.lineById.has(id)))) throw new Error("単語・行の参照が正しくありません。");
    const spans: TextSpan[] = [];
    if (rawCut.spans !== undefined) {
      if (!Array.isArray(rawCut.spans)) throw new Error("文字区間の形式が正しくありません。");
      for (const span of rawCut.spans) {
        if (!record(span) || typeof span.cueId !== "string") throw new Error("文字区間の形式が正しくありません。");
        const cue = doc.cueById.get(span.cueId);
        if (!cue || !Number.isSafeInteger(span.from) || !Number.isSafeInteger(span.to) || Number(span.from) < 0 || Number(span.to) <= Number(span.from) || Number(span.to) > cue.text.length) throw new Error("文字区間が元字幕の範囲外です。");
        if (!isTextBoundary(cue.text, Number(span.from)) || !isTextBoundary(cue.text, Number(span.to))) throw new Error("文字区間の境界が文字の途中にあります。");
        spans.push({ cueId: span.cueId, from: Number(span.from), to: Number(span.to) });
      }
    }
    if (typeof rawCut.start !== "number" || typeof rawCut.end !== "number") throw new Error("カット区間の時刻が数値ではありません。");
    const start = rawCut.start, end = rawCut.end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > limit) throw new Error("カット区間が元メディアの範囲外です。");
    state = addCut(state, { id: rawCut.id, start, end, kind: rawCut.kind as CutKind, precision: rawCut.precision as CutPrecision, text: typeof rawCut.text === "string" ? rawCut.text : undefined, sourceCueIds: rawCut.sourceCueIds, tokenIds: rawCut.tokenIds as string[] | undefined, lineIds: rawCut.lineIds as string[] | undefined, spans });
  }
  return { doc, state, sourceFile: typeof value.sourceFile === "string" ? value.sourceFile : "transcript.vtt", mediaDurationMs };
}
