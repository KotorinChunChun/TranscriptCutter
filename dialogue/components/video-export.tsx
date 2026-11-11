"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDownToLine, Check, ChevronRight, ExternalLink, Film, FolderOpen, LoaderCircle, RotateCcw, Scissors, ShieldCheck, Square, Volume2 } from "lucide-react";
import { Modal } from "@/components/editor-ui";
import { formatTime } from "@/src/lib/vtt";
import type { CutRecord } from "@/src/lib/editor";
import { buildMediaCutPlan } from "@/src/lib/media-plan";
import { inspectMediaFile, renderCutMedia } from "@/src/lib/media-cut";

type Inspection = Awaited<ReturnType<typeof inspectMediaFile>>;
type RenderedMedia = Awaited<ReturnType<typeof renderCutMedia>>;
type MediaFormat = "mp4" | "webm";
type CompletedExport = {
  source: File;
  media: RenderedMedia;
  url: string;
  fileName: string;
  cutSignature: string;
  hasVideo: boolean;
  format: MediaFormat;
  cutCount: number;
  subtitleEndMs: number;
};
type SaveWritable = { write(data: Blob): Promise<void>; close(): Promise<void>; abort?: () => Promise<void> };
type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable(): Promise<SaveWritable> }>;
type PickerWindow = Window & { showSaveFilePicker?: SavePicker };

export type VideoExportDialogProps = {
  open: boolean;
  file: File;
  cuts: readonly CutRecord[];
  subtitleEndMs: number;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
};

const humanBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};
const cutKey = (cuts: readonly CutRecord[], subtitleEndMs: number) => JSON.stringify([subtitleEndMs, cuts.map(c => [c.id, c.start, c.end, c.kind, c.precision])]);
const errorText = (error: unknown) => error instanceof Error ? error.message : "書き出しを完了できませんでした。もう一度お試しください。";
const requestBinaryDownload = (url: string, fileName: string) => {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); }
};

/**
 * Keep this component mounted while its source File remains selected. Closing
 * hides the dialog and cancels work, but retains a completed binary result.
 */
