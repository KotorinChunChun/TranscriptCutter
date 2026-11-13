import { buildDocument, getSpeakerParts } from "./editor";
import { parseVtt, formatTime, type Cue } from "./vtt";

export interface ComparisonSource {
  id: string;
  name: string;
  fileName: string;
  cues: Cue[];
  warnings: string[];
  generated?: boolean;
}
export type SpeakerChoice = { sourceId: string; label: string | null } | { custom: string } | null;
export interface ComparisonChoice { textSourceId: string | null; speaker: SpeakerChoice }
export interface ComparisonSession {
  schemaVersion: 1;
  kind: "vtt-dialogue-comparison";
  sources: ComparisonSource[];
  referenceId: string;
  choices: Record<string, ComparisonChoice>;
  speakerAliases: Record<string, Record<string, string>>;
}
export interface ComparisonRow {
  id: string;
  start: number;
  end: number;
  referenceCueId?: string;
  candidates: Record<string, Cue[]>;
}
export interface ComparisonCue extends Cue {
  comparisonSourceId: string;
  comparisonSourceName: string;
  comparisonSourceCueId: string;
  comparisonRowId: string;
  comparisonSpeakerSourceId: string | null;
}
export interface ComparisonSummary {
  selectedRowCount: number;
  skippedRowCount: number;
  cueCount: number;
  overlapCount: number;
  speakerCollisionCount: number;
  warnings: string[];
}

const MAX_SOURCES = 4;
const MAX_CUES_PER_SOURCE = 200_000;
const MAX_JSON_LENGTH = 100 * 1024 * 1024;
export function putGeneratedSource(session:ComparisonSession,source:ComparisonSource):ComparisonSession{
 if(!source.generated)throw Error("整理案の種類を確認してください。");
 const previous=session.sources.find(s=>s.generated);
 if(previous?.id===session.referenceId)throw Error("元字幕を時間軸の基準にしてから再生成してください。");
 return addComparisonSources(previous?removeComparisonSource(session,previous.id):session,[source]);
}
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const dictionary = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
const rowId = (sourceId: string, cueId: string) => `row:${encodeURIComponent(sourceId)}:${encodeURIComponent(cueId)}`;
const cueKey = (sourceId: string, cueId: string) => `${encodeURIComponent(sourceId)}:${encodeURIComponent(cueId)}`;
const rowOrigins = new WeakMap<readonly ComparisonRow[], { sources: ComparisonSource[]; referenceId: string }>();
const voiceLabelsCache = new WeakMap<Cue, Map<string, string>>();
const voiceTags = () => /<v(?:\.[^\s>]+)*[ \t]+([^>]+)>/g;

