"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Pencil, UserRound } from "lucide-react";
import { Modal } from "@/components/editor-ui";
import {correctionPair} from '../src/lib/terminology';
import { formatTime, type Cue } from "@/src/lib/vtt";

export type TranscriptCorrection = { cueId: string; text: string };
export type SpeakerSelectionScope = "selection" | "fromSelection";

function useInitialFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  return ref;
}

export function TextCorrectionDialog({ cues, onSave, onClose, error }: {
  cues: Cue[];
  onSave: (changes: TranscriptCorrection[],learn?:boolean) => void;
  onClose: () => void;
  error?: string;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(cues.map(cue => [cue.id, cue.text])));
  const [validationError, setValidationError] = useState("");
  const [learn,setLearn]=useState(false);
  const firstInput = useInitialFocus<HTMLTextAreaElement>();
  const changes = cues.filter(cue => drafts[cue.id] !== cue.text).map(cue => ({ cueId: cue.id, text: drafts[cue.id] }));
  const save = () => {
    if (!changes.length) return;
    if (changes.some(change => !change.text.trim())) {
      setValidationError("字幕には文字を残してください。発言を消す場合は、会話画面の行削除を使えます。");
      return;
    }
    if (changes.some(change => change.text.length > 2_000_000 || /\u0000/.test(change.text))) {
      setValidationError("修正した字幕が長すぎるか、使用できない文字が含まれています。");
      return;
    }
    try { onSave(changes,learn); }
    catch (reason) { setValidationError(reason instanceof Error ? reason.message : "字幕を修正できませんでした。"); }
  };

  return <Modal title="字幕の誤字を修正" eyebrow="EDIT TRANSCRIPT" wide onClose={onClose}
    footer={<><span className="modal-footer-note">字幕の文字のみ変更します</span><button type="button" className="button secondary" onClick={onClose}>キャンセル</button><button type="button" className="button primary" disabled={!changes.length} onClick={save}><Check size={15}/>修正を保存</button></>}>
    <div className="transcript-edit-dialog">
      <p className="transcript-edit-note"><Pencil size={15}/><span>字幕のみ修正。音声と既存カットの時刻は保持します。</span></p>
      <div className="transcript-correction-list">
        {cues.map((cue, index) => <label className="transcript-correction-field" key={cue.id}>
          <span className="transcript-correction-meta"><time>{formatTime(cue.start, true)} → {formatTime(cue.end, true)}</time><span>{cue.speaker ?? "話者不明"}</span></span>
          <textarea ref={index === 0 ? firstInput : undefined} value={drafts[cue.id]} spellCheck={false}
            aria-label={`${formatTime(cue.start, true)}の字幕本文を修正`} rows={Math.min(8, Math.max(3, cue.text.split("\n").length + 1))}
            onChange={event => { setDrafts(previous => ({ ...previous, [cue.id]: event.target.value })); setValidationError(""); }}/>
        </label>)}
      </div>
      {changes.some(c=>correctionPair(cues.find(v=>v.id===c.cueId)!.text,c.text))&&<div className="learn-pairs"><label><input type="checkbox" checked={learn} onChange={e=>setLearn(e.target.checked)}/>修正した語句を用語辞書に登録</label>{changes.map(c=>{const pair=correctionPair(cues.find(v=>v.id===c.cueId)!.text,c.text);return pair&&<p key={c.cueId}>{pair.from} → {pair.to}</p>;})}</div>}<p className="transcript-edit-subnote">削除済みの文字も含めて表示しています。文字を修正しても、その部分の削除は取り消しません。</p>
      {(error || validationError) && <p className="field-error" role="alert">{error || validationError}</p>}
    </div>
  </Modal>;
}

export function SelectionSpeakerDialog({ text, speakers, canChangeFromSelection, onSave, onClose, error }: {
  text: string;
  speakers: string[];
  canChangeFromSelection: boolean;
  onSave: (name: string, scope: SpeakerSelectionScope) => void;
  onClose: () => void;
  error?: string;
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<SpeakerSelectionScope>("selection");
  const [validationError, setValidationError] = useState("");
  const nameInput = useInitialFocus<HTMLInputElement>();
  const names = [...new Set(speakers.map(speaker => speaker.trim()).filter(Boolean))];
  const chooseName = (next: string) => { setName(next); setValidationError(""); };
  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80 || /[\u0000-\u001f<>]/.test(trimmed)) {
      setValidationError("話者名は1〜80文字で、改行や < > を含めず入力してください。");
      return;
    }
    try { onSave(trimmed, canChangeFromSelection ? scope : "selection"); }
    catch (reason) { setValidationError(reason instanceof Error ? reason.message : "話者を変更できませんでした。"); }
  };

  return <Modal title="選択した部分の話者を変更" eyebrow="SPLIT SPEAKER" onClose={onClose}
    footer={<><button type="button" className="button secondary" onClick={onClose}>キャンセル</button><button type="button" className="button primary" disabled={!name.trim()} onClick={save}><UserRound size={15}/>話者を変更</button></>}>
    <div className="transcript-edit-dialog">
      <div className="speaker-selection-preview"><span>選択中のテキスト</span><p>{text}</p></div>
      <label className="transcript-speaker-field"><span>変更後の話者</span><input ref={nameInput} value={name} maxLength={80} placeholder="既存の話者、または新しい名前" aria-label="選択部分の話者名"
        onChange={event => chooseName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); save(); } }}/></label>
      {names.length > 0 && <div className="transcript-speaker-options" aria-label="既存の話者から選択">{names.map(speaker => <button key={speaker} type="button" className={name === speaker ? "selected" : ""} aria-pressed={name === speaker} onClick={() => chooseName(speaker)}><UserRound size={12}/>{speaker}</button>)}</div>}
      <fieldset className="speaker-scope-options"><legend>変更する範囲</legend>
        <label><input type="radio" name="speaker-scope" value="selection" checked={scope === "selection"} onChange={() => setScope("selection")}/><span><strong>選択した文字だけ</strong><small>選択範囲の前後は元の話者を保持</small></span></label>
        {canChangeFromSelection && <label><input type="radio" name="speaker-scope" value="fromSelection" checked={scope === "fromSelection"} onChange={() => setScope("fromSelection")}/><span><strong>選択開始から、この字幕の末尾まで</strong><small>途中から話者が変わっている場合</small></span></label>}
      </fieldset>
      <p className="transcript-edit-subnote">文章の途中で字幕を分割します。途中の時刻は文字位置から推定し、既存のカット時刻は保持します。</p>
      {(error || validationError) && <p className="field-error" role="alert">{error || validationError}</p>}
    </div>
  </Modal>;
}