export function VideoExportDialog({ open, file, cuts, subtitleEndMs, onClose, onBusyChange }: VideoExportDialogProps) {
  const [inspection, setInspection] = useState<{ source: File; media: Inspection } | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectionError, setInspectionError] = useState("");
  const [inspectionRetry, setInspectionRetry] = useState(0);
  const [format, setFormat] = useState<MediaFormat>("mp4");
  const [clipConfirmed, setClipConfirmed] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [renderError, setRenderError] = useState("");
  const [progress, setProgress] = useState({ fraction: 0, stage: "書き出しを準備しています", outputBytes: 0 });
  const [completed, setCompleted] = useState<CompletedExport | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [savePickerSupported, setSavePickerSupported] = useState(false);
  const [siteUrl, setSiteUrl] = useState("");

  const sourceRef = useRef(file);
  sourceRef.current = file;
  const mountedRef = useRef(true);
  const completedRef = useRef<CompletedExport | null>(null);
  const renderAbort = useRef<AbortController | null>(null);
  const renderVersion = useRef(0);
  const inspectVersion = useRef(0);
  const saveVersion = useRef(0);
  const saveWriter = useRef<SaveWritable | null>(null);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const info = inspection?.source === file ? inspection.media : null;
  const result = completed?.source === file ? completed : null;
  const signature = useMemo(() => cutKey(cuts, subtitleEndMs), [cuts, subtitleEndMs]);
  const resultChanged = !!result && result.cutSignature !== signature;

  const planning = useMemo(() => {
    if (!info) return { plan: null, error: "" };
    try { return { plan: buildMediaCutPlan(cuts, info.durationMs, subtitleEndMs), error: "" }; }
    catch (error) { return { plan: null, error: errorText(error) }; }
  }, [cuts, info, subtitleEndMs]);
  const plan = planning.plan;
  const trailingDurationMs = info ? Math.max(0, info.durationMs - subtitleEndMs) : 0;
  const shorterThanSubtitles = !!info && subtitleEndMs > info.durationMs + 1000;
  const clippedCuts = plan?.clippedCutCount ?? 0;
  const mismatch = shorterThanSubtitles || clippedCuts > 0;
  const estimatedCount = cuts.filter(c => c.precision === "estimated").length;
  const formatAvailable = !!info && (format === "mp4" ? info.mp4Supported : info.webmSupported);
  const decodeBlocked = !!info && ((info.hasVideo && !info.videoDecodable) || (info.hasAudio && !info.audioDecodable));
  const canRender = !!info && !!plan && plan.outputDurationMs > 0 && formatAvailable && !decodeBlocked && (!mismatch || clipConfirmed) && !rendering && !saving;
  const outputType = info?.hasVideo === false ? "音声" : "動画";

  const disposeResult = useCallback(async (updateState = true) => {
    const old = completedRef.current;
    completedRef.current = null;
    if (updateState && mountedRef.current) setCompleted(null);
    if (!old) return;
    // A result backed by OPFS must lose its object URL before its file is removed.
    URL.revokeObjectURL(old.url);
    try { await old.media.release(); } catch { /* cleanup must not obscure the next export */ }
  }, []);

  const cancelRendering = useCallback(() => {
    const controller = renderAbort.current;
    if (controller && !controller.signal.aborted) {
      controller.abort();
      if (mountedRef.current) {
        setCancelling(true);
        setProgress(previous => ({ ...previous, stage: "中断しています…" }));
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setSavePickerSupported(typeof (window as PickerWindow).showSaveFilePicker === "function");
    setSiteUrl(window.location.href);
    return () => {
      mountedRef.current = false;
      renderVersion.current += 1;
      inspectVersion.current += 1;
      saveVersion.current += 1;
      renderAbort.current?.abort();
      void saveWriter.current?.abort?.().catch(() => undefined);
      void disposeResult(false);
      busyCallback.current?.(false);
    };
  }, [disposeResult]);

  useEffect(() => { busyCallback.current?.(rendering || saving); }, [rendering, saving]);

  useEffect(() => {
    renderVersion.current += 1;
    inspectVersion.current += 1;
    saveVersion.current += 1;
    renderAbort.current?.abort();
    renderAbort.current = null;
    void saveWriter.current?.abort?.().catch(() => undefined);
    saveWriter.current = null;
    void disposeResult();
    setInspection(null);
    setInspectionError("");
    setRenderError("");
    setRendering(false);
    setCancelling(false);
    setSaving(false);
    setNotice("");
    setClipConfirmed(false);
  }, [file, disposeResult]);

  useEffect(() => { setClipConfirmed(false); }, [file, signature, subtitleEndMs]);

  useEffect(() => {
    if (!open || info) return;
    const version = ++inspectVersion.current;
    let ignored = false;
    setInspecting(true);
    setInspectionError("");
    inspectMediaFile(file).then(media => {
      if (ignored || !mountedRef.current || version !== inspectVersion.current || sourceRef.current !== file) return;
      setInspecting(false);
      setInspection({ source: file, media });
      setFormat(media.mp4Supported ? "mp4" : "webm");
    }).catch(error => {
      if (!ignored && mountedRef.current && version === inspectVersion.current && sourceRef.current === file) setInspectionError(errorText(error));
    }).finally(() => {
      if (!ignored && mountedRef.current && version === inspectVersion.current) setInspecting(false);
    });
    return () => { ignored = true; };
    // An inspection is retained while closed; retry explicitly re-runs failures.
  }, [file, open, inspectionRetry, info]);

  useEffect(() => { if (!open) cancelRendering(); }, [open, cancelRendering]);

  const closeDialog = () => { cancelRendering(); onClose(); };

  const startRendering = async () => {
    if (!canRender || !info || !plan) return;
    const source = file;
    const snapshot = cuts.map(c => ({ ...c, sourceCueIds: [...c.sourceCueIds], spans: c.spans?.map(s => ({ ...s })) }));
    const snapshotSubtitleEndMs = subtitleEndMs;
    const snapshotSignature = signature;
    const selectedFormat = format;
    const hasVideo = info.hasVideo;
    const plannedCutCount = plan.cuts.length;
    const version = ++renderVersion.current;
    renderAbort.current?.abort();
    const controller = new AbortController();
    renderAbort.current = controller;
    setRendering(true);
    setCancelling(false);
    setRenderError("");
    setNotice("");
    setProgress({ fraction: 0, stage: "書き出しを準備しています", outputBytes: 0 });
    try {
      await disposeResult();
      if (controller.signal.aborted || version !== renderVersion.current || sourceRef.current !== source) return;
      const media = await renderCutMedia({
        file: source,
        cuts: snapshot,
        subtitleEndMs: snapshotSubtitleEndMs,
        format: selectedFormat,
        signal: controller.signal,
        onProgress: update => {
          if (!mountedRef.current || version !== renderVersion.current || controller.signal.aborted || sourceRef.current !== source) return;
          setProgress({ fraction: Math.max(0, Math.min(1, update.fraction)), stage: update.stage, outputBytes: Math.max(0, update.outputBytes) });
        },
      });
      if (!mountedRef.current || controller.signal.aborted || version !== renderVersion.current || sourceRef.current !== source) {
        await media.release();
        return;
      }
      if (!media.blob.size) { await media.release(); throw new Error("書き出したファイルが空でした。入力ファイルとカット範囲を確認してください。"); }
      let url: string;
      try { url = URL.createObjectURL(media.blob); }
      catch (error) { await media.release(); throw error; }
      const base = source.name.replace(/\.[^./\\]+$/, "") || "recording";
      const next: CompletedExport = { source, media, url, fileName: `${base}_cut.${media.extension}`, cutSignature: snapshotSignature, hasVideo, format: selectedFormat, cutCount: plannedCutCount, subtitleEndMs: snapshotSubtitleEndMs };
      completedRef.current = next;
      setCompleted(next);
      setProgress({ fraction: 1, stage: "完了", outputBytes: media.blob.size });
      try {
        requestBinaryDownload(url, next.fileName);
        setNotice("ファイルを作成し、ブラウザにダウンロードを要求しました。保存状況はブラウザのダウンロード一覧で確認できます。");
      } catch {
        setNotice("ファイルは作成できました。自動ダウンロードを開始できなかったため、下のダウンロードボタンか保存先の選択をお使いください。");
      }
    } catch (error) {
      if (!mountedRef.current || version !== renderVersion.current || sourceRef.current !== source) return;
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) setNotice("書き出しを中断しました。元ファイルとカット記録はそのままです。");
      else setRenderError(errorText(error));
    } finally {
      if (mountedRef.current && version === renderVersion.current) {
        renderAbort.current = null;
        setRendering(false);
        setCancelling(false);
      }
    }
  };

  const saveWithPicker = async () => {
    const current = result;
    const picker = (window as PickerWindow).showSaveFilePicker;
    if (!current || !picker || saving) return;
    const version = ++saveVersion.current;
    setSaving(true);
    setNotice("");
    let writer: SaveWritable | null = null;
    try {
      const handle = await picker.call(window, {
        suggestedName: current.fileName,
        types: [{ description: current.hasVideo ? "カット済み動画" : "カット済み音声", accept: { [current.media.mimeType.split(";")[0]]: [`.${current.media.extension}`] } }],
      });
      if (!mountedRef.current || version !== saveVersion.current || completedRef.current !== current) return;
      writer = await handle.createWritable();
      saveWriter.current = writer;
      if (!mountedRef.current || version !== saveVersion.current || completedRef.current !== current) { await writer.abort?.(); return; }
      await writer.write(current.media.blob);
      await writer.close();
      if (mountedRef.current && version === saveVersion.current) setNotice("選択した保存先への書き込みが完了しました。");
    } catch (error) {
      try { await writer?.abort?.(); } catch { /* an already closed writer needs no cleanup */ }
      if (mountedRef.current && version === saveVersion.current) {
        setNotice(error instanceof Error && error.name === "AbortError" ? "保存先の選択をキャンセルしました。生成済みファイルは引き続き保存できます。" : "この画面では保存先への書き込みを完了できませんでした。「ダウンロード」か、別タブでの保存をお試しください。");
      }
    } finally {
      if (saveWriter.current === writer) saveWriter.current = null;
      if (mountedRef.current && version === saveVersion.current) setSaving(false);
    }
  };

  if (!open) return null;

  return <Modal title={info?.hasVideo === false ? "カットして音声を書き出す" : "カットして動画を書き出す"} eyebrow="EXPORT CUT MEDIA" wide onClose={closeDialog} footer={<>
    {rendering ? <><span className="modal-footer-note">この画面を閉じると、書き出しを中断します。</span><button className="button secondary" onClick={cancelRendering} disabled={cancelling}><Square size={14}/>{cancelling ? "中断しています…" : "書き出しを中断"}</button></> : <><button className="button secondary" onClick={closeDialog}>閉じる</button><button className="button primary" disabled={!canRender} onClick={() => void startRendering()}>{result ? <RotateCcw size={16}/> : <Scissors size={16}/>} {result ? "現在のカットで作り直す" : `カットして${outputType}を書き出す`}</button></>}
  </>}>
    <div className="video-export-source"><span className="video-export-file-icon">{info?.hasVideo === false ? <Volume2 size={22}/> : <Film size={22}/>}</span><div><strong title={file.name}>{file.name}</strong><p>{humanBytes(file.size)}{info ? ` · ${formatTime(info.durationMs, true)}${info.hasVideo ? ` · ${info.width} × ${info.height}` : " · 音声ファイル"}` : " · ファイルの長さと対応形式を確認"}</p></div></div>

    {inspecting && !info && <div className="video-export-loading" role="status"><LoaderCircle size={20}/><span>元ファイルの長さ・映像・音声を確認しています…</span></div>}
    {inspectionError && <div className="error-banner" role="alert"><AlertCircle size={17}/><div><p>{inspectionError}</p><button className="button secondary small" onClick={() => setInspectionRetry(n => n + 1)}><RotateCcw size={13}/>もう一度確認</button></div></div>}
    {info && <>
      {plan && <div className="video-export-summary" aria-label="カット後の長さ"><div><span>元ファイル</span><strong>{formatTime(plan.durationMs, true)}</strong></div><ChevronRight size={16}/><div><span>{plan.cuts.length}区間をカット</span><strong>{(plan.cutDurationMs / 1000).toFixed(2)}<small>秒</small></strong></div><ChevronRight size={16}/><div className="video-export-duration"><span>カット後（計算値）</span><strong>{formatTime(plan.outputDurationMs, true)}</strong></div></div>}
      {plan && <div className="inline-notice" aria-label="VTT終了後の自動カット"><Scissors size={15}/><span>VTTの最終終了時刻：<strong>{formatTime(subtitleEndMs, true)}</strong>。{trailingDurationMs > 0 ? <>ここから元ファイルの終了 {formatTime(info.durationMs, true)} までの {(trailingDurationMs / 1000).toFixed(3)}秒を自動カットします。上のカット時間にも含まれています。</> : <>元ファイルに、この時刻を超える区間はありません。</>}</span></div>}
      {planning.error && <p className="field-error" role="alert">{planning.error}</p>}
      {plan?.outputDurationMs === 0 && <p className="field-error" role="alert">ファイルの全区間がカット対象です。カット記録を修正して、残す区間を作ってください。</p>}
      <div className="form-field"><label className="form-label" htmlFor="video-export-format">書き出す形式</label><select id="video-export-format" className="select-input" value={format} disabled={rendering || saving} onChange={event => setFormat(event.target.value as MediaFormat)}><option value="mp4" disabled={!info.mp4Supported}>{info.hasVideo ? `MP4 — H.264${info.hasAudio ? " / AAC" : ""}` : "M4A — AAC"}{!info.mp4Supported ? "（このブラウザでは利用不可）" : ""}</option><option value="webm" disabled={!info.webmSupported}>{info.hasVideo ? `WebM — ${(info.webmVideoCodec ?? "vp9").toUpperCase()}${info.hasAudio ? " / Opus" : ""}` : "WebM — Opus"}{!info.webmSupported ? "（このブラウザでは利用不可）" : ""}</option></select><p className="form-help">カットした区間を詰めて、残す映像・音声を1本のファイルにします。再エンコードにより画質・音質・容量は変わります。</p><p className="form-help">表示はカット区間から計算した長さです。音声の圧縮処理による余白で、実ファイルはわずかに長くなる場合があります。</p></div>
      {(!info.mp4Supported && info.webmSupported) && <div className="inline-notice"><AlertCircle size={15}/><span>このブラウザではMP4の書き出しを利用できないため、WebMを使用します。</span></div>}
      {(!info.mp4Supported && !info.webmSupported || decodeBlocked) && <div className="field-error" role="alert">このファイルを読み込み・書き出しできるコーデックをブラウザで利用できません。このサイトを別タブで開くか、対応形式の元動画を選び直してください。</div>}
      {mismatch && <div className="video-export-mismatch"><div><AlertCircle size={17}/><strong>字幕・カット時刻と、ファイルの長さを確認してください</strong></div>{shorterThanSubtitles && <p>字幕の終了 {formatTime(subtitleEndMs, true)} が、元ファイルの長さ {formatTime(info.durationMs, true)} を超えています。</p>}{clippedCuts > 0 && <p>{clippedCuts}件のカット記録がファイルの末尾を超えています。書き出す場合は、実際のファイル内の範囲だけを使います。</p>}<label><input type="checkbox" checked={clipConfirmed} disabled={rendering || saving} onChange={event => setClipConfirmed(event.target.checked)}/><span>対象の動画・音声であることを確認し、ファイルの長さの範囲で書き出す</span></label></div>}
      {estimatedCount > 0 && <div className="inline-notice"><Scissors size={15}/><span>単語などの推定時刻が{estimatedCount}件含まれます。気になる箇所は「カット記録」で再生して開始・終了を調整できます。</span></div>}
      {(info.trackCounts.video > 1 || info.trackCounts.audio > 1) && <div className="inline-notice"><Film size={15}/><span>元ファイルには映像{info.trackCounts.video}・音声{info.trackCounts.audio}トラックがあります。主映像・主音声をそれぞれ1トラックずつ書き出します。</span></div>}
      {info.warnings.length > 0 && <details className="warning-details"><summary>元ファイルについての確認事項（{info.warnings.length}件）</summary><ul>{info.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
    </>}

    {renderError && <div className="error-banner" role="alert"><AlertCircle size={17}/><span>{renderError}</span></div>}
    {rendering && <div className="video-render-progress" role="status"><div><LoaderCircle size={18}/><strong>{cancelling ? "中断しています…" : progress.stage}</strong><span>{Math.round(progress.fraction * 100)}%</span></div><div className="progress-track" role="progressbar" aria-label="動画書き出しの進捗" aria-valuenow={Math.round(progress.fraction * 100)} aria-valuemin={0} aria-valuemax={100}><div className="progress-fill" style={{ width: `${progress.fraction * 100}%` }}/></div><p>{progress.outputBytes > 0 ? `${humanBytes(progress.outputBytes)} を作成中 · ` : ""}書き出しが終わるまで、このタブを開いたままにしてください。</p></div>}
    {notice && !rendering && <p className="video-export-notice" role="status"><Check size={15}/><span>{notice}</span></p>}
    {result && <section className="video-export-result" aria-label="生成済みファイル"><div className="video-export-result-heading"><span className="video-export-check"><Check size={19}/></span><div><h3>カット済み{result.hasVideo ? "動画" : "音声"}ができました</h3><p>{result.cutCount}区間をカット · 計算値 {formatTime(result.media.durationMs, true)} · {humanBytes(result.media.blob.size)} · VTT終了 {formatTime(result.subtitleEndMs, true)}</p></div></div>{resultChanged && <div className="inline-notice"><AlertCircle size={15}/><span>このファイルの生成後にカット記録またはVTTの終了時刻が変わっています。以下は生成時点の結果です。最新の編集を反映するには「現在のカットで作り直す」を押してください。</span></div>}<p className="video-export-filename" title={result.fileName}>{result.fileName}</p>{result.hasVideo ? <video className="video-export-preview" controls playsInline preload="metadata" src={result.url}/> : <audio className="video-export-audio" controls preload="metadata" src={result.url}/>}<div className="video-export-downloads"><a className="button primary" href={result.url} download={result.fileName} onClick={() => setNotice("ブラウザにダウンロードを要求しました。保存状況はブラウザのダウンロード一覧で確認できます。")}><ArrowDownToLine size={16}/>生成した{result.hasVideo ? "動画" : "音声"}をダウンロード</a>{savePickerSupported && <button className="button secondary" disabled={saving} onClick={() => void saveWithPicker()}><FolderOpen size={15}/>{saving ? "保存しています…" : "保存先を選ぶ"}</button>}<a className="button ghost small" href={result.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/>{result.hasVideo ? "動画" : "音声"}を別タブで開く</a></div><p className="form-help">閉じても、このファイルを選択している間は結果を開き直せます。別の元ファイルを選ぶ・作り直す・画面を更新すると、この結果は解除されます。</p></section>}
    <div className="video-export-browser-note"><ExternalLink size={15}/><p>ChatGPT内の表示でダウンロードが始まらない場合は、<a href={siteUrl || undefined} target="_blank" rel="noopener noreferrer">このサイトを別タブで開いて</a>書き出してください。別タブでは元動画を選び直し、保存した編集プロジェクトを読み込めます。</p></div>
    <p className="video-export-local"><ShieldCheck size={14}/>元ファイルは変更せず、ブラウザ内で別のファイルを作成します。</p>
  </Modal>;
}