function boundedText(value: unknown, maximum: number, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim()) || /[\u0000-\u001f]/.test(value)) throw new Error(`${label}の形式が正しくありません。`);
  return value;
}
function identifier(value: unknown, label: string): string {
  const id = boundedText(value, 512, label);
  if (forbidden.has(id)) throw new Error(`${label}に使用できない値があります。`);
  return id;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some(key => forbidden.has(key) || !allowed.includes(key))) throw new Error(`${label}に対応していない項目があります。`);
}
function cloneCue(value: unknown): Cue {
  if (!record(value)) throw new Error("比較元の字幕形式が正しくありません。");
  const id = identifier(value.id, "字幕ID");
  if (typeof value.start !== "number" || typeof value.end !== "number" || typeof value.text !== "string" || value.text.length > 2_000_000 || !value.text.trim()) throw new Error("比較元の字幕の時刻・本文が正しくありません。");
  const speaker = value.speaker === null ? null : boundedText(value.speaker, 512, "話者名", true);
  if (!Array.isArray(value.sourceIds) || value.sourceIds.length > MAX_CUES_PER_SOURCE || value.sourceIds.some(id => typeof id !== "string" || id.length > 4096)) throw new Error("比較元の字幕参照が正しくありません。");
  if (!Number.isSafeInteger(value.sourceCount) || Number(value.sourceCount) < 1 || Number(value.sourceCount) > MAX_CUES_PER_SOURCE) throw new Error("比較元の字幕数が正しくありません。");
  if (value.settings !== undefined && (typeof value.settings !== "string" || value.settings.length > 4096)) throw new Error("比較元の字幕設定が正しくありません。");
  if (value.isMultiVoice !== undefined && typeof value.isMultiVoice !== "boolean") throw new Error("比較元の話者情報が正しくありません。");
  if (value.voicePayload !== undefined && (typeof value.voicePayload !== "string" || value.voicePayload.length > 2_000_000)) throw new Error("比較元の話者本文が正しくありません。");
  return { id, start: value.start, end: value.end, text: value.text, speaker, sourceIds: [...value.sourceIds] as string[], sourceCount: Number(value.sourceCount), ...(typeof value.settings === "string" ? { settings: value.settings } : {}), ...(value.isMultiVoice === true ? { isMultiVoice: true, ...(typeof value.voicePayload === "string" ? { voicePayload: value.voicePayload } : {}) } : {}) };
}
function normalizeSource(value: unknown): ComparisonSource {
  if (!record(value)) throw new Error("比較元の形式が正しくありません。");
  keys(value, ["id", "name", "fileName", "cues", "warnings", "generated"], "比較元");
  if(value.generated!==undefined&&typeof value.generated!=="boolean")throw new Error("整理案の形式が不正です。");
  const id = identifier(value.id, "モデルID");
  const name = boundedText(value.name, 128, "モデル名").trim();
  const fileName = boundedText(value.fileName, 512, "ファイル名");
  if (!Array.isArray(value.cues) || !value.cues.length || value.cues.length > MAX_CUES_PER_SOURCE) throw new Error("比較元は1〜200,000件の字幕を含む必要があります。");
  const cues = buildDocument(value.cues.map(cloneCue)).cues;
  if (!Array.isArray(value.warnings) || value.warnings.length > 100 || value.warnings.some(warning => typeof warning !== "string" || warning.length > 4096)) throw new Error("比較元の読み込みメッセージが正しくありません。");
  return { id, name, fileName, cues, warnings: [...value.warnings] as string[],...(value.generated?{generated:true}:{}) };
}
function normalizeSources(values: unknown): ComparisonSource[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_SOURCES) throw new Error("元字幕は最大3つ、整理案は1つまでです。");
  const sources = values.map(normalizeSource);
  if(sources.filter(s=>!s.generated).length>3||sources.filter(s=>s.generated).length>1)throw new Error("元字幕は最大3つ、整理案は1つまでです。");
  if (new Set(sources.map(source => source.id)).size !== sources.length) throw new Error("比較元のモデルIDが重複しています。");
  return sources;
}

function voiceLabels(cue: Cue): Map<string, string> {
  const cached = voiceLabelsCache.get(cue);
  if (cached) return cached;
  const labels = new Map<string, string>();
  if (cue.isMultiVoice && cue.voicePayload) for (const match of cue.voicePayload.matchAll(voiceTags())) {
    // Reuse the VTT entity decoder and speaker parser instead of interpreting HTML.
    try { const parsed = parseVtt(`WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n${match[0]}x</v>\n`).cues[0].speaker; if (parsed) labels.set(match[0], parsed); } catch { /* preserved multi-voice payload remains available */ }
  }
  voiceLabelsCache.set(cue, labels);
  return labels;
}
/** Individual names and the original compound labels, scoped to one model. */
export function getComparisonSpeakers(source: ComparisonSource): string[] {
  const labels = new Set<string>();
  for (const cue of source.cues) {
    if (cue.speaker) { labels.add(cue.speaker); getSpeakerParts(cue.speaker).forEach(label => labels.add(label)); }
    voiceLabels(cue).forEach(label => labels.add(label));
  }
  return [...labels];
}

export function createComparisonSession(sources: readonly ComparisonSource[], referenceId?: string): ComparisonSession {
  const normalized = normalizeSources(sources);
  const reference = referenceId ?? normalized[0].id;
  if (!normalized.some(source => source.id === reference)) throw new Error("基準にするモデルが見つかりません。");
  return { schemaVersion: 1, kind: "vtt-dialogue-comparison", sources: normalized, referenceId: reference, choices: dictionary(), speakerAliases: dictionary() };
}

type Anchor = { row: ComparisonRow; sourceId: string; cueId: string; ordinal: number };
type IntervalNode = { center: number; byStart: Anchor[]; byEnd: Anchor[]; left: IntervalNode | null; right: IntervalNode | null };

/** Centered interval tree: one query visits O(log n + intersecting anchors). */
function intervalTree(anchors: Anchor[]): IntervalNode | null {
  if (!anchors.length) return null;
  const sorted = [...anchors].sort((a, b) => a.row.start - b.row.start || a.row.end - b.row.end || a.ordinal - b.ordinal);
  const center = sorted[Math.floor(sorted.length / 2)].row.start;
  const left: Anchor[] = [], right: Anchor[] = [], crossing: Anchor[] = [];
  for (const anchor of sorted) {
    if (anchor.row.end <= center) left.push(anchor);
    else if (anchor.row.start > center) right.push(anchor);
    else crossing.push(anchor);
  }
  return { center, byStart: crossing, byEnd: [...crossing].sort((a, b) => b.row.end - a.row.end || a.ordinal - b.ordinal), left: intervalTree(left), right: intervalTree(right) };
}
function overlapping(node: IntervalNode | null, start: number, end: number, accept: (anchor: Anchor) => void): void {
  if (!node) return;
  if (end <= node.center) {
    for (const anchor of node.byStart) { if (anchor.row.start >= end) break; accept(anchor); }
    overlapping(node.left, start, end, accept);
  } else if (start >= node.center) {
    for (const anchor of node.byEnd) { if (anchor.row.end <= start) break; accept(anchor); }
    overlapping(node.right, start, end, accept);
  } else {
    node.byStart.forEach(accept);
    overlapping(node.left, start, end, accept);
    overlapping(node.right, start, end, accept);
  }
}
function bestAnchor(tree: IntervalNode | null, cue: Cue): Anchor | null {
  let best: Anchor | null = null, bestOverlap = 0, bestDistance = Infinity;
  overlapping(tree, cue.start, cue.end, anchor => {
    const overlap = Math.min(cue.end, anchor.row.end) - Math.max(cue.start, anchor.row.start);
    const distance = Math.abs((cue.start / 2 + cue.end / 2) - (anchor.row.start / 2 + anchor.row.end / 2));
    if (overlap > bestOverlap || overlap === bestOverlap && (distance < bestDistance || distance === bestDistance && (anchor.row.start < (best?.row.start ?? Infinity) || anchor.row.start === best?.row.start && anchor.ordinal < best.ordinal))) {
      best = anchor; bestOverlap = overlap; bestDistance = distance;
    }
  });
  return best;
}

/**
 * Fixed anchors prevent transitive overlap chains from swallowing a meeting.
 * A cue is assigned exactly once; its text and original times are never sliced.
 */
export function buildComparisonRows(session: ComparisonSession): ComparisonRow[] {
  const reference = session.sources.find(source => source.id === session.referenceId);
  if (!reference || session.sources.length < 1 || session.sources.length > MAX_SOURCES) throw new Error("比較の基準モデルが正しくありません。");
  const anchors: Anchor[] = [];
  const makeAnchor = (source: ComparisonSource, cue: Cue, isReference: boolean): Anchor => {
    const candidates = dictionary<Cue[]>();
    session.sources.forEach(item => { candidates[item.id] = []; });
    candidates[source.id].push(cue);
    const row: ComparisonRow = { id: rowId(source.id, cue.id), start: cue.start, end: cue.end, ...(isReference ? { referenceCueId: cue.id } : {}), candidates };
    const anchor = { row, sourceId: source.id, cueId: cue.id, ordinal: anchors.length };
    anchors.push(anchor);
    return anchor;
  };
  reference.cues.forEach(cue => makeAnchor(reference, cue, true));
  for (const source of session.sources) {
    if (source.id === reference.id) continue;
    // Anchors remain fixed throughout this source. Newly unmatched cues become
    // anchors for later sources, but never consume other cues of their own model.
    const tree = intervalTree(anchors);
    for (const cue of source.cues) {
      const anchor = bestAnchor(tree, cue);
      if (anchor) anchor.row.candidates[source.id].push(cue);
      else makeAnchor(source, cue, false);
    }
  }
  const rows = anchors.sort((a, b) => a.row.start - b.row.start || a.row.end - b.row.end || a.ordinal - b.ordinal).map(anchor => anchor.row);
  for (const row of rows) for (const candidates of Object.values(row.candidates)) candidates.sort((a, b) => a.start - b.start || a.end - b.end);
  rowOrigins.set(rows, { sources: session.sources, referenceId: session.referenceId });
  return rows;
}
function completeRows(session: ComparisonSession, rows?: readonly ComparisonRow[]): readonly ComparisonRow[] {
  const origin = rows && rowOrigins.get(rows);
  // Filtering a UI list or using a stale alignment must never filter an export.
  return origin?.sources === session.sources && origin.referenceId === session.referenceId ? rows! : buildComparisonRows(session);
}
export function getComparisonChoice(session: ComparisonSession, row: ComparisonRow): ComparisonChoice {
  const explicit = own(session.choices, row.id) ? session.choices[row.id] : undefined;
  return explicit ?? { textSourceId: row.candidates[session.referenceId]?.length ? session.referenceId : null, speaker: null };
}

export function addComparisonSources(session: ComparisonSession, sources: readonly ComparisonSource[]): ComparisonSession {
  if (!sources.length) return session;
  return validateSession({ ...session, sources: [...session.sources, ...sources] });
}
export function setComparisonReference(session: ComparisonSession, referenceId: string): ComparisonSession {
  if (!session.sources.some(source => source.id === referenceId)) throw new Error("基準にするモデルが見つかりません。");
  if (referenceId === session.referenceId) return session;
  return { ...session, referenceId, choices: dictionary() };
}
export function removeComparisonSource(session: ComparisonSession, sourceId: string): ComparisonSession {
  if (!session.sources.some(source => source.id === sourceId)) return session;
  if (session.sources.length === 1) throw new Error("比較には最低1つのVTTが必要です。");
  const sources = session.sources.filter(source => source.id !== sourceId);
  const speakerAliases = dictionary<Record<string, string>>();
  for (const source of sources) if (own(session.speakerAliases, source.id)) speakerAliases[source.id] = { ...session.speakerAliases[source.id] };
  const next: ComparisonSession = { ...session, sources, referenceId: session.referenceId === sourceId ? sources[0].id : session.referenceId, choices: dictionary(), speakerAliases };
  if (session.referenceId === sourceId) return next;
  const validRowIds = new Set(buildComparisonRows(next).map(row => row.id));
  for (const [id, choice] of Object.entries(session.choices)) {
    if (!validRowIds.has(id)) continue;
    next.choices[id] = { textSourceId: choice.textSourceId === sourceId ? null : choice.textSourceId, speaker: choice.speaker && "sourceId" in choice.speaker && choice.speaker.sourceId === sourceId ? null : choice.speaker };
  }
  return next;
}

type Selected = { source: ComparisonSource; original: Cue; row: ComparisonRow; label: string | null; speakerSourceId: string | null; explicitLabel: boolean; preserveMultiVoice: boolean; voices: { label: string; explicit: boolean }[] };
function aliasFor(session: ComparisonSession, sourceId: string, label: string): { label: string; explicit: boolean } {
  const aliases = session.speakerAliases[sourceId];
  if (aliases && own(aliases, label)) return { label: aliases[label], explicit: true };
  const parts = getSpeakerParts(label);
  if (parts.length > 1 && aliases && parts.some(part => own(aliases, part))) return { label: parts.map(part => own(aliases, part) ? aliases[part] : part).join(" / "), explicit: true };
  return { label, explicit: false };
}
function selectedItems(session: ComparisonSession, rows: readonly ComparisonRow[]): { items: Selected[]; selectedRowCount: number } {
  const sourceById = new Map(session.sources.map(source => [source.id, source]));
  const seen = new Set<string>();
  const items: Selected[] = [];
  let selectedRowCount = 0;
  for (const row of rows) {
    const choice = getComparisonChoice(session, row);
    if (choice.textSourceId === null) continue;
    const source = sourceById.get(choice.textSourceId);
    const candidates = row.candidates[choice.textSourceId];
    if (!source || !candidates?.length) throw new Error("採用する字幕が比較区間にありません。採用元を選び直してください。");
    selectedRowCount += 1;
    for (const original of candidates) {
      const key = cueKey(source.id, original.id);
      if (seen.has(key)) throw new Error("同じ元字幕が重複して採用されています。比較区間を作り直してください。");
      seen.add(key);
      let label = original.speaker, speakerSourceId: string | null = source.id, explicitLabel = false;
      if (choice.speaker && "custom" in choice.speaker) { label = choice.speaker.custom; speakerSourceId = null; explicitLabel = true; }
      else if (choice.speaker && "sourceId" in choice.speaker) { label = choice.speaker.label; speakerSourceId = choice.speaker.sourceId; }
      if (label !== null && speakerSourceId !== null) { const alias = aliasFor(session, speakerSourceId, label); label = alias.label; explicitLabel = alias.explicit; }
      const preserveMultiVoice = choice.speaker === null && !!original.isMultiVoice;
      const voices = preserveMultiVoice ? [...new Set(voiceLabels(original).values())].map(label => aliasFor(session, source.id, label)) : [];
      items.push({ source, original, row, label, speakerSourceId, explicitLabel, preserveMultiVoice, voices });
    }
  }
  return { items, selectedRowCount };
}
function collisions(items: Selected[]): Set<string> {
  const sourcesByLabel = new Map<string, Set<string>>();
  const add = (label: string, sourceId: string) => { const sources = sourcesByLabel.get(label) ?? new Set<string>(); sources.add(sourceId); sourcesByLabel.set(label, sources); };
  for (const item of items) {
    if (item.label !== null && !item.explicitLabel && item.speakerSourceId !== null) add(item.label, item.speakerSourceId);
    for (const voice of item.voices) if (!voice.explicit) add(voice.label, item.source.id);
  }
  return new Set([...sourcesByLabel].filter(([, sources]) => sources.size > 1).map(([label]) => label));
}
function modelName(session: ComparisonSession, sourceId: string): string {
  const source = session.sources.find(source => source.id === sourceId);
  if (!source) return sourceId;
  return session.sources.filter(item => item.name === source.name).length > 1 ? `${source.name} ${session.sources.indexOf(source) + 1}` : source.name;
}
function replaceMultiVoiceText(cue: Cue): string {
  if (!cue.isMultiVoice || !cue.voicePayload) return cue.text;
  try {
    // Assign a temporary common voice so the parser retains only spoken text,
    // rather than the old inline speaker labels, when overriding a multi-voice cue.
    const payload = cue.voicePayload.replace(/<v(?:\.[^\s>]+)*[ \t]+[^>]+>/g, "<v replacement>");
    return parseVtt(`WEBVTT\n\n${formatTime(cue.start, true)} --> ${formatTime(cue.end, true)}\n${payload}\n`).cues[0].text;
  } catch { return cue.text; }
}
function resolveCues(session: ComparisonSession, items: Selected[], ambiguous: Set<string>): ComparisonCue[] {
  return items.map(item => {
    const speaker = item.label !== null && !item.explicitLabel && item.speakerSourceId !== null && ambiguous.has(item.label) ? `${item.label}［${modelName(session, item.speakerSourceId)}］` : item.label;
    const original = item.original;
    let content: Pick<Cue, "speaker" | "text" | "isMultiVoice" | "voicePayload"> = { speaker, text: item.preserveMultiVoice ? original.text : replaceMultiVoiceText(original), isMultiVoice: item.preserveMultiVoice ? original.isMultiVoice : undefined, voicePayload: item.preserveMultiVoice ? original.voicePayload : undefined };
    if (item.preserveMultiVoice && original.voicePayload) {
      let changed = false;
      const labels = voiceLabels(original);
      const payload = original.voicePayload.replace(voiceTags(), (tag: string) => {
        const raw = labels.get(tag);
        if (!raw) return tag;
        const alias = aliasFor(session, item.source.id, raw);
        const name = !alias.explicit && ambiguous.has(alias.label) ? `${alias.label}［${modelName(session, item.source.id)}］` : alias.label;
        if (name === raw) return tag;
        changed = true;
        const escaped = name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return tag.replace(/([ \t]+)[^>]+>$/, (_, spacing: string) => `${spacing}${escaped}>`);
      });
      if (changed) {
        const parsed = parseVtt(`WEBVTT\n\n${formatTime(original.start, true)} --> ${formatTime(original.end, true)}\n${payload}\n`).cues[0];
        content = { speaker: parsed.speaker, text: parsed.text, isMultiVoice: parsed.isMultiVoice, voicePayload: parsed.voicePayload };
      }
    }
    return { ...original, ...content, id: `comparison:${cueKey(item.source.id, original.id)}`, sourceIds: original.sourceIds.map(id => `comparison:${cueKey(item.source.id, id)}`), comparisonSourceId: item.source.id, comparisonSourceName: item.source.name, comparisonSourceCueId: original.id, comparisonRowId: item.row.id, comparisonSpeakerSourceId: item.speakerSourceId };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
}
export function getSelectedCues(session: ComparisonSession, rows?: readonly ComparisonRow[]): ComparisonCue[] {
  const { items } = selectedItems(session, completeRows(session, rows));
  return resolveCues(session, items, collisions(items));
}
export function getComparisonSummary(session: ComparisonSession, rows?: readonly ComparisonRow[]): ComparisonSummary {
  const complete = completeRows(session, rows);
  const { items, selectedRowCount } = selectedItems(session, complete);
  const ambiguous = collisions(items);
  const cues = resolveCues(session, items, ambiguous);
  let overlapCount = 0, latestEnd = -1;
  for (const cue of cues) { if (cue.start < latestEnd) overlapCount += 1; latestEnd = Math.max(latestEnd, cue.end); }
  const warnings: string[] = [];
  if (overlapCount) warnings.push(`採用した字幕に時刻が重なる箇所が${overlapCount}件あります。元の時刻を保っているため、区間の前後を確認してください。`);
  if (ambiguous.size) warnings.push(`異なるモデルで同じ話者ラベルが${ambiguous.size}種類あります。混同を避けるため採用結果にはモデル名を添えます。同じ人なら話者名の対応で共通の名前を指定できます。`);
  const skippedRowCount = complete.length - selectedRowCount;
  if (skippedRowCount) warnings.push(`${skippedRowCount}区間は採用する字幕が未選択です。採用結果には含まれません。`);
  return { selectedRowCount, skippedRowCount, cueCount: cues.length, overlapCount, speakerCollisionCount: ambiguous.size, warnings };
}

function normalizeSpeaker(value: unknown, sourceSpeakers: Map<string, Set<string>>): SpeakerChoice {
  if (value === null) return null;
  if (!record(value)) throw new Error("採用する話者の形式が正しくありません。");
  if (own(value, "custom")) { keys(value, ["custom"], "採用する話者"); return { custom: boundedText(value.custom, 80, "話者名").trim() }; }
  keys(value, ["sourceId", "label"], "採用する話者");
  if (typeof value.sourceId !== "string" || !sourceSpeakers.has(value.sourceId)) throw new Error("採用する話者のモデルが見つかりません。");
  if (value.label !== null && (typeof value.label !== "string" || !sourceSpeakers.get(value.sourceId)!.has(value.label))) throw new Error("採用する話者が比較元にありません。");
  return { sourceId: value.sourceId, label: value.label as string | null };
}
function validateSession(value: unknown): ComparisonSession {
  if (!record(value)) throw new Error("比較プロジェクトの形式が正しくありません。");
  keys(value, ["schemaVersion", "kind", "sources", "referenceId", "choices", "speakerAliases"], "比較プロジェクト");
  if (value.schemaVersion !== 1 || value.kind !== "vtt-dialogue-comparison") throw new Error("対応するVTT比較プロジェクトではありません。");
  const sources = normalizeSources(value.sources);
  if (typeof value.referenceId !== "string" || !sources.some(source => source.id === value.referenceId)) throw new Error("比較の基準モデルが見つかりません。");
  const sourceSpeakers = new Map(sources.map(source => [source.id, new Set(getComparisonSpeakers(source))]));
  const session: ComparisonSession = { schemaVersion: 1, kind: "vtt-dialogue-comparison", sources, referenceId: value.referenceId, choices: dictionary(), speakerAliases: dictionary() };
  if (!record(value.choices) || !record(value.speakerAliases)) throw new Error("比較の採用設定が正しくありません。");
  for (const [sourceId, aliases] of Object.entries(value.speakerAliases)) {
    if (forbidden.has(sourceId) || !sourceSpeakers.has(sourceId) || !record(aliases)) throw new Error("話者名の対応に存在しないモデルがあります。");
    const result = dictionary<string>();
    for (const [label, name] of Object.entries(aliases)) {
      if (forbidden.has(label) || !sourceSpeakers.get(sourceId)!.has(label)) throw new Error("話者名の対応に存在しない話者があります。");
      result[label] = boundedText(name, 80, "話者名").trim();
    }
    session.speakerAliases[sourceId] = result;
  }
  const rows = new Map(buildComparisonRows(session).map(row => [row.id, row]));
  if (Object.keys(value.choices).length > rows.size) throw new Error("比較の採用区間数が正しくありません。");
  for (const [id, rawChoice] of Object.entries(value.choices)) {
    const row = rows.get(id);
    if (forbidden.has(id) || !row || !record(rawChoice)) throw new Error("比較の採用設定に存在しない区間があります。");
    keys(rawChoice, ["textSourceId", "speaker"], "採用設定");
    const textSourceId = rawChoice.textSourceId;
    if (textSourceId !== null && (typeof textSourceId !== "string" || !row.candidates[textSourceId]?.length)) throw new Error("比較区間に存在しない字幕が採用されています。");
    session.choices[id] = { textSourceId: textSourceId as string | null, speaker: normalizeSpeaker(rawChoice.speaker, sourceSpeakers) };
  }
  return session;
}
export function exportComparisonJson(session: ComparisonSession): string {
  return JSON.stringify(validateSession(session), null, 2);
}
export function importComparisonJson(raw: string): ComparisonSession {
  if (typeof raw !== "string" || raw.length > MAX_JSON_LENGTH) throw new Error("比較プロジェクトは100 MB以下のJSONを選択してください。");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("比較プロジェクトのJSONを読み込めません。"); }
  return validateSession(value);
}
